// "Seller asks, buyer approves". A shop types the customer's PAY CODE and an amount; the customer's app
// shows the request and the customer approves it with the usual fingerprint or PIN. No QR code.
//
// The pay code is not a secret and not a PIN: it only lets a shop ASK. Nothing is paid until the customer
// approves on their own device (payflow.ts). The server decides every status; the shop page only reads it.
//
// Collections (server only, Firestore rules deny browsers):
//   paycodes/{code} -> {userId}          users/{uid} -> {payCode}
//   requests/{id}                        requests_by_shop/{shop|time|id}, requests_by_buyer/{buyer|time|id} (indexes)
// Audit events carry ids and booleans only: never the shop name, amount, note or pay code.
import { randomInt } from "crypto";
import { randomToken } from "../secret";
import type { Store } from "../store";
import { audit } from "./audit";

export const REQUEST_TTL_MS = 5 * 60_000;
export const SHOP_REQUESTS_PER_MINUTE = 10;
export const BUYER_MAX_OPEN = 3;
/** A payment being approved holds its request this long; after that another attempt may take over. */
export const CLAIM_MS = 2 * 60_000;

export type RequestStatus = "pending" | "paid" | "declined" | "expired";

export interface ShopRequest {
  id: string;
  ref: string; // 2 digits, read aloud so the customer and the shop agree it is the same payment
  shopName: string;
  note?: string;
  amountMinor: string; // integer minor units
  assetCode: "NGN";
  assetScale: 2;
  buyerUserId: string;
  shopUserId: string;
  status: RequestStatus;
  createdAt: number;
  expiresAt: number;
  shownAt?: number;
  claim?: { by: string; at: number };
}

export interface SellerDeps {
  store: Store;
  limitMinor: number;
  now?: () => number;
}

const clock = (d: { now?: () => number }) => d.now?.() ?? Date.now();
const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(13, "0");

// ---------- pay code ----------

const sixDigits = () => String(randomInt(100_000, 1_000_000));

/** The person's pay code, made on first request. 6 digits, unique. */
export async function getPayCode(store: Store, userId: string, opts: { random?: () => string } = {}): Promise<string> {
  const have = await store.get<{ payCode?: string }>("users", userId);
  if (have?.payCode) return have.payCode;
  const random = opts.random ?? sixDigits;
  for (let i = 0; i < 30; i++) {
    const code = random();
    const won = await store.update<{ userId: string }, boolean>("paycodes", code, (cur) => (cur ? { doc: cur, result: false } : { doc: { userId }, result: true }));
    if (!won) continue;
    const kept = await store.update<{ payCode?: string }, string>("users", userId, (cur) => (cur?.payCode ? { doc: cur, result: cur.payCode } : { doc: { ...(cur ?? {}), payCode: code }, result: code }));
    if (kept !== code) await store.delete("paycodes", code); // a parallel call got there first: give our spare code back
    return kept;
  }
  throw new Error("no free pay code");
}

const normalizeCode = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const c = v.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(c) ? c : null;
};

// ---------- validation ----------

