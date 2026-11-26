// Wires the payment flow to the real store and sign-in check. Server side only.
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { DEMO_CONTACTS } from "../demo/contacts";
import { randomToken } from "../secret";
import { getStore, storeKind } from "../store";
import { adminApp } from "./admin";
import type { Verify, VerifyAppCheck } from "./http";
import type { PayDeps } from "./payflow";

export const serverReady = () => storeKind() !== "none";

// checkRevoked: a signed-out or revoked token stops working at once.
export const verifyUser: Verify = async (idToken) => (await getAuth(adminApp()).verifyIdToken(idToken, true)).uid;

/** On when APPCHECK_ENFORCE=1 (set once the reCAPTCHA key is registered). */
export function appCheckGate(): VerifyAppCheck | undefined {
  if (process.env.APPCHECK_ENFORCE !== "1") return undefined;
  return async (token) => {
    if (!token) throw new Error("no App Check token");
    await getAppCheck(adminApp()).verifyToken(token);
  };
}

export function payDeps(req: Request): PayDeps {
  return {
    store: getStore(),
    baseUrl: new URL(req.url).origin,
    limitMinor: Number(process.env.VOICE_LIMIT_MINOR ?? 5_000_000),
    contacts: async () => DEMO_CONTACTS.map((c) => ({ ...c })),
    // SIMULATED until the Open Payments test-wallet rail is wired: no fee, nothing leaves any wallet.
    quote: async (_u, _payee, amountMinor) => ({ quoteId: `simq_${randomToken(9)}`, debit: { value: amountMinor, assetCode: "NGN", assetScale: 2 }, simulated: true }),
    pay: async (_u, quoteId) => ({ paymentId: `simp_${quoteId}`, simulated: true }),
  };
}
