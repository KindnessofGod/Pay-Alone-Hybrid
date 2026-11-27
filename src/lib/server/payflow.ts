// The payment flow on the server. The browser proposes; this code decides.
//   startPayment   re-checks payee and amount, gets a quote, issues a one-time approval challenge,
//                  and returns the read-back built from the QUOTE (rule 7).
//   finishPayment  checks the PIN or passkey (approve.ts), pays exactly the quote, writes the receipt.
//   cancelPayment  forgets the pending payment.
//   setUserPin     sets the PIN once; changing it needs the old one.
// Nothing here ever stores or returns a PIN.
import { issueChallenge, type ApprovalChallenge, type ApprovalSubject } from "../approval";
import { OpError } from "../op/types";
import { quoteReadBack } from "../hybrid/readback";
import { speakPlain, type Amount } from "../money";
import type { StoredPasskey } from "../passkey";
import { randomToken } from "../secret";
import type { Store } from "../store";
import { approvePayment, type ChallengeStore } from "../security/approve";
import { checkPin, setPin, type PinStore } from "../security/pin";
import { saveCounter } from "./passkeystore";

export interface Contact {
  id: string;
  name: string;
}

export interface QuoteResult {
  quoteId: string;
  debit: Amount; // what leaves the payer, fees included
  simulated: boolean;
}

export interface PayDeps {
  store: Store;
  baseUrl: string;
  limitMinor: number;
  contacts(userId: string): Promise<Contact[]>;
  quote(userId: string, payee: Contact, amountMinor: string): Promise<QuoteResult>;
  pay(userId: string, quoteId: string): Promise<{ paymentId: string; simulated: boolean }>;
  /** Real rail only: has this person connected a wallet and set a weekly limit? Absent for the simulated rail. */
  walletReady?(userId: string): Promise<boolean>;
  passkeys?(userId: string): Promise<StoredPasskey[]>;
  now?(): number;
}

interface Pending {
  userId: string;
  requestId: string;
  payee: Contact;
  quote: QuoteResult;
  createdAt: number;
}

export interface Receipt {
  id: string;
  userId: string;
  requestId: string;
  paymentId: string;
  payeeId: string;
  payeeName: string;
  debit: Amount;
  method: "pin" | "passkey";
  simulated: boolean;
  createdAt: string;
}

/** A pending payment older than this cannot be approved; the person starts again. */
export const PENDING_TTL_MS = 10 * 60_000;

const pendingKey = (userId: string, requestId: string) => `${userId}|${requestId}`;

export function pinStoreOf(store: Store): PinStore {
  return { get: (id) => store.get("pins", id), put: (id, rec) => store.put("pins", id, rec), update: (id, fn) => store.update("pins", id, fn) };
}

export function challengeStoreOf(store: Store): ChallengeStore {
  return {
    put: (u, s, c) => store.put("challenges", pendingKey(u, s.requestId), c),
    take: async (u, s) => (await store.take<ApprovalChallenge>("challenges", pendingKey(u, s.requestId))) ?? undefined,
  };
}

function subjectOf(p: Pending): ApprovalSubject {
  return { requestId: p.requestId, quoteId: p.quote.quoteId, debitValue: p.quote.debit.value, assetCode: p.quote.debit.assetCode, assetScale: p.quote.debit.assetScale };
}

async function newChallenge(d: PayDeps, p: Pending): Promise<string> {
  const c = issueChallenge(subjectOf(p), d.now?.() ?? Date.now());
  await challengeStoreOf(d.store).put(p.userId, subjectOf(p), c);
  return c.challenge;
}

export async function startPayment(
  d: PayDeps,
  userId: string,
  body: { payeeId?: unknown; amountMinor?: unknown },
): Promise<
  | { ok: true; requestId: string; challenge: string; readBack: string; debit: Amount; payeeName: string; simulated: boolean; hasPasskey: boolean }
  | { ok: false; reason: "no_pin_set" | "wallet_not_connected" | "unknown_payee" | "bad_amount" | "over_limit" | "quote_failed" }
> {
  if (!(await pinStoreOf(d.store).get(userId))) return { ok: false, reason: "no_pin_set" };
  if (d.walletReady && !(await d.walletReady(userId))) return { ok: false, reason: "wallet_not_connected" };
  const payee = (await d.contacts(userId)).find((c) => c.id === body.payeeId);
  if (!payee) return { ok: false, reason: "unknown_payee" };
  const amount = body.amountMinor;
  if (typeof amount !== "string" || !/^\d{1,15}$/.test(amount) || BigInt(amount) <= 0n) return { ok: false, reason: "bad_amount" };
  if (BigInt(amount) > BigInt(d.limitMinor)) return { ok: false, reason: "over_limit" };

  let quote: QuoteResult;
  try {
    quote = await d.quote(userId, payee, amount);
  } catch (e) {
    if (e instanceof OpError) return { ok: false, reason: "quote_failed" };
    throw e;
  }
  const pending: Pending = { userId, requestId: `req_${randomToken(12)}`, payee, quote, createdAt: d.now?.() ?? Date.now() };
  await d.store.put("pending", pendingKey(userId, pending.requestId), pending);
  return {
    ok: true,
    requestId: pending.requestId,
    challenge: await newChallenge(d, pending),
    readBack: quoteReadBack(payee.name, quote.debit),
    debit: quote.debit,
    payeeName: payee.name,
    simulated: quote.simulated,
    hasPasskey: ((await d.passkeys?.(userId)) ?? []).length > 0,
  };
}

