// Server-side approval of ONE payment (red-team #1). The browser can ask, only this code can say yes.
// - A tap on its own is never approval.
// - Proof is the app PIN (checked with stored lockout in pin.ts) or a passkey signature (passkey.ts).
// - The challenge is bound to this request, quote and amount (approval.ts) and works once: it is
//   taken out of the store before the proof is checked, so a replay or a second guess fails.
// - The answer never contains the PIN.
import { challengeIsValid, type ApprovalChallenge, type ApprovalSubject } from "../approval";
import { verifyPasskeySignature, type StoredPasskey } from "../passkey";
import { checkPin, type PinStore } from "./pin";

export interface ChallengeStore {
  put(userId: string, subject: ApprovalSubject, issued: ApprovalChallenge): Promise<void>;
  /** Returns the challenge and removes it, so it can be used once. */
  take(userId: string, subject: ApprovalSubject): Promise<ApprovalChallenge | undefined>;
}

export type Approval =
  | { ok: true; method: "pin" | "passkey"; passkeyId?: string; newCounter?: number }
  | { ok: false; reason: "bad_proof" | "tap_not_enough" | "bad_challenge" | "no_pin_set" | "wrong" | "locked" | "bad_passkey"; triesLeft?: number };

const key = (userId: string, s: ApprovalSubject) => `${userId}|${s.requestId}`;

export function memoryChallenges(): ChallengeStore {
  const m = new Map<string, ApprovalChallenge>();
  return {
    put: async (u, s, c) => void m.set(key(u, s), c),
    take: async (u, s) => {
      const c = m.get(key(u, s));
      m.delete(key(u, s));
      return c;
    },
  };
}

export async function approvePayment(args: {
  userId: string;
  subject: ApprovalSubject;
  proof: unknown;
  pins: PinStore;
  challenges: ChallengeStore;
  passkeys: StoredPasskey[];
  baseUrl: string;
  now?: number;
}): Promise<Approval> {
  const now = args.now ?? Date.now();
  const p = args.proof;
  if (!p || typeof p !== "object") return { ok: false, reason: "bad_proof" };
  const { method, challenge } = p as { method?: unknown; challenge?: unknown };
  if (method === "confirm-button") return { ok: false, reason: "tap_not_enough" };
  if (method !== "pin" && method !== "passkey") return { ok: false, reason: "bad_proof" };
  const pin = (p as { pin?: unknown }).pin;
  if (method === "pin" && (typeof pin !== "string" || !/^\d{4,6}$/.test(pin))) return { ok: false, reason: "bad_proof" };

  const issued = await args.challenges.take(args.userId, args.subject);
  if (!challengeIsValid(args.subject, issued, challenge, now)) return { ok: false, reason: "bad_challenge" };

  if (method === "pin") {
    const r = await checkPin(args.pins, args.userId, pin as string, now);
    if (r.ok) return { ok: true, method: "pin" };
    return r.triesLeft === undefined ? { ok: false, reason: r.reason } : { ok: false, reason: r.reason, triesLeft: r.triesLeft };
  }

  const v = await verifyPasskeySignature({
    baseUrl: args.baseUrl,
    approvalChallenge: challenge as string,
    passkeys: args.passkeys,
    response: (p as { response?: unknown }).response,
  });
  return v.ok ? { ok: true, method: "passkey", passkeyId: v.passkeyId, newCounter: v.newCounter } : { ok: false, reason: "bad_passkey" };
}
