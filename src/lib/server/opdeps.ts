// The REAL Open Payments rail for the payment flow, built from injected gateways so it can be tested
// without the network. All three demo contacts pay the ONE receiver wallet (RECEIVER_*): the test
// network has no per-contact wallets, so the contact name is only the label the person hears.
import { NGN_PER_USD_KOBO } from "../money";
import { OpError, type PaymentsGateway } from "../op/types";
import { open } from "../secret";
import type { Store } from "../store";
import type { PayDeps } from "./payflow";
import { loadGrant, saveGrant } from "./walletgrant";

export { saveGrant, type GrantRecord } from "./walletgrant";

/** Naira kobo to US cents, integer math, nearest cent (half up), never below 1 cent. */
export function koboToUsdCents(kobo: bigint): bigint {
  const cents = (kobo * 100n * 2n + NGN_PER_USD_KOBO) / (NGN_PER_USD_KOBO * 2n);
  return cents < 1n ? 1n : cents;
}

const INCOMING_TTL_MS = 10 * 60_000;
const POLL_MS = 1000;
const POLL_TOTAL_MS = 8000;
const REFRESH_EARLY_MS = 5000;

export function opPayDeps(a: {
  store: Store;
  merchant: PaymentsGateway;
  wallet: PaymentsGateway;
  receiverUrl: string;
  payerUrl: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Required<Pick<PayDeps, "quote" | "pay" | "walletReady">> {
  const now = () => a.now?.() ?? Date.now();
  const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return {
    walletReady: async (userId) => (await a.store.get("grants", userId)) !== null,

    quote: async (_userId, payee, amountMinor) => {
      const receiver = await a.merchant.getWallet(a.receiverUrl);
      if (receiver.assetCode !== "USD" || receiver.assetScale !== 2) throw new OpError("invalid_request", "The receiving wallet is not a USD wallet with 2 decimals.");
      const cents = koboToUsdCents(BigInt(amountMinor));
      const incoming = await a.merchant.createIncomingPayment({
        wallet: receiver,
        amount: { value: cents.toString(), assetCode: "USD", assetScale: 2 },
        expiresAt: new Date(now() + INCOMING_TTL_MS).toISOString(),
        description: `Pay Alone test payment to ${payee.name}`,
      });
      const payer = await a.wallet.getWallet(a.payerUrl);
      const q = await a.wallet.createQuote({ wallet: payer, incomingPaymentUrl: incoming.id });
      return { quoteId: q.id, debit: q.debitAmount, simulated: false };
    },

    pay: async (userId, quoteId) => {
      const g = await loadGrant(a.store, userId);
      if (!g) throw new OpError("grant_rejected", "No wallet is connected.");
      let token = g.token;
      if (g.expiresAt !== undefined && now() >= g.expiresAt - REFRESH_EARLY_MS) {
        const r = await a.wallet.rotateToken({ manageUrl: g.manageUrl, accessToken: token });
        token = r.accessToken;
        await saveGrant(a.store, userId, {
          accessToken: r.accessToken,
          manageUrl: r.manageUrl,
          continueUri: g.continueUri,
          continueToken: open(g.continueToken),
          expiresAt: r.expiresIn ? now() + r.expiresIn * 1000 : undefined,
          cap: g.cap,
          interval: g.interval,
        });
      }
      const payer = await a.wallet.getWallet(a.payerUrl);
      const out = await a.wallet.createOutgoingPayment({ wallet: payer, accessToken: token, quoteId, description: "Pay Alone test payment" });
      // Poll (no client webhooks exist) until the wallet reports money sent, up to about 8 seconds.
      const until = now() + POLL_TOTAL_MS;
      let cur = out;
      while (!cur.failed && BigInt(cur.sentAmount.value) === 0n && now() < until) {
        await sleep(POLL_MS);
        cur = await a.wallet.getOutgoingPayment({ url: out.id, accessToken: token });
      }
      if (cur.failed) throw new OpError("unknown", "The wallet marked the payment as failed.");
      return { paymentId: out.id, simulated: false };
    },
  };
}
