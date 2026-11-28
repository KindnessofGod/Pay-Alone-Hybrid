// Paying a shop's request through the normal payment flow: the server takes amount and payee from the request.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory";
import { OpError } from "../op/types";
import { recentAudit } from "./audit";
import { finishPayment, setUserPin, startPayment, type PayDeps } from "./payflow";
import { REQUEST_TTL_MS, createRequest, declineRequest, getPayCode, shopStatus } from "./seller";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
  vi.spyOn(console, "info").mockImplementation(() => {});
});

function setup(over: Partial<PayDeps> = {}) {
  let t = 5_000_000;
  const quoted: { payee: string; amount: string }[] = [];
  const d: PayDeps = {
    store: new MemoryStore(),
    baseUrl: "https://pay-alone-hybrid.vercel.app",
    limitMinor: 5_000_000,
    now: () => t,
    contacts: async () => [{ id: "c1", name: "Mama Ade" }],
    quote: async (_u, payee, amountMinor) => (quoted.push({ payee: payee.name, amount: amountMinor }), { quoteId: `q${quoted.length}`, debit: { value: amountMinor, assetCode: "NGN", assetScale: 2 }, simulated: true }),
    pay: async (_u, quoteId) => ({ paymentId: `p-${quoteId}`, simulated: true }),
    ...over,
  };
  return { d, quoted, tick: (ms: number) => (t += ms) };
}

async function openRequest(s: ReturnType<typeof setup>) {
  await setUserPin(s.d, "buyer", { pin: "4826" });
  const code = await getPayCode(s.d.store, "buyer");
  const r = await createRequest({ store: s.d.store, limitMinor: s.d.limitMinor, now: s.d.now }, "shop", { code, amountMinor: "200000", shopName: "Mama Put" });
  if (!r.ok) throw new Error("setup");
  return r.request;
}
const pin = (st: { requestId: string; challenge: string }, p = "4826") => ({ requestId: st.requestId, proof: { method: "pin", challenge: st.challenge, pin: p } });

