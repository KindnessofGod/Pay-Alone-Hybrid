import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { cancelPayment, finishPayment, setUserPin, startPayment, type PayDeps } from "./payflow";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
});

function deps(over: Partial<PayDeps> = {}): PayDeps {
  let n = 0;
  return {
    store: new MemoryStore(),
    baseUrl: "https://pay-alone-hybrid.vercel.app",
    limitMinor: 5_000_000,
    contacts: async () => [{ id: "c1", name: "Mama Ade" }, { id: "c2", name: "Tunde" }],
    // Quote adds a fee of 2,000 kobo so tests can tell quote amounts from the requested amount.
    quote: async (_u, _payee, amountMinor) => ({ quoteId: `q${++n}`, debit: { value: String(BigInt(amountMinor) + 2000n), assetCode: "NGN", assetScale: 2 }, simulated: true }),
    pay: async (_u, quoteId) => ({ paymentId: `p-${quoteId}`, simulated: true }),
    ...over,
  };
}

async function ready(d = deps()) {
  await setUserPin(d, "u1", { pin: "4826" });
  return d;
}

describe("payment flow on the server", () => {
  it("start: re-checks payee and amount, quotes, and reads back the quote's amount", async () => {
    const d = await ready();
    const r = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500000" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readBack).toContain("5,020 naira"); // from the quote, fees included, not the request
    expect(r.readBack).toContain("Mama Ade");
    expect(r.simulated).toBe(true);
    expect(typeof r.challenge).toBe("string");
  });

  it("start: refuses an unknown payee, a bad amount, or one over the voice limit", async () => {
    const d = await ready();
    expect(await startPayment(d, "u1", { payeeId: "zz", amountMinor: "500" })).toMatchObject({ ok: false, reason: "unknown_payee" });
    for (const amountMinor of ["0", "-5", "12.5", "abc", 500 as unknown as string, ""]) {
      expect(await startPayment(d, "u1", { payeeId: "c1", amountMinor })).toMatchObject({ ok: false, reason: "bad_amount" });
    }
    expect(await startPayment(d, "u1", { payeeId: "c1", amountMinor: "5000001" })).toMatchObject({ ok: false, reason: "over_limit" });
  });

  it("start: refuses when no PIN is set yet", async () => {
    const r = await startPayment(deps(), "u1", { payeeId: "c1", amountMinor: "500" });
    expect(r).toMatchObject({ ok: false, reason: "no_pin_set" });
  });

  it("finish: the right PIN pays the quoted amount and the server writes the receipt", async () => {
    const d = await ready();
    const s = await startPayment(d, "u1", { payeeId: "c2", amountMinor: "100000" });
    if (!s.ok) throw new Error("start failed");
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(f.receipt).toMatchObject({ payeeName: "Tunde", debit: { value: "102000", assetCode: "NGN", assetScale: 2 }, method: "pin", simulated: true, userId: "u1" });
    expect(await d.store.get("receipts", f.receipt.id)).toEqual(f.receipt);
    expect(f.spoken).toBe("Simulated payment, no real money moved. 1,020 naira to Tunde. Receipt saved.");
  });

  it("finish: a tap alone is refused and nothing is paid", async () => {
    let paid = 0;
    const d = await ready(deps({ pay: async () => (paid++, { paymentId: "x", simulated: true }) }));
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "confirm-button", challenge: s.challenge } });
    expect(f).toMatchObject({ ok: false, reason: "tap_not_enough" });
    expect(paid).toBe(0);
  });

  it("finish: a wrong PIN gives a fresh challenge and the tries left; nothing is paid", async () => {
    let paid = 0;
    const d = await ready(deps({ pay: async () => (paid++, { paymentId: "x", simulated: true }) }));
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "9173" } });
    expect(f).toMatchObject({ ok: false, reason: "wrong", triesLeft: 4 });
    if (f.ok || !f.challenge) throw new Error("expected a new challenge");
    expect(f.challenge).not.toBe(s.challenge);
    const g = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: f.challenge, pin: "4826" } });
    expect(g.ok).toBe(true);
    expect(paid).toBe(1);
  });

  it("finish: pays once even if the same approval is sent twice", async () => {
    let paid = 0;
    const d = await ready(deps({ pay: async () => (paid++, { paymentId: "x", simulated: true }) }));
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    const body = { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } };
    const [a, b] = await Promise.all([finishPayment(d, "u1", body), finishPayment(d, "u1", body)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(paid).toBe(1);
  });

  it("finish: another user cannot approve my payment", async () => {
    const d = await ready();
    await setUserPin(d, "u2", { pin: "7391" });
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    const f = await finishPayment(d, "u2", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "7391" } });
    expect(f).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("finish: after lockout no more guesses and no new challenge", async () => {
    const d = await ready();
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    let challenge = s.challenge;
    let last: Awaited<ReturnType<typeof finishPayment>> | undefined;
    for (let i = 0; i < 5; i++) {
      last = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge, pin: "9173" } });
      if (!last.ok && last.challenge) challenge = last.challenge;
    }
    expect(last).toMatchObject({ ok: false, reason: "locked" });
    expect(last && !last.ok && last.challenge).toBeFalsy();
  });

  it("cancel: removes the pending payment so it cannot be approved later", async () => {
    const d = await ready();
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    await cancelPayment(d, "u1", { requestId: s.requestId });
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
    expect(f).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("PIN: set once; changing it needs the old PIN", async () => {
    const d = await ready();
    expect(await setUserPin(d, "u1", { pin: "7391" })).toMatchObject({ ok: false, reason: "old_pin_needed" });
    expect(await setUserPin(d, "u1", { pin: "7391", oldPin: "1111" })).toMatchObject({ ok: false });
    expect(await setUserPin(d, "u1", { pin: "7391", oldPin: "4826" })).toEqual({ ok: true });
    expect(await setUserPin(deps(), "u9", { pin: "1234" })).toMatchObject({ ok: false, reason: "weak_pin" });
  });

  it("never stores or returns the PIN in plain form", async () => {
    const d = await ready();
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
    expect(JSON.stringify(f)).not.toContain("4826");
    expect(JSON.stringify((d.store as MemoryStore).dump())).not.toContain("4826");
  });
});