export async function finishPayment(
  d: PayDeps,
  userId: string,
  body: { requestId?: unknown; proof?: unknown },
): Promise<
  | { ok: true; receipt: Receipt; spoken: string }
  | { ok: false; reason: string; triesLeft?: number; challenge?: string }
> {
  if (typeof body.requestId !== "string") return { ok: false, reason: "not_found" };
  const key = pendingKey(userId, body.requestId);
  const pending = await d.store.get<Pending>("pending", key);
  if (!pending || pending.userId !== userId) return { ok: false, reason: "not_found" };
  if ((d.now?.() ?? Date.now()) - pending.createdAt > PENDING_TTL_MS) {
    await cancelPayment(d, userId, { requestId: body.requestId });
    return { ok: false, reason: "not_found" };
  }

  const a = await approvePayment({
    userId,
    subject: subjectOf(pending),
    proof: body.proof,
    pins: pinStoreOf(d.store),
    challenges: challengeStoreOf(d.store),
    passkeys: (await d.passkeys?.(userId)) ?? [],
    baseUrl: d.baseUrl,
    now: d.now?.(),
  });
  if (!a.ok) {
    // The challenge was used up by this try. A wrong PIN gets a fresh one so the person can try again;
    // a lockout does not.
    if (a.reason === "wrong" || a.reason === "bad_passkey") return { ok: false, reason: a.reason, triesLeft: a.triesLeft, challenge: await newChallenge(d, pending) };
    return { ok: false, reason: a.reason };
  }

  // Keep the device's new signature counter, so an old fingerprint signature cannot be replayed.
  if (a.method === "passkey" && a.passkeyId && typeof a.newCounter === "number") await saveCounter(d.store, userId, a.passkeyId, a.newCounter);

  // Take the pending payment so it can be paid only once.
  const mine = await d.store.take<Pending>("pending", key);
  if (!mine) return { ok: false, reason: "not_found" };
  let paid: { paymentId: string; simulated: boolean };
  try {
    paid = await d.pay(userId, mine.quote.quoteId);
  } catch (e) {
    // The wallet said no (or did not answer). Nothing is recorded as sent. Error text is never returned.
    if (e instanceof OpError) return { ok: false, reason: e.kind === "limit_exceeded" ? "over_cap" : "payment_failed" };
    throw e;
  }
  const receipt: Receipt = {
    id: `rcpt_${randomToken(12)}`,
    userId,
    requestId: mine.requestId,
    paymentId: paid.paymentId,
    payeeId: mine.payee.id,
    payeeName: mine.payee.name,
    debit: mine.quote.debit,
    method: a.method,
    simulated: paid.simulated || mine.quote.simulated,
    createdAt: new Date(d.now?.() ?? Date.now()).toISOString(),
  };
  await d.store.put("receipts", receipt.id, receipt);
  const what = `${speakPlain(receipt.debit)} to ${receipt.payeeName}. Receipt saved.`;
  return { ok: true, receipt, spoken: receipt.simulated ? `Simulated payment, no real money moved. ${what}` : `Sent. ${what}` };
}

export async function cancelPayment(d: PayDeps, userId: string, body: { requestId?: unknown }): Promise<{ ok: true }> {
  if (typeof body.requestId === "string") {
    await d.store.delete("pending", pendingKey(userId, body.requestId));
    await d.store.delete("challenges", pendingKey(userId, body.requestId));
  }
  return { ok: true };
}

export async function setUserPin(
  d: PayDeps,
  userId: string,
  body: { pin?: unknown; oldPin?: unknown },
): Promise<{ ok: true } | { ok: false; reason: "old_pin_needed" | "wrong" | "locked" | "weak_pin" | "bad_pin"; triesLeft?: number }> {
  const pins = pinStoreOf(d.store);
  if (typeof body.pin !== "string" || !/^\d{4,6}$/.test(body.pin)) return { ok: false, reason: "bad_pin" };
  if (await pins.get(userId)) {
    if (typeof body.oldPin !== "string") return { ok: false, reason: "old_pin_needed" };
    const c = await checkPin(pins, userId, body.oldPin, d.now?.() ?? Date.now());
    if (!c.ok) return c.reason === "wrong" ? { ok: false, reason: "wrong", triesLeft: c.triesLeft } : { ok: false, reason: c.reason === "locked" ? "locked" : "wrong" };
  }
  try {
    await setPin(pins, userId, body.pin);
  } catch {
    return { ok: false, reason: "weak_pin" };
  }
  return { ok: true };
}