describe("paying a shop request", () => {
  it("start takes amount and payee FROM THE REQUEST, whatever the client sends", async () => {
    const s = setup();
    const req = await openRequest(s);
    const st = await startPayment(s.d, "buyer", { shopRequestId: req.id, payeeId: "c1", amountMinor: "1" });
    if (!st.ok) throw new Error(`start failed ${JSON.stringify(st)}`);
    expect(s.quoted).toEqual([{ payee: "Mama Put", amount: "200000" }]);
    expect(st.payeeName).toBe("Mama Put");
    expect(st.debit.value).toBe("200000");
    expect(st.readBack).toContain("2,000 naira");
  });

  it("works with no payeeId or amount from the client at all", async () => {
    const s = setup();
    const req = await openRequest(s);
    expect((await startPayment(s.d, "buyer", { shopRequestId: req.id })).ok).toBe(true);
  });

  it("refuses an unknown request, someone else's request, a declined one and an expired one", async () => {
    const s = setup();
    const req = await openRequest(s);
    await setUserPin(s.d, "other", { pin: "7391" });
    expect(await startPayment(s.d, "buyer", { shopRequestId: "sr_nothere1" })).toMatchObject({ ok: false, reason: "request_gone" });
    expect(await startPayment(s.d, "other", { shopRequestId: req.id })).toMatchObject({ ok: false, reason: "request_gone" });
    expect(s.quoted).toHaveLength(0);

    const sd = { store: s.d.store, limitMinor: s.d.limitMinor, now: s.d.now };
    await declineRequest(sd, "buyer", req.id);
    expect(await startPayment(s.d, "buyer", { shopRequestId: req.id })).toMatchObject({ ok: false, reason: "request_closed" });

    const s2 = setup();
    const r2 = await openRequest(s2);
    s2.tick(REQUEST_TTL_MS + 1);
    expect(await startPayment(s2.d, "buyer", { shopRequestId: r2.id })).toMatchObject({ ok: false, reason: "request_expired" });
  });

  it("a wrong PIN does not mark the request paid; the right approval does, with receipt and spoken line", async () => {
    const s = setup();
    const req = await openRequest(s);
    const st = await startPayment(s.d, "buyer", { shopRequestId: req.id });
    if (!st.ok) throw new Error("start");
    const bad = await finishPayment(s.d, "buyer", pin(st, "9173"));
    if (bad.ok || !bad.challenge) throw new Error("expected a retry");
    expect(await shopStatus({ store: s.d.store, limitMinor: 1, now: s.d.now }, "shop", req.id)).toMatchObject({ status: "pending" });

    const ok = await finishPayment(s.d, "buyer", pin({ requestId: st.requestId, challenge: bad.challenge }));
    if (!ok.ok) throw new Error("finish");
    expect(ok.spoken).toBe(`Simulated payment, no real money moved. Paid Mama Put, reference ${req.ref}. 2,000 naira. Receipt saved.`);
    expect(ok.receipt).toMatchObject({ payeeName: "Mama Put", ref: req.ref, shopRequestId: req.id, debit: { value: "200000" } });
    expect(await shopStatus({ store: s.d.store, limitMinor: 1, now: s.d.now }, "shop", req.id)).toMatchObject({ status: "paid" });
    const events = (await recentAudit(s.d.store, "buyer", 20)).map((e) => e.event);
    expect(events).toContain("request_paid");
    expect(JSON.stringify(await recentAudit(s.d.store, "buyer", 20))).not.toContain("Mama Put");
  });

  it("a request is paid once: a second payment for it is refused and the wallet is not called", async () => {
    let paid = 0;
    const s = setup({ pay: async () => (paid++, { paymentId: "x", simulated: true }) });
    const req = await openRequest(s);
    const a = await startPayment(s.d, "buyer", { shopRequestId: req.id });
    const b = await startPayment(s.d, "buyer", { shopRequestId: req.id });
    if (!a.ok || !b.ok) throw new Error("start");
    expect((await finishPayment(s.d, "buyer", pin(a))).ok).toBe(true);
    expect(await finishPayment(s.d, "buyer", pin(b))).toMatchObject({ ok: false, reason: "request_closed" });
    expect(paid).toBe(1);
  });

  it("cannot be paid after the shop request expired while the person was approving", async () => {
    let paid = 0;
    const s = setup({ pay: async () => (paid++, { paymentId: "x", simulated: true }) });
    const req = await openRequest(s);
    s.tick(4 * 60_000); // the request has 1 minute left; the approval challenge lives 3
    const st = await startPayment(s.d, "buyer", { shopRequestId: req.id });
    if (!st.ok) throw new Error("start");
    s.tick(2 * 60_000);
    expect(await finishPayment(s.d, "buyer", pin(st))).toMatchObject({ ok: false, reason: "request_expired" });
    expect(paid).toBe(0);
  });

  it("a failed wallet payment leaves the request open to try again", async () => {
    let fail = true;
    const s = setup({ pay: async (_u, q) => (fail ? Promise.reject(new OpError("unknown", "down")) : { paymentId: `p-${q}`, simulated: true }) });
    const req = await openRequest(s);
    const a = await startPayment(s.d, "buyer", { shopRequestId: req.id });
    if (!a.ok) throw new Error("start");
    expect(await finishPayment(s.d, "buyer", pin(a))).toMatchObject({ ok: false, reason: "payment_failed" });
    expect(await shopStatus({ store: s.d.store, limitMinor: 1, now: s.d.now }, "shop", req.id)).toMatchObject({ status: "pending" });
    fail = false;
    const b = await startPayment(s.d, "buyer", { shopRequestId: req.id });
    if (!b.ok) throw new Error("start 2");
    expect((await finishPayment(s.d, "buyer", pin(b))).ok).toBe(true);
  });

  it("the normal contact payment is unchanged", async () => {
    const s = setup();
    await setUserPin(s.d, "buyer", { pin: "4826" });
    const st = await startPayment(s.d, "buyer", { payeeId: "c1", amountMinor: "500" });
    if (!st.ok) throw new Error("start");
    const f = await finishPayment(s.d, "buyer", pin(st));
    if (!f.ok) throw new Error("finish");
    expect(f.spoken).toBe("Simulated payment, no real money moved. 5 naira to Mama Ade. Receipt saved.");
    expect(f.receipt.ref).toBeUndefined();
  });
});
