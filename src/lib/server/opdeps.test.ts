import { beforeAll, describe, expect, it } from "vitest";
import { open } from "../secret";
import type { Amount } from "../money";
import { OpError, type PaymentsGateway, type WalletInfo } from "../op/types";
import { MemoryStore } from "../store/memory";
import { koboToUsdCents, opPayDeps, saveGrant, type GrantRecord } from "./opdeps";

const RAW_ACCESS = "raw-access-token-AAAA";
const RAW_CONTINUE = "raw-continue-token-BBBB";

const wallet = (id: string, assetCode = "USD", assetScale = 2): WalletInfo => ({
  id, assetCode, assetScale, authServer: `${id}/auth`, resourceServer: `${id}/rs`,
});

function fakes(over: { receiver?: WalletInfo; payOutcome?: () => unknown; rotate?: boolean } = {}) {
  const calls: Record<"incoming" | "quote" | "outgoing" | "rotate" | "poll", unknown[]> = { incoming: [], quote: [], outgoing: [], rotate: [], poll: [] };
  const receiver = over.receiver ?? wallet("https://w.test/receiver");
  const payer = wallet("https://w.test/payer");
  const merchant = {
    simulated: false,
    getWallet: async () => receiver,
    createIncomingPayment: async (a: { amount: Amount; expiresAt: string }) => (calls.incoming.push(a), { id: "https://w.test/receiver/incoming-payments/ip1", walletAddress: receiver.id, receivedAmount: { ...a.amount, value: "0" }, completed: false }),
  } as unknown as PaymentsGateway;
  const walletGw = {
    simulated: false,
    getWallet: async () => payer,
    createQuote: async (a: { incomingPaymentUrl: string }) => (calls.quote.push(a), { id: "https://w.test/payer/quotes/q1", debitAmount: { value: "372", assetCode: "USD", assetScale: 2 }, receiveAmount: { value: "369", assetCode: "USD", assetScale: 2 } }),
    rotateToken: async (a: unknown) => (calls.rotate.push(a), { accessToken: "rotated-token-CCCC", manageUrl: "https://w.test/token/2", expiresIn: 600 }),
    createOutgoingPayment: async (a: { accessToken: string }) => {
      calls.outgoing.push(a);
      if (over.payOutcome) throw over.payOutcome();
      return { id: "https://w.test/payer/outgoing-payments/op1", failed: false, debitAmount: { value: "372", assetCode: "USD", assetScale: 2 }, receiveAmount: { value: "369", assetCode: "USD", assetScale: 2 }, sentAmount: { value: "0", assetCode: "USD", assetScale: 2 } };
    },
    getOutgoingPayment: async () => {
      calls.poll.push(1);
      const sent = calls.poll.length >= 2 ? "369" : "0";
      return { id: "https://w.test/payer/outgoing-payments/op1", failed: false, debitAmount: { value: "372", assetCode: "USD", assetScale: 2 }, receiveAmount: { value: "369", assetCode: "USD", assetScale: 2 }, sentAmount: { value: sent, assetCode: "USD", assetScale: 2 } };
    },
  } as unknown as PaymentsGateway;
  return { merchant, walletGw, calls };
}

let t = 1_000_000;
const build = (store: MemoryStore, f: ReturnType<typeof fakes>) =>
  opPayDeps({ store, merchant: f.merchant, wallet: f.walletGw, receiverUrl: "https://w.test/receiver", payerUrl: "https://w.test/payer", now: () => t, sleep: async () => { t += 1000; } });

const grant = async (store: MemoryStore, expiresAt?: number) =>
  saveGrant(store, "u1", { accessToken: RAW_ACCESS, manageUrl: "https://w.test/token/1", continueUri: "https://w.test/continue", continueToken: RAW_CONTINUE, expiresAt, cap: { value: "5000", assetCode: "USD", assetScale: 2 }, interval: "R/2026-11-27T00:00:00Z/P1W" });

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
});

describe("naira kobo to dollar cents (integers, nearest cent, half up, minimum 1)", () => {
  it("converts at the CBN rate", () => {
    expect(koboToUsdCents(135397n)).toBe(100n); // exactly $1
    expect(koboToUsdCents(500000n)).toBe(369n); // 369.28
    expect(koboToUsdCents(1n)).toBe(1n); // minimum one cent
    expect(koboToUsdCents(1000n)).toBe(1n); // 0.74 rounds up to 1
  });
  it("rounds to the nearest cent, half up", () => {
    expect(koboToUsdCents(2030n)).toBe(1n); // 1.4993 cents
    expect(koboToUsdCents(2031n)).toBe(2n); // 1.5001 cents
    expect(koboToUsdCents(4062n)).toBe(3n); // 3.0 -> 2.9997 rounds to 3
  });
});

