// Plain-code rules for the Gemini Live tool call. The model only suggests {payee, amount_naira}; this file
// decides. Nothing here approves or pays: a pass only opens the same Approve card as every other path.
//   - payee must be exactly one saved contact name (the tool schema also lists them as an enum),
//   - amount is a positive decimal with at most 2 places, turned into integer kobo from its text (no floats),
//   - the amount must also appear in OUR transcript of what the person said (digits or number words),
//   - the payee must appear in the transcript, or be a clear near-miss of exactly one contact ("Tundi").
import type { Contact, Proposal } from "./crosscheck";
import { parseBareAmount } from "./dialog";

export type LivePayReason = "unknown_payee" | "amount_not_heard" | "over_limit" | "not_ready";
export type LivePayResult = { ok: true; proposal: Proposal } | { ok: false; reason: LivePayReason; names?: string[] };

/** Naira (number or numeric string) to integer kobo, read from the decimal text. Null unless positive with at most 2 decimals. */
export function nairaToKobo(v: unknown): string | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  const m = String(v).trim().match(/^(\d{1,12})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const kobo = BigInt(m[1]) * BigInt(100) + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  return kobo > BigInt(0) ? kobo.toString() : null;
}

export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Our transcript holds exactly one amount and it is this one. Digits and number words both count. */
export function transcriptHasAmount(said: string, amountMinor: string): boolean {
  return parseBareAmount(said) === amountMinor;
}

const words = (s: string) => s.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{M}]+/u).filter((w) => w.length >= 3);
/** Largest edit-distance share still counted as "the same name, misheard". */
export const NAME_NEAR = 0.5;

/** Closeness of the transcript to a contact: 0 = a name word is said exactly, else the best edit share (1 = nothing close). */
function nearness(said: string[], c: Contact): number {
  let best = 1;
  for (const cw of words(c.name))
    for (const sw of said) {
      if (sw === cw) return 0;
      if (sw.length < 4 || cw.length < 4) continue; // short words only count when exact
      best = Math.min(best, editDistance(sw, cw) / Math.max(sw.length, cw.length));
    }
  return best;
}

/** The person said this contact's name, or something clearly closer to it than to any other contact. */
export function transcriptHasPayee(said: string, payee: Contact, contacts: Contact[]): boolean {
  const w = words(said);
  const mine = nearness(w, payee);
  if (mine > NAME_NEAR) return false;
  return contacts.filter((c) => c.id !== payee.id).every((c) => nearness(w, c) > mine);
}

export function decideLivePayment(args: unknown, said: string, contacts: Contact[], limitMinor: string): LivePayResult {
  const names = contacts.map((c) => c.name);
  const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const matches = typeof a.payee === "string" ? contacts.filter((c) => c.name === a.payee) : [];
  if (matches.length !== 1) return { ok: false, reason: "unknown_payee", names };
  const payee = matches[0];
  const amountMinor = nairaToKobo(a.amount_naira);
  if (!amountMinor) return { ok: false, reason: "amount_not_heard" };
  if (BigInt(amountMinor) > BigInt(limitMinor)) return { ok: false, reason: "over_limit" };
  if (!said.trim()) return { ok: false, reason: "not_ready" };
  if (!transcriptHasAmount(said, amountMinor)) return { ok: false, reason: "amount_not_heard" };
  if (!transcriptHasPayee(said, payee, contacts)) return { ok: false, reason: "unknown_payee", names };
  return { ok: true, proposal: { amountMinor, payeeId: payee.id, payeeName: payee.name } };
}

// ---- what the model is told ----------------------------------------------------------------------

export function liveInstruction(contacts: Contact[], pronunciation: Record<string, string> = {}): string {
  const list = contacts.map((c) => (pronunciation[c.name] ? `${c.name}: say ${pronunciation[c.name]}` : c.name)).join("; ");
  return (
    "You are the friendly voice assistant of Pay Alone, a payment app for blind, elderly and non-reading people. " +
    "The person speaks English with a Nigerian accent. Speak English only, and ignore any words that are not English in what you think you heard. Keep every answer short and plain, one or two sentences. " +
    "All amounts are in naira. " +
    `The saved people are: ${list}. Say these names exactly as shown, and only pay these people. ` +
    "You can never approve, confirm or send money. Never say a payment is done or sent; say only that the app will show the details. " +
    "Never ask for a PIN, a password or a code, and never repeat one. If a PIN comes up, tell the person to type it on the keypad on the screen. " +
    "Call propose_payment whenever the person wants to pay, send or give money to someone, even if you are unsure; call it right away and do not ask for yes or no first, because the person approves on the app. Set request to their own words. " +
    "If the tool answers that the name or amount was not understood, ask the person once, briefly, to say it again (for an unknown name, offer the saved names). " +
    "Never say you will show the details unless you called propose_payment in the same turn. If you are not sure of the name, ask, for example: Did you mean Tunde? "
    + "After a successful call, say only that you will show them the details. Do not repeat the name or the amount."
  );
}

/** The tool as plain JSON (the Firebase file builds the same shape with its Schema helpers). */
export function proposePaymentDeclaration(contacts: Contact[]) {
  return {
    name: "propose_payment",
    description: "Call whenever the person wants to pay, send or give money to someone. The app shows them the details; it never sends money by itself.",
    parameters: {
      type: "object" as const,
      properties: {
        payee: { type: "string" as const, enum: contacts.map((c) => c.name), description: "The saved person to pay, exactly as listed." },
        amount_naira: { type: "number" as const, description: "The amount in naira, as the person said it." },
        request: { type: "string" as const, description: "The person's own words about the payment." },
      },
      required: ["payee", "amount_naira", "request"],
    },
  };
}

/** The model said it will show the details: used to catch that promise when it never called the tool. */
export const promisesDetails = (t: string) => /\bshow (you )?(the |your )?details\b/i.test(t);
