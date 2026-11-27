// Wires the payment flow to the real store and sign-in check. Server side only.
import { DEMO_CONTACTS } from "../demo/contacts";
import { gateway, isSimulated } from "../op";
import { normalizeWalletUrl, realConfigured } from "../op/real";
import { randomToken } from "../secret";
import { getStore, storeKind } from "../store";
import type { Verify, VerifyAppCheck } from "./http";
import type { PayDeps } from "./payflow";
import { opPayDeps } from "./opdeps";
import { verifyAppCheckToken, verifyFirebaseIdToken } from "./tokens";

export const serverReady = () => storeKind() !== "none";

// Revocation is not checked; tokens live up to 1 hour.
export const verifyUser: Verify = (idToken) => verifyFirebaseIdToken(idToken);

/** On when APPCHECK_ENFORCE=1 (set once the reCAPTCHA key is registered). */
export function appCheckGate(): VerifyAppCheck | undefined {
  if (process.env.APPCHECK_ENFORCE !== "1") return undefined;
  return async (token) => {
    if (!token) throw new Error("no App Check token");
    await verifyAppCheckToken(token);
  };
}

/** The real Open Payments rail needs both wallets configured and the simulated wallet off. */
export function realRail(): boolean {
  return !isSimulated() && realConfigured("merchant") && realConfigured("wallet");
}

export const payerUrl = () => normalizeWalletUrl(process.env.PAYER_WALLET_ADDRESS_URL ?? "");
export const weeklyCapMinor = () => {
  const n = Number(process.env.WEEKLY_CAP_MINOR);
  return Number.isSafeInteger(n) && n > 0 ? n : 5000; // 5000 = $50.00 on a USD wallet with 2 decimals
};

export function payDeps(req: Request): PayDeps {
  const store = getStore();
  const base: PayDeps = {
    store,
    baseUrl: new URL(req.url).origin,
    limitMinor: Number(process.env.VOICE_LIMIT_MINOR ?? 5_000_000),
    contacts: async () => DEMO_CONTACTS.map((c) => ({ ...c })),
    // SIMULATED unless the real rail is configured: no fee, nothing leaves any wallet.
    quote: async (_u, _payee, amountMinor) => ({ quoteId: `simq_${randomToken(9)}`, debit: { value: amountMinor, assetCode: "NGN", assetScale: 2 }, simulated: true }),
    pay: async (_u, quoteId) => ({ paymentId: `simp_${quoteId}`, simulated: true }),
  };
  if (!realRail()) return base;
  return {
    ...base,
    ...opPayDeps({
      store,
      merchant: gateway("merchant"),
      wallet: gateway("wallet"),
      receiverUrl: normalizeWalletUrl(process.env.RECEIVER_WALLET_ADDRESS_URL ?? ""),
      payerUrl: payerUrl(),
    }),
  };
}
