import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory";
import { recentAudit } from "./audit";
import {
  REQUEST_TTL_MS,
  claimForPayment,
  createRequest,
  declineRequest,
  getPayCode,
  markPaid,
  pendingFor,
  releaseClaim,
  shopStatus,
} from "./seller";

vi.spyOn(console, "info").mockImplementation(() => {});

async function world() {
  const store = new MemoryStore();
  const buyerCode = await getPayCode(store, "buyer");
  let t = 1_000_000;
  const deps = { store, limitMinor: 5_000_000, now: () => t };
  return { store, buyerCode, deps, tick: (ms: number) => (t += ms) };
}
const ask = { amountMinor: "200000", shopName: "Mama Put", note: "Rice and stew" };

describe("pay code", () => {
  it("gives a signed-in user a stable 6-digit code, stored both ways", async () => {
    const store = new MemoryStore();
    const a = await getPayCode(store, "u1");
    expect(a).toMatch(/^[1-9]\d{5}$/);
    expect(await getPayCode(store, "u1")).toBe(a);
    expect(await store.get("paycodes", a)).toEqual({ userId: "u1" });
    expect(await store.get("users", "u1")).toMatchObject({ payCode: a });
  });

  it("never hands out a code that is already taken", async () => {
    const store = new MemoryStore();
    const seq = ["111111", "111111", "222222"];
    const random = () => seq.shift() ?? "999999";
    expect(await getPayCode(store, "u1", { random })).toBe("111111");
    expect(await getPayCode(store, "u2", { random })).toBe("222222");
    expect(await store.get("paycodes", "111111")).toEqual({ userId: "u1" });
  });

  it("two parallel first requests for one user still end with one code", async () => {
    const store = new MemoryStore();
    const [a, b] = await Promise.all([getPayCode(store, "u1"), getPayCode(store, "u1")]);
    expect(a).toBe(b);
    const owned = (await store.list<{ userId: string }>("paycodes")).filter((p) => p.userId === "u1");
    expect(owned).toHaveLength(1);
  });
});

describe("shop asks for payment", () => {
  it("creates a pending request with a 2-digit reference and a 5 minute life", async () => {
    const w = await world();
    const r = await createRequest(w.deps, "shop", { code: w.buyerCode, ...ask });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.ref).toMatch(/^[1-9]\d$/);
    expect(r.request.expiresAt - 1_000_000).toBe(REQUEST_TTL_MS);
    const stored = await w.store.get<Record<string, unknown>>("requests", r.request.id);
    expect(stored).toMatchObject({ status: "pending", buyerUserId: "buyer", shopUserId: "shop", shopName: "Mama Put", amountMinor: "200000", assetCode: "NGN", assetScale: 2 });
  });

  it("accepts the code typed with spaces", async () => {
    const w = await world();
    const spaced = `${w.buyerCode.slice(0, 2)} ${w.buyerCode.slice(2, 4)} ${w.buyerCode.slice(4)}`;
    expect((await createRequest(w.deps, "shop", { code: spaced, ...ask })).ok).toBe(true);
  });

  it("refuses a bad or unknown code, a bad amount, a bad name, and one over the limit", async () => {
    const w = await world();
    expect(await createRequest(w.deps, "shop", { code: "12", ...ask })).toMatchObject({ ok: false, reason: "bad_code" });
    expect(await createRequest(w.deps, "shop", { code: "123456", ...ask })).toMatchObject({ ok: false, reason: "unknown_code" });
    for (const amountMinor of ["0", "-1", "12.5", "abc", "", 5 as unknown as string]) {
      expect(await createRequest(w.deps, "shop", { code: w.buyerCode, ...ask, amountMinor })).toMatchObject({ ok: false, reason: "bad_amount" });
    }
    expect(await createRequest(w.deps, "shop", { code: w.buyerCode, ...ask, amountMinor: "5000001" })).toMatchObject({ ok: false, reason: "over_limit" });
    for (const shopName of ["", "   ", "x".repeat(41), "<b>hi</b>", 7 as unknown as string]) {
      expect(await createRequest(w.deps, "shop", { code: w.buyerCode, ...ask, shopName })).toMatchObject({ ok: false, reason: "bad_name" });
    }
  });

  it("refuses a shop asking its own user", async () => {
    const w = await world();
    expect(await createRequest(w.deps, "buyer", { code: w.buyerCode, ...ask })).toMatchObject({ ok: false, reason: "self_request" });
  });

  it("limits a shop to 10 requests a minute, across different customers", async () => {
    const w = await world();
    for (let i = 0; i < 10; i++) {
      const code = await getPayCode(w.store, `b${i}`);
      expect((await createRequest(w.deps, "shop", { code, ...ask })).ok).toBe(true);
    }
    const code = await getPayCode(w.store, "b11");
    expect(await createRequest(w.deps, "shop", { code, ...ask })).toMatchObject({ ok: false, reason: "too_many_requests" });
    w.tick(61_000);
    expect((await createRequest(w.deps, "shop", { code, ...ask })).ok).toBe(true);
  });

  it("lets one customer have 3 open requests at most, and frees a slot when one ends", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await createRequest(w.deps, `shop${i}`, { code: w.buyerCode, ...ask });
      if (!r.ok) throw new Error("setup");
      ids.push(r.request.id);
    }
    expect(await createRequest(w.deps, "shop9", { code: w.buyerCode, ...ask })).toMatchObject({ ok: false, reason: "buyer_busy" });
    await declineRequest(w.deps, "buyer", ids[0]);
    expect((await createRequest(w.deps, "shop9", { code: w.buyerCode, ...ask })).ok).toBe(true);
  });

  it("audits request_created with ids only, no name, amount or code", async () => {
    const w = await world();
    await createRequest(w.deps, "shop", { code: w.buyerCode, ...ask });
    const rows = await recentAudit(w.store, "shop", 5);
    expect(rows[0]).toMatchObject({ event: "request_created", outcome: "ok" });
    const text = JSON.stringify(rows);
    expect(text).not.toContain("Mama Put");
    expect(text).not.toContain("200000");
    expect(text).not.toContain(w.buyerCode);
  });
});

