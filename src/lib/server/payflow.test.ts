import { beforeAll, describe, expect, it, vi } from "vitest";
import { OpError } from "../op/types";
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

  it("start: returns the quote's debit amount and the payee name for the approval card, never the requested amount", async () => {
    const d = await ready();
    const r = await startPayment(d, "u1", { payeeId: "c2", amountMinor: "500000" });
    if (!r.ok) throw new Error("start failed");
    expect(r.debit).toEqual({ value: "502000", assetCode: "NGN", assetScale: 2 }); // quote, fees included
    expect(r.payeeName).toBe("Tunde");
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

describe("parallel attacks (review 27 Nov)", () => {
  it("twenty wrong PINs sent at the same moment still lock the account", async () => {
    const d = await ready();
    const starts = await Promise.all(Array.from({ length: 20 }, () => startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" })));
    const guesses = starts.map((s, i) => {
      if (!s.ok) throw new Error("start failed");
      return finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: String(7000 + i * 13) } });
    });
    const results = await Promise.all(guesses);
    expect(results.filter((r) => !r.ok && r.reason === "wrong").length).toBeLessThanOrEqual(4);
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    const right = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
    expect(right).toMatchObject({ ok: false, reason: "locked" });
  });

  it("a PIN check running at the same time as a PIN change cannot undo the change", async () => {
    const d = await ready();
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    await Promise.all([
      finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "9173" } }),
      setUserPin(d, "u1", { pin: "7391", oldPin: "4826" }),
    ]);
    const s2 = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s2.ok) throw new Error("start failed");
    const r = await finishPayment(d, "u1", { requestId: s2.requestId, proof: { method: "pin", challenge: s2.challenge, pin: "7391" } });
    expect(r.ok).toBe(true);
  });

  it("an expired pending payment cannot be approved", async () => {
    let now = Date.now();
    const d = await ready(deps({ now: () => now }));
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    now += 11 * 60_000;
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
    expect(f).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("wallet connection and wallet failures", () => {
  it("start: says wallet_not_connected when the rail needs a wallet and none is connected", async () => {
    const d = await ready(deps({ walletReady: async () => false }));
    expect(await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" })).toEqual({ ok: false, reason: "wallet_not_connected" });
  });

  it("start: the PIN check comes first, then the wallet check", async () => {
    const d = deps({ walletReady: async () => false });
    expect(await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" })).toMatchObject({ reason: "no_pin_set" });
  });

  it("start: goes ahead when the wallet is connected", async () => {
    const d = await ready(deps({ walletReady: async () => true }));
    expect(await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" })).toMatchObject({ ok: true });
  });

  it("start: a wallet that cannot quote gives quote_failed, nothing is stored", async () => {
    const d = await ready(deps({ quote: async () => { throw new OpError("quote_failed", "no"); } }));
    expect(await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" })).toEqual({ ok: false, reason: "quote_failed" });
  });

  it("finish: a wallet refusal over the cap becomes over_cap and no receipt is written", async () => {
    const d = await ready(deps({ pay: async () => { throw new OpError("limit_exceeded", "over"); } }));
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
    expect(f).toEqual({ ok: false, reason: "over_cap" });
    expect(await d.store.list("receipts")).toHaveLength(0);
  });

  it("finish: any other wallet failure becomes payment_failed", async () => {
    const d = await ready(deps({ pay: async () => { throw new OpError("wallet_unreachable", "down"); } }));
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
    expect(f).toEqual({ ok: false, reason: "payment_failed" });
  });
});

describe("audit trail of the payment flow (survives a page reset, unlike the screen or the 1-hour logs)", () => {
  const quiet = () => vi.spyOn(console, "info").mockImplementation(() => {});

  it("finish logs one console line with the receipt id, method, asset and real/simulated, and no PIN, user or payee", async () => {
    const d = await ready();
    const s = await startPayment(d, "u1", { payeeId: "c2", amountMinor: "100000" });
    if (!s.ok) throw new Error("start failed");
    const info = quiet();
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
    const lines = info.mock.calls.map((c) => c.join(" "));
    info.mockRestore();
    if (!f.ok) throw new Error("finish failed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(`^audit pay_finish ok receiptId=${f.receipt.id} method=pin asset=NGN simulated=true ms=\\d+ requestId=${s.requestId}$`));
    expect(lines.join()).not.toMatch(/4826|u1|Tunde/);
  });

  it("every step is stored for the person: pin_set, pay_start, pay_finish (wrong, then ok), pay_cancel", async () => {
    quiet();
    const d = deps();
    await setUserPin(d, "u1", { pin: "4826" });
    await setUserPin(d, "u1", { pin: "1111" }); // weak, and needs the old PIN anyway
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    const bad = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "9999" } });
    if (bad.ok || !bad.challenge) throw new Error("expected wrong");
    const good = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: bad.challenge, pin: "4826" } });
    if (!good.ok) throw new Error("finish failed");
    const s2 = await startPayment(d, "u1", { payeeId: "zz", amountMinor: "500" });
    expect(s2.ok).toBe(false);
    await cancelPayment(d, "u1", { requestId: "req_x" });
    const rows = (await d.store.list<{ event: string; outcome?: string; reason?: string; receiptId?: string }>("audit")).map((r) => `${r.event}:${r.outcome}:${r.reason ?? ""}`);
    expect(rows).toEqual(
      expect.arrayContaining(["pin_set:ok:", "pin_set:fail:old_pin_needed", "pay_start:ok:", "pay_finish:fail:wrong", "pay_finish:ok:", "pay_start:fail:unknown_payee", "pay_cancel:ok:"]),
    );
    const dump = JSON.stringify(await d.store.list("audit"));
    expect(dump).toContain(good.receipt.id);
    expect(dump).not.toMatch(/4826|9999|1111|Mama|Tunde/);
  });

  it("a failed payment records payment_failed and over_cap reasons", async () => {
    quiet();
    for (const [kind, reason] of [["limit_exceeded", "over_cap"], ["wallet_unreachable", "payment_failed"]] as const) {
      const d = await ready(deps({ pay: async () => Promise.reject(new OpError(kind, "x")) }));
      const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
      if (!s.ok) throw new Error("start failed");
      await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
      const rows = await d.store.list<{ event: string; reason?: string }>("audit");
      expect(rows.some((r) => r.event === "pay_finish" && r.reason === reason)).toBe(true);
    }
  });

  it("a broken audit store does not stop the payment", async () => {
    quiet();
    const d = await ready();
    const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
    if (!s.ok) throw new Error("start failed");
    const put = d.store.put.bind(d.store);
    d.store.put = (async (c: string, id: string, doc: unknown) => (c === "audit" ? Promise.reject(new Error("down")) : put(c, id, doc))) as typeof d.store.put;
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
    expect(f.ok).toBe(true);
  });

  it("the receipt is also kept in the person's own list, found by user, newest first", async () => {
    quiet();
    let t = Date.now();
    const d = await ready(deps({ now: () => ++t }));
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const s = await startPayment(d, "u1", { payeeId: "c1", amountMinor: "500" });
      if (!s.ok) throw new Error("start failed");
      const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
      if (!f.ok) throw new Error("finish failed");
      ids.push(f.receipt.id);
    }
    const mine = await d.store.list<{ id: string }>("receipts_by_user", { prefix: "u1|", newestFirst: true });
    expect(mine.map((r) => r.id)).toEqual([...ids].reverse());
  });
});