const NAME = /^[\p{L}\p{N} .,'&-]{1,40}$/u;
const NOTE = /^[\p{L}\p{N} .,'&!?:;()/+-]{1,60}$/u;

// ---------- reading and expiring ----------

async function load(d: SellerDeps, id: unknown): Promise<ShopRequest | null> {
  if (typeof id !== "string" || !/^sr_[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
  return d.store.get<ShopRequest>("requests", id);
}

/** A pending request past its time becomes expired (once, atomically) and says so in the audit. */
async function expireIfDue(d: SellerDeps, r: ShopRequest, userId: string): Promise<ShopRequest> {
  const now = clock(d);
  if (r.status !== "pending" || now < r.expiresAt) return r;
  const changed = await d.store.update<ShopRequest, boolean>("requests", r.id, (cur) =>
    cur && cur.status === "pending" && now >= cur.expiresAt ? { doc: { ...cur, status: "expired" }, result: true } : { doc: cur, result: false },
  );
  if (changed) await audit(d.store, userId, "request_expired", { outcome: "ok", shopRequestId: r.id }, now);
  return (await d.store.get<ShopRequest>("requests", r.id)) ?? r;
}

async function openCountFor(d: SellerDeps, buyerId: string): Promise<number> {
  const idx = await d.store.list<{ id: string }>("requests_by_buyer", { prefix: `${buyerId}|`, newestFirst: true, limit: 30 });
  const now = clock(d);
  let n = 0;
  for (const { id } of idx) {
    const r = await d.store.get<ShopRequest>("requests", id);
    if (r && r.buyerUserId === buyerId && r.status === "pending" && now < r.expiresAt) n++;
  }
  return n;
}

// ---------- shop side ----------

export type CreateResult =
  | { ok: true; request: { id: string; ref: string; expiresAt: number } }
  | { ok: false; reason: "bad_code" | "unknown_code" | "bad_amount" | "over_limit" | "bad_name" | "bad_note" | "self_request" | "too_many_requests" | "buyer_busy" };

export async function createRequest(d: SellerDeps, shopUserId: string, body: { code?: unknown; amountMinor?: unknown; shopName?: unknown; note?: unknown }): Promise<CreateResult> {
  const now = clock(d);
  const fail = async (reason: Extract<CreateResult, { ok: false }>["reason"]): Promise<CreateResult> => {
    await audit(d.store, shopUserId, "request_created", { outcome: "fail", reason }, now);
    return { ok: false, reason };
  };
  const code = normalizeCode(body.code);
  if (!code) return fail("bad_code");
  const amount = body.amountMinor;
  if (typeof amount !== "string" || !/^\d{1,15}$/.test(amount) || BigInt(amount) <= 0n) return fail("bad_amount");
  if (BigInt(amount) > BigInt(d.limitMinor)) return fail("over_limit");
  const shopName = typeof body.shopName === "string" ? body.shopName.trim().replace(/\s+/g, " ") : "";
  if (!NAME.test(shopName)) return fail("bad_name");
  let note: string | undefined;
  if (body.note !== undefined && body.note !== null && body.note !== "") {
    const n = typeof body.note === "string" ? body.note.trim().replace(/\s+/g, " ") : "";
    if (!NOTE.test(n)) return fail("bad_note");
    note = n;
  }
  const owner = await d.store.get<{ userId: string }>("paycodes", code);
  if (!owner) return fail("unknown_code");
  if (owner.userId === shopUserId) return fail("self_request");

  const recent = await d.store.list<{ createdAt: number }>("requests_by_shop", { prefix: `${shopUserId}|`, newestFirst: true, limit: SHOP_REQUESTS_PER_MINUTE });
  if (recent.filter((r) => r.createdAt > now - 60_000).length >= SHOP_REQUESTS_PER_MINUTE) return fail("too_many_requests");
  if ((await openCountFor(d, owner.userId)) >= BUYER_MAX_OPEN) return fail("buyer_busy");

  const request: ShopRequest = {
    id: `sr_${randomToken(12)}`,
    ref: String(randomInt(10, 100)),
    shopName,
    ...(note ? { note } : {}),
    amountMinor: amount,
    assetCode: "NGN",
    assetScale: 2,
    buyerUserId: owner.userId,
    shopUserId,
    status: "pending",
    createdAt: now,
    expiresAt: now + REQUEST_TTL_MS,
  };
  await d.store.put("requests", request.id, request);
  await d.store.put("requests_by_shop", `${shopUserId}|${pad(now)}|${request.id}`, { id: request.id, createdAt: now });
  await d.store.put("requests_by_buyer", `${owner.userId}|${pad(now)}|${request.id}`, { id: request.id, createdAt: now });
  await audit(d.store, shopUserId, "request_created", { outcome: "ok", shopRequestId: request.id }, now);
  return { ok: true, request: { id: request.id, ref: request.ref, expiresAt: request.expiresAt } };
}

export type ShopStatusResult =
  | { ok: true; status: RequestStatus; ref: string; shopName: string; amountMinor: string; assetCode: "NGN"; assetScale: 2; expiresAt: number }
  | { ok: false; reason: "not_found" };

/** The shop reads the status the server set. Only the shop that asked can see it. */
export async function shopStatus(d: SellerDeps, shopUserId: string, id: unknown): Promise<ShopStatusResult> {
  const r0 = await load(d, id);
  if (!r0 || r0.shopUserId !== shopUserId) return { ok: false, reason: "not_found" };
  const r = await expireIfDue(d, r0, shopUserId);
  return { ok: true, status: r.status, ref: r.ref, shopName: r.shopName, amountMinor: r.amountMinor, assetCode: r.assetCode, assetScale: r.assetScale, expiresAt: r.expiresAt };
}

// ---------- buyer side ----------

export interface PendingView {
  id: string;
  ref: string;
  shopName: string;
  note?: string;
  amountMinor: string;
  assetCode: "NGN";
  assetScale: 2;
  expiresAt: number;
}

/** The customer's open requests, oldest first. The first time one is listed it is marked shown. */
export async function pendingFor(d: SellerDeps, buyerId: string): Promise<PendingView[]> {
  const idx = await d.store.list<{ id: string }>("requests_by_buyer", { prefix: `${buyerId}|`, newestFirst: true, limit: 30 });
  const out: PendingView[] = [];
  for (const { id } of idx) {
    const r0 = await d.store.get<ShopRequest>("requests", id);
    if (!r0 || r0.buyerUserId !== buyerId) continue;
    const r = await expireIfDue(d, r0, buyerId);
    if (r.status !== "pending") continue;
    if (!r.shownAt) {
      const now = clock(d);
      const first = await d.store.update<ShopRequest, boolean>("requests", r.id, (cur) => (cur && !cur.shownAt ? { doc: { ...cur, shownAt: now }, result: true } : { doc: cur, result: false }));
      if (first) await audit(d.store, buyerId, "request_shown", { outcome: "ok", shopRequestId: r.id }, now);
    }
    out.push({ id: r.id, ref: r.ref, shopName: r.shopName, ...(r.note ? { note: r.note } : {}), amountMinor: r.amountMinor, assetCode: r.assetCode, assetScale: r.assetScale, expiresAt: r.expiresAt });
  }
  return out.reverse();
}

export async function declineRequest(d: SellerDeps, buyerId: string, id: unknown): Promise<{ ok: true } | { ok: false; reason: "not_found" | "request_closed" }> {
  const r0 = await load(d, id);
  if (!r0 || r0.buyerUserId !== buyerId) return { ok: false, reason: "not_found" };
  const now = clock(d);
  const res = await d.store.update<ShopRequest, "ok" | "closed">("requests", r0.id, (cur) => {
    if (!cur || cur.status !== "pending" || now >= cur.expiresAt || (cur.claim && now - cur.claim.at < CLAIM_MS)) return { doc: cur, result: "closed" };
    return { doc: { ...cur, status: "declined" }, result: "ok" };
  });
  await audit(d.store, buyerId, "request_declined", res === "ok" ? { outcome: "ok", shopRequestId: r0.id } : { outcome: "fail", reason: "request_closed", shopRequestId: r0.id }, now);
  return res === "ok" ? { ok: true } : { ok: false, reason: "request_closed" };
}

// ---------- paying (called by payflow.ts) ----------

/** What payflow may read to start a payment: the request, only if it is the buyer's, open and in time. */
export async function payableRequest(d: SellerDeps, buyerId: string, id: unknown): Promise<{ ok: true; request: ShopRequest } | { ok: false; reason: "request_gone" | "request_expired" | "request_closed" }> {
  const r0 = await load(d, id);
  if (!r0 || r0.buyerUserId !== buyerId) return { ok: false, reason: "request_gone" };
  const r = await expireIfDue(d, r0, buyerId);
  if (r.status === "expired") return { ok: false, reason: "request_expired" };
  if (r.status !== "pending") return { ok: false, reason: "request_closed" };
  return { ok: true, request: r };
}

/** Just before the money moves: take the request for this one payment, so it cannot be paid twice at once. */
export async function claimForPayment(d: SellerDeps, buyerId: string, id: unknown, by: string): Promise<{ ok: true; request: ShopRequest } | { ok: false; reason: "request_gone" | "request_expired" | "request_closed" }> {
  const r0 = await load(d, id);
  if (!r0 || r0.buyerUserId !== buyerId) return { ok: false, reason: "request_gone" };
  const now = clock(d);
  const res = await d.store.update<ShopRequest, "ok" | "expired" | "closed">("requests", r0.id, (cur) => {
    if (!cur) return { doc: cur, result: "closed" };
    if (cur.status === "pending" && now >= cur.expiresAt) return { doc: { ...cur, status: "expired" }, result: "expired" };
    if (cur.status !== "pending") return { doc: cur, result: "closed" };
    if (cur.claim && cur.claim.by !== by && now - cur.claim.at < CLAIM_MS) return { doc: cur, result: "closed" };
    return { doc: { ...cur, claim: { by, at: now } }, result: "ok" };
  });
  if (res === "ok") return { ok: true, request: (await d.store.get<ShopRequest>("requests", r0.id)) as ShopRequest };
  return { ok: false, reason: res === "expired" ? "request_expired" : "request_closed" };
}

export async function releaseClaim(d: { store: Store }, id: string, by: string): Promise<void> {
  await d.store.update<ShopRequest, void>("requests", id, (cur) => (cur && cur.claim?.by === by ? { doc: { ...cur, claim: undefined }, result: undefined } : { doc: cur, result: undefined }));
}

/** The server marks the request paid in the same step that records the receipt. */
export async function markPaid(d: SellerDeps, buyerId: string, id: string, by: string): Promise<void> {
  const now = clock(d);
  const done = await d.store.update<ShopRequest, boolean>("requests", id, (cur) => (cur && cur.status === "pending" && cur.claim?.by === by ? { doc: { ...cur, status: "paid", claim: undefined }, result: true } : { doc: cur, result: false }));
  await audit(d.store, buyerId, "request_paid", done ? { outcome: "ok", shopRequestId: id } : { outcome: "fail", reason: "not_claimed", shopRequestId: id }, now);
}