describe("shop status", () => {
  it("only the shop that asked can see it, and it turns expired after 5 minutes", async () => {
    const w = await world();
    const r = await createRequest(w.deps, "shop", { code: w.buyerCode, ...ask });
    if (!r.ok) throw new Error("setup");
    expect(await shopStatus(w.deps, "shop", r.request.id)).toMatchObject({ ok: true, status: "pending", ref: r.request.ref });
    expect(await shopStatus(w.deps, "buyer", r.request.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await shopStatus(w.deps, "shop", "sr_nope")).toEqual({ ok: false, reason: "not_found" });
    w.tick(REQUEST_TTL_MS + 1);
    expect(await shopStatus(w.deps, "shop", r.request.id)).toMatchObject({ ok: true, status: "expired" });
    expect((await recentAudit(w.store, "shop", 10)).map((e) => e.event)).toContain("request_expired");
  });
});

describe("buyer side", () => {
  it("lists only this buyer's open requests, marks them shown once, hides expired ones", async () => {
    const w = await world();
    const r = await createRequest(w.deps, "shop", { code: w.buyerCode, ...ask });
    if (!r.ok) throw new Error("setup");
    const list = await pendingFor(w.deps, "buyer");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: r.request.id, shopName: "Mama Put", amountMinor: "200000", assetCode: "NGN", assetScale: 2, note: "Rice and stew" });
    expect(list[0]).not.toHaveProperty("shopUserId");
    expect(await pendingFor(w.deps, "someone-else")).toEqual([]);
    await pendingFor(w.deps, "buyer");
    const shown = (await recentAudit(w.store, "buyer", 10)).filter((e) => e.event === "request_shown");
    expect(shown).toHaveLength(1);
    w.tick(REQUEST_TTL_MS + 1);
    expect(await pendingFor(w.deps, "buyer")).toEqual([]);
  });

  it("decline marks declined; another user cannot decline; a declined request cannot be paid", async () => {
    const w = await world();
    const r = await createRequest(w.deps, "shop", { code: w.buyerCode, ...ask });
    if (!r.ok) throw new Error("setup");
    expect(await declineRequest(w.deps, "intruder", r.request.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await declineRequest(w.deps, "buyer", r.request.id)).toEqual({ ok: true });
    expect(await shopStatus(w.deps, "shop", r.request.id)).toMatchObject({ status: "declined" });
    expect(await claimForPayment(w.deps, "buyer", r.request.id, "req_a")).toMatchObject({ ok: false, reason: "request_closed" });
    expect((await recentAudit(w.store, "buyer", 10)).map((e) => e.event)).toContain("request_declined");
  });
});

describe("paying a request", () => {
  async function open() {
    const w = await world();
    const r = await createRequest(w.deps, "shop", { code: w.buyerCode, ...ask });
    if (!r.ok) throw new Error("setup");
    return { ...w, id: r.request.id };
  }

  it("claims for the buyer only, once, and refuses an expired request", async () => {
    const w = await open();
    expect(await claimForPayment(w.deps, "intruder", w.id, "req_a")).toMatchObject({ ok: false, reason: "request_gone" });
    expect(await claimForPayment(w.deps, "buyer", "sr_nope", "req_a")).toMatchObject({ ok: false, reason: "request_gone" });
    const c = await claimForPayment(w.deps, "buyer", w.id, "req_a");
    expect(c).toMatchObject({ ok: true });
    if (c.ok) expect(c.request).toMatchObject({ amountMinor: "200000", shopName: "Mama Put" });
    // a second payment attempt for the same request cannot run at the same time
    expect(await claimForPayment(w.deps, "buyer", w.id, "req_b")).toMatchObject({ ok: false, reason: "request_closed" });
    await releaseClaim(w.deps, w.id, "req_a");
    expect(await claimForPayment(w.deps, "buyer", w.id, "req_b")).toMatchObject({ ok: true });
    w.tick(REQUEST_TTL_MS + 1);
    await releaseClaim(w.deps, w.id, "req_b");
    expect(await claimForPayment(w.deps, "buyer", w.id, "req_c")).toMatchObject({ ok: false, reason: "request_expired" });
  });

  it("markPaid sets paid once and the shop sees it", async () => {
    const w = await open();
    await claimForPayment(w.deps, "buyer", w.id, "req_a");
    await markPaid(w.deps, "buyer", w.id, "req_a");
    expect(await shopStatus(w.deps, "shop", w.id)).toMatchObject({ status: "paid" });
    expect(await claimForPayment(w.deps, "buyer", w.id, "req_b")).toMatchObject({ ok: false, reason: "request_closed" });
    expect((await recentAudit(w.store, "buyer", 10)).filter((e) => e.event === "request_paid")).toHaveLength(1);
  });

  it("cannot decline while a payment is being approved", async () => {
    const w = await open();
    await claimForPayment(w.deps, "buyer", w.id, "req_a");
    expect(await declineRequest(w.deps, "buyer", w.id)).toEqual({ ok: false, reason: "request_closed" });
  });
});
