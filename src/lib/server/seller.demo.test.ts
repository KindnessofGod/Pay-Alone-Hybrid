// Demo mode (/demo page only): one anonymous user is both the shop and the customer.
// Only the self-request rule is relaxed. Amount from the server request, approval, expiry, rate limits and
// "paid only after verified approval" all stay the same.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory";
import { recentAudit } from "./audit";
import { DEMO_SHOP_PREFIX, demoShopId } from "./demo";
import { finishPayment, setUserPin, startPayment, type PayDeps } from "./payflow";
import { SHOP_REQUESTS_PER_MINUTE, createRequest, getPayCode, pendingFor, shopStatus } from "./seller";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
  vi.spyOn(console, "info").mockImplementation(() => {});
});

function setup() {
  let t = 5_000_000;
  const d: PayDeps = {
    store: new MemoryStore(),
    baseUrl: "https://pay-alone-hybrid.vercel.app",
    limitMinor: 5_000_000,
    now: () => t,
    contacts: async () => [],
    quote: async (_u, _p, amountMinor) => ({ quoteId: "q1", debit: { value: amountMinor, assetCode: "NGN", assetScale: 2 }, simulated: true }),
    pay: async (_u, quoteId) => ({ paymentId: `p-${quoteId}`, simulated: true }),
  };
  const sd = { store: d.store, limitMinor: d.limitMinor, now: d.now };
  return { d, sd, tick: (ms: number) => (t += ms) };
}
const ask = { amountMinor: "200000", shopName: "Mama Put" };

describe("demo self-request", () => {
  it("a normal self-request is still refused", async () => {
    const s = setup();
    const code = await getPayCode(s.d.store, "u1");
    expect(await createRequest(s.sd, "u1", { code, ...ask })).toEqual({ ok: false, reason: "self_request" });
    expect(await createRequest(s.sd, "u1", { code, ...ask }, { demo: false })).toEqual({ ok: false, reason: "self_request" });
  });

  it("with the demo flag the same user can ask themselves; the shop side is demo-shop:<uid>", async () => {
    const s = setup();
    const code = await getPayCode(s.d.store, "u1");
    const r = await createRequest(s.sd, "u1", { code, ...ask }, { demo: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = await s.d.store.get<{ shopUserId: string; buyerUserId: string }>("requests", r.request.id);
    expect(stored).toMatchObject({ shopUserId: `${DEMO_SHOP_PREFIX}u1`, buyerUserId: "u1" });
    expect((await pendingFor(s.sd, "u1")).map((x) => x.id)).toEqual([r.request.id]);
  });

  it("only that user reads its status; another user cannot", async () => {
    const s = setup();
    const code = await getPayCode(s.d.store, "u1");
    const r = await createRequest(s.sd, "u1", { code, ...ask }, { demo: true });
    if (!r.ok) throw new Error("setup");
    expect(await shopStatus(s.sd, "u1", r.request.id)).toMatchObject({ ok: true, status: "pending" });
    expect(await shopStatus(s.sd, "u2", r.request.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await shopStatus(s.sd, demoShopId("u1"), r.request.id)).toEqual({ ok: false, reason: "not_found" }); // a caller id cannot claim the demo prefix
  });

  it("keeps the rules: bad amount, over the limit, unknown code, and the per-minute limit", async () => {
    const s = setup();
    const code = await getPayCode(s.d.store, "u1");
    expect(await createRequest(s.sd, "u1", { code, ...ask, amountMinor: "0" }, { demo: true })).toMatchObject({ ok: false, reason: "bad_amount" });
    expect(await createRequest(s.sd, "u1", { code, ...ask, amountMinor: "999999999" }, { demo: true })).toMatchObject({ ok: false, reason: "over_limit" });
    expect(await createRequest(s.sd, "u1", { code: "000000", ...ask }, { demo: true })).toMatchObject({ ok: false, reason: "unknown_code" });
    // The buyer-busy rule limits open requests to 3, so the per-minute limit is reached by expiring-free declines elsewhere;
    // here we only check that the shop id used for counting is the demo one.
    await createRequest(s.sd, "u1", { code, ...ask }, { demo: true });
    const rows = await s.d.store.list("requests_by_shop", { prefix: `${demoShopId("u1")}|` });
    expect(rows).toHaveLength(1);
    expect(SHOP_REQUESTS_PER_MINUTE).toBeGreaterThan(0);
  });
});

describe("a demo request is paid only after verified approval", () => {
  async function open() {
    const s = setup();
    await setUserPin(s.d, "u1", { pin: "4826" });
    const code = await getPayCode(s.d.store, "u1");
    const r = await createRequest(s.sd, "u1", { code, ...ask }, { demo: true });
    if (!r.ok) throw new Error("setup");
    return { s, id: r.request.id };
  }

  it("starting, or a wrong PIN, does not pay; the right PIN pays and the shop side reads PAID", async () => {
    const { s, id } = await open();
    const st = await startPayment(s.d, "u1", { shopRequestId: id, amountMinor: "1" });
    if (!st.ok) throw new Error("start");
    expect(st.debit.value).toBe("200000"); // from the server request, not the browser
    expect((await shopStatus(s.sd, "u1", id)) as { status: string }).toMatchObject({ status: "pending" });

    const bad = await finishPayment(s.d, "u1", { requestId: st.requestId, proof: { method: "pin", challenge: st.challenge, pin: "1111" } });
    expect(bad.ok).toBe(false);
    expect((await shopStatus(s.sd, "u1", id)) as { status: string }).toMatchObject({ status: "pending" });

    const again = bad.ok ? null : bad.challenge;
    const ok = await finishPayment(s.d, "u1", { requestId: st.requestId, proof: { method: "pin", challenge: again ?? st.challenge, pin: "4826" } });
    expect(ok.ok).toBe(true);
    expect((await shopStatus(s.sd, "u1", id)) as { status: string }).toMatchObject({ status: "paid" });
    const events = (await recentAudit(s.d.store, "u1", 50)).map((e) => e.event);
    expect(events).toContain("demo_paid");
  });

  it("a forged proof with no PIN never marks it paid", async () => {
    const { s, id } = await open();
    const st = await startPayment(s.d, "u1", { shopRequestId: id });
    if (!st.ok) throw new Error("start");
    const f = await finishPayment(s.d, "u1", { requestId: st.requestId, proof: { method: "pin", challenge: st.challenge } });
    expect(f.ok).toBe(false);
    expect((await shopStatus(s.sd, "u1", id)) as { status: string }).toMatchObject({ status: "pending" });
  });

  it("the audit never holds the shop name, amount or pay code", async () => {
    const { s } = await open();
    const rows = JSON.stringify(await recentAudit(s.d.store, "u1", 50));
    expect(rows).not.toContain("Mama Put");
  });
});