describe("walletReady", () => {
  it("is false until a grant is stored, true after", async () => {
    const store = new MemoryStore();
    const d = build(store, fakes());
    expect(await d.walletReady("u1")).toBe(false);
    await grant(store);
    expect(await d.walletReady("u1")).toBe(true);
    expect(await d.walletReady("u2")).toBe(false);
  });
});

describe("quote", () => {
  it("creates the incoming payment in cents on the receiver wallet, then quotes from the payer wallet", async () => {
    const f = fakes();
    const d = build(new MemoryStore(), f);
    const q = await d.quote("u1", { id: "c1", name: "Mama Ade" }, "500000");
    expect(f.calls.incoming[0]).toMatchObject({ amount: { value: "369", assetCode: "USD", assetScale: 2 } });
    const exp = Date.parse((f.calls.incoming[0] as { expiresAt: string }).expiresAt);
    expect(exp).toBe(t + 10 * 60_000);
    expect(f.calls.quote[0]).toEqual({ wallet: expect.objectContaining({ id: "https://w.test/payer" }), incomingPaymentUrl: "https://w.test/receiver/incoming-payments/ip1" });
    expect(q).toEqual({ quoteId: "https://w.test/payer/quotes/q1", debit: { value: "372", assetCode: "USD", assetScale: 2 }, simulated: false });
  });

  it("refuses when the receiver wallet is not USD with scale 2", async () => {
    for (const r of [wallet("https://w.test/receiver", "EUR", 2), wallet("https://w.test/receiver", "USD", 6)]) {
      const f = fakes({ receiver: r });
      await expect(build(new MemoryStore(), f).quote("u1", { id: "c1", name: "A" }, "500000")).rejects.toMatchObject({ kind: "invalid_request" });
      expect(f.calls.incoming).toHaveLength(0);
    }
  });
});

describe("pay", () => {
  it("pays with the stored token, polls until the sent amount shows, and returns a real payment", async () => {
    const store = new MemoryStore();
    await grant(store, t + 600_000);
    const f = fakes();
    const r = await build(store, f).pay("u1", "https://w.test/payer/quotes/q1");
    expect(r).toEqual({ paymentId: "https://w.test/payer/outgoing-payments/op1", simulated: false });
    expect(f.calls.outgoing[0]).toMatchObject({ accessToken: RAW_ACCESS, quoteId: "https://w.test/payer/quotes/q1" });
    expect(f.calls.rotate).toHaveLength(0);
    expect(f.calls.poll.length).toBeGreaterThanOrEqual(2);
  });

  it("rotates an expired token first, uses the new one and stores it sealed", async () => {
    const store = new MemoryStore();
    await grant(store, t - 1);
    const f = fakes();
    await build(store, f).pay("u1", "q");
    expect(f.calls.rotate[0]).toEqual({ manageUrl: "https://w.test/token/1", accessToken: RAW_ACCESS });
    expect(f.calls.outgoing[0]).toMatchObject({ accessToken: "rotated-token-CCCC" });
    const g = await store.get<GrantRecord>("grants", "u1");
    expect(open(g!.accessToken)).toBe("rotated-token-CCCC");
    expect(g!.manageUrl).toBe("https://w.test/token/2");
  });

  it("without a connected wallet it throws grant_rejected and sends nothing", async () => {
    const f = fakes();
    await expect(build(new MemoryStore(), f).pay("u1", "q")).rejects.toMatchObject({ kind: "grant_rejected" });
    expect(f.calls.outgoing).toHaveLength(0);
  });

  it("passes the wallet's over-the-limit refusal through as limit_exceeded", async () => {
    const store = new MemoryStore();
    await grant(store, t + 600_000);
    const f = fakes({ payOutcome: () => new OpError("limit_exceeded", "over") });
    await expect(build(store, f).pay("u1", "q")).rejects.toMatchObject({ kind: "limit_exceeded" });
  });

  it("a payment the wallet marks failed is an error", async () => {
    const store = new MemoryStore();
    await grant(store, t + 600_000);
    const f = fakes();
    (f.walletGw as unknown as { getOutgoingPayment: unknown }).getOutgoingPayment = async () => ({ id: "x", failed: true, sentAmount: { value: "0", assetCode: "USD", assetScale: 2 } });
    await expect(build(store, f).pay("u1", "q")).rejects.toBeInstanceOf(OpError);
  });
});

describe("tokens are sealed in the store", () => {
  it("the raw access and continue tokens never appear in the stored data", async () => {
    const store = new MemoryStore();
    await grant(store, t + 600_000);
    const dump = JSON.stringify(store.dump());
    expect(dump).not.toContain(RAW_ACCESS);
    expect(dump).not.toContain(RAW_CONTINUE);
    const g = await store.get<GrantRecord>("grants", "u1");
    expect(open(g!.accessToken)).toBe(RAW_ACCESS);
    expect(open(g!.continueToken)).toBe(RAW_CONTINUE);
  });
});
