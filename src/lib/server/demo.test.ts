import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { demoShopId, isDemoContext, loadDemoSummary, sumReceived, sumSentThisWeek } from "./demo";

const NOW = Date.parse("2026-11-28T12:00:00Z");
const day = 86_400_000;
const rc = (value: string, ageMs: number, assetCode = "NGN") => ({ debit: { value, assetCode, assetScale: 2 }, createdAt: new Date(NOW - ageMs).toISOString() });

describe("isDemoContext (the /demo page only)", () => {
  const url = "https://usepayalone.tech/api/shop/ask";
  it("accepts a same-origin Referer of /demo", () => {
    expect(isDemoContext(url, "https://usepayalone.tech/demo", {})).toBe(true);
    expect(isDemoContext(url, "https://usepayalone.tech/demo?x=1#top", {})).toBe(true);
  });
  it("accepts the demo shop iframe (/shop with demo=1), same origin only", () => {
    expect(isDemoContext(url, "https://usepayalone.tech/shop?embed=1&demo=1", {})).toBe(true);
    expect(isDemoContext(url, "https://usepayalone.tech/shop?demo=1", {})).toBe(true);
    expect(isDemoContext(url, "https://usepayalone.tech/shop?embed=1", {})).toBe(false);
    expect(isDemoContext(url, "https://usepayalone.tech/shop?demo=0", {})).toBe(false);
    expect(isDemoContext(url, "https://usepayalone.tech/shop?x=demo=1", {})).toBe(false);
    expect(isDemoContext(url, "https://evil.example/shop?demo=1", {})).toBe(false);
    expect(isDemoContext(url, "https://usepayalone.tech/shop?demo=1", { DEMO_MODE: "0" })).toBe(false);
  });
  it("refuses other pages, other origins, a missing Referer, and when switched off", () => {
    expect(isDemoContext(url, "https://usepayalone.tech/shop", {})).toBe(false);
    expect(isDemoContext(url, "https://usepayalone.tech/demonstration", {})).toBe(false);
    expect(isDemoContext(url, "https://evil.example/demo", {})).toBe(false);
    expect(isDemoContext(url, null, {})).toBe(false);
    expect(isDemoContext(url, "not a url", {})).toBe(false);
    expect(isDemoContext(url, "https://usepayalone.tech/demo", { DEMO_MODE: "0" })).toBe(false);
  });
});

describe("sumSentThisWeek", () => {
  it("adds only the last 7 days, per currency, in integer minor units", () => {
    const s = sumSentThisWeek([rc("200000", day), rc("50000", 3 * day), rc("999", 8 * day), rc("150", day, "USD")], NOW);
    expect(s).toEqual([
      { assetCode: "NGN", assetScale: 2, value: "250000", count: 2 },
      { assetCode: "USD", assetScale: 2, value: "150", count: 1 },
    ]);
  });
  it("is empty with no receipts", () => expect(sumSentThisWeek([], NOW)).toEqual([]));
});

describe("sumReceived", () => {
  const r = (status: "paid" | "pending" | "declined" | "expired", amountMinor: string) => ({ status, amountMinor, assetCode: "NGN" as const, assetScale: 2 as const });
  it("counts only paid requests", () => {
    expect(sumReceived([r("paid", "200000"), r("pending", "500"), r("declined", "700"), r("paid", "100000")])).toEqual([{ assetCode: "NGN", assetScale: 2, value: "300000", count: 2 }]);
  });
});

describe("loadDemoSummary", () => {
  it("reads this user's paid demo requests and own receipts; no balance is invented", async () => {
    const store = new MemoryStore();
    await store.put("requests", "sr_a1234", { id: "sr_a1234", status: "paid", amountMinor: "200000", assetCode: "NGN", assetScale: 2, shopUserId: demoShopId("u1"), buyerUserId: "u1" });
    await store.put("requests_by_shop", `${demoShopId("u1")}|0000000000001|sr_a1234`, { id: "sr_a1234", createdAt: 1 });
    await store.put("requests", "sr_b1234", { id: "sr_b1234", status: "pending", amountMinor: "999", assetCode: "NGN", assetScale: 2, shopUserId: demoShopId("u1"), buyerUserId: "u1" });
    await store.put("requests_by_shop", `${demoShopId("u1")}|0000000000002|sr_b1234`, { id: "sr_b1234", createdAt: 2 });
    await store.put("requests", "sr_c1234", { id: "sr_c1234", status: "paid", amountMinor: "777", assetCode: "NGN", assetScale: 2, shopUserId: demoShopId("u2"), buyerUserId: "u2" });
    await store.put("requests_by_shop", `${demoShopId("u2")}|0000000000003|sr_c1234`, { id: "sr_c1234", createdAt: 3 });
    const r = rc("200000", day);
    await store.put("receipts_by_user", `u1|${String(Date.parse(r.createdAt)).padStart(13, "0")}|rcpt_x`, { ...r, userId: "u1" });
    const s = await loadDemoSummary(store, "u1", NOW, { cap: { value: "5000", assetCode: "USD", assetScale: 2 }, shopWallet: "https://wallet.example/shop", customerWallet: null, simulated: false });
    expect(s.shop.received).toEqual([{ assetCode: "NGN", assetScale: 2, value: "200000", count: 1 }]);
    expect(s.customer.sentThisWeek).toEqual([{ assetCode: "NGN", assetScale: 2, value: "200000", count: 1 }]);
    expect(s.customer.cap).toEqual({ value: "5000", assetCode: "USD", assetScale: 2 });
    expect(s.shop.wallet).toBe("https://wallet.example/shop");
    expect(s.customer.wallet).toBeNull();
    expect(JSON.stringify(s)).not.toMatch(/balance/i);
  });
});
