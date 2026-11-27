// Adding and keeping a fingerprint (WebAuthn passkey) for payment approval. Server side only.
// - The PIN comes first: no PIN, no fingerprint. And the CURRENT PIN is needed to add one, checked
//   with the same stored lockout as a payment, so someone at an unlocked browser cannot quietly add
//   their own fingerprint.
// - The registration challenge is stored on the server, works once and expires in 5 minutes.
// - Passkeys are kept per user; a passkey from another user is simply not in the list.
import { finishRegistration, registrationOptions, type PendingRegistration, type StoredPasskey } from "../passkey";
import { checkPin } from "../security/pin";
import { storedPasskeys, type PasskeyDoc } from "./passkeystore";
import { pinStoreOf, type PayDeps } from "./payflow";

export { storedPasskeys } from "./passkeystore";

export const PASSKEY_PENDING_TTL_MS = 5 * 60_000;
export const MAX_PASSKEYS = 5;

type RegOptions = Awaited<ReturnType<typeof registrationOptions>>["options"];

export async function passkeyOptions(
  d: PayDeps,
  userId: string,
  body: { pin?: unknown },
): Promise<{ ok: true; options: RegOptions } | { ok: false; reason: "no_pin_set" | "bad_pin" | "wrong" | "locked" | "too_many"; triesLeft?: number }> {
  if (typeof body.pin !== "string" || !/^\d{4,6}$/.test(body.pin)) return { ok: false, reason: "bad_pin" };
  const c = await checkPin(pinStoreOf(d.store), userId, body.pin, d.now?.() ?? Date.now());
  if (!c.ok) return c.triesLeft === undefined ? { ok: false, reason: c.reason } : { ok: false, reason: c.reason, triesLeft: c.triesLeft };
  const existing = await storedPasskeys(d.store, userId);
  if (existing.length >= MAX_PASSKEYS) return { ok: false, reason: "too_many" };
  const { options, pending } = await registrationOptions({ baseUrl: d.baseUrl, userId, userName: "Pay Alone", existing });
  const now = d.now?.() ?? Date.now();
  await d.store.put<PendingRegistration>("passkey_pending", userId, { challenge: pending.challenge, expiresAt: new Date(now + PASSKEY_PENDING_TTL_MS).toISOString() });
  return { ok: true, options };
}

export async function passkeyRegister(
  d: PayDeps,
  userId: string,
  body: { response?: unknown },
): Promise<{ ok: true } | { ok: false; reason: "no_pending" | "bad_registration" }> {
  const pending = (await d.store.take<PendingRegistration>("passkey_pending", userId)) ?? undefined;
  if (!pending || Date.parse(pending.expiresAt) < (d.now?.() ?? Date.now())) return { ok: false, reason: "no_pending" };
  const key = await finishRegistration({ baseUrl: d.baseUrl, pending, response: body.response });
  if (!key) return { ok: false, reason: "bad_registration" };
  await d.store.update<PasskeyDoc, void>("passkeys", userId, (cur) => ({
    doc: { list: [...(cur?.list ?? []).filter((p) => p.id !== key.id), key].slice(-MAX_PASSKEYS) },
    result: undefined,
  }));
  return { ok: true };
}
