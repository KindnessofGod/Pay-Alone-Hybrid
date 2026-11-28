// Demo mode for the /demo page ("Judge demo: one screen, two people").
// On one device both halves share one anonymous user, and the server normally refuses a shop that asks its own
// pay code (self_request). In demo mode ONLY that one rule is relaxed: the request is stored with the shop side
// as `demo-shop:<uid>`, so the same user can ask themselves and read the status. Everything else is unchanged:
// the amount comes from the server's request, the approval is verified on the server, expiry and rate limits
// apply, and a request is marked paid only after a verified approval.
// Nothing here invents a balance: the numbers are sums of the server's own records (paid requests, receipts).
import type { Amount } from "../money";
import { allowedOrigins } from "./origin";
import type { Store } from "../store";
import type { Receipt } from "./payflow";
import type { ShopRequest } from "./seller";

export const DEMO_SHOP_PREFIX = "demo-shop:";
export const demoShopId = (userId: string) => `${DEMO_SHOP_PREFIX}${userId}`;
export const isDemoShopId = (id: string) => id.startsWith(DEMO_SHOP_PREFIX);

const WEEK_MS = 7 * 86_400_000;

/**
 * True only when the call came from our own /demo page (same-origin Referer) and demo mode is not switched off
 * (DEMO_MODE=0). The Referer is a soft check: the real protection is that demo mode relaxes only the self-request
 * rule, and a payment still needs the person's own verified approval.
 */
export function isDemoContext(reqUrl: string, referer: string | null, env: Record<string, string | undefined> = process.env): boolean {
  if (env.DEMO_MODE === "0" || !referer) return false;
  try {
    const r = new URL(referer);
    const self = new URL(reqUrl);
    const sameOrigin = r.origin === self.origin || allowedOrigins(env).includes(r.origin);
    return sameOrigin && (r.pathname === "/demo" || r.pathname === "/demo/");
  } catch {
    return false;
  }
}

export interface MoneySum {
  assetCode: string;
  assetScale: number;
  value: string; // integer minor units
  count: number;
}

function addTo(map: Map<string, { assetCode: string; assetScale: number; total: bigint; count: number }>, a: { value: string; assetCode: string; assetScale: number }) {
  const k = `${a.assetCode}|${a.assetScale}`;
  const cur = map.get(k) ?? { assetCode: a.assetCode, assetScale: a.assetScale, total: 0n, count: 0 };
  cur.total += BigInt(a.value);
  cur.count += 1;
  map.set(k, cur);
}
const toSums = (m: Map<string, { assetCode: string; assetScale: number; total: bigint; count: number }>): MoneySum[] =>
  [...m.values()].map((x) => ({ assetCode: x.assetCode, assetScale: x.assetScale, value: x.total.toString(), count: x.count })).sort((a, b) => (a.assetCode < b.assetCode ? -1 : 1));

/** What the shop was paid: paid requests only. */
export function sumReceived(requests: Pick<ShopRequest, "status" | "amountMinor" | "assetCode" | "assetScale">[]): MoneySum[] {
  const m = new Map<string, { assetCode: string; assetScale: number; total: bigint; count: number }>();
  for (const r of requests) if (r.status === "paid") addTo(m, { value: r.amountMinor, assetCode: r.assetCode, assetScale: r.assetScale });
  return toSums(m);
}

/** What the person sent in the last 7 days, from their receipts, per currency. */
export function sumSentThisWeek(receipts: Pick<Receipt, "debit" | "createdAt">[], now: number): MoneySum[] {
  const m = new Map<string, { assetCode: string; assetScale: number; total: bigint; count: number }>();
  for (const r of receipts) {
    const at = Date.parse(r.createdAt);
    if (Number.isFinite(at) && at > now - WEEK_MS && at <= now + 60_000) addTo(m, r.debit);
  }
  return toSums(m);
}

export interface DemoSummary {
  ok: true;
  simulated: boolean;
  shop: { received: MoneySum[]; wallet: string | null };
  customer: { sentThisWeek: MoneySum[]; cap: Amount; wallet: string | null };
}

export async function loadDemoSummary(
  store: Store,
  userId: string,
  now: number,
  cfg: { cap: Amount; shopWallet: string | null; customerWallet: string | null; simulated: boolean },
): Promise<DemoSummary> {
  const idx = await store.list<{ id: string }>("requests_by_shop", { prefix: `${demoShopId(userId)}|`, newestFirst: true, limit: 100 });
  const reqs: ShopRequest[] = [];
  for (const { id } of idx) {
    const r = await store.get<ShopRequest>("requests", id);
    if (r && r.shopUserId === demoShopId(userId) && r.buyerUserId === userId) reqs.push(r);
  }
  const receipts = (await store.list<Receipt>("receipts_by_user", { prefix: `${userId}|`, newestFirst: true, limit: 100 })).filter((r) => r.userId === userId);
  return {
    ok: true,
    simulated: cfg.simulated,
    shop: { received: sumReceived(reqs), wallet: cfg.shopWallet },
    customer: { sentThisWeek: sumSentThisWeek(receipts, now), cap: cfg.cap, wallet: cfg.customerWallet },
  };
}
