// The app PIN (red-team #3). Server side only.
// - There is no default PIN: until the person sets one, every check fails.
// - Weak PINs are refused.
// - Only a salted scrypt hash is stored.
// - Wrong tries are counted per user in the store, so a new call or session does not reset them.
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const MAX_TRIES = 5;
export const LOCK_MS = 15 * 60_000;

export interface PinStore {
  get<T>(userId: string): Promise<T | null>;
  put<T>(userId: string, rec: T): Promise<void>;
  /** Atomic read-change-write of one user's record (see Store.update). */
  update<T, R>(userId: string, fn: (cur: T | null) => { doc: T | null; result: R }): Promise<R>;
}

interface PinRecord {
  salt: string;
  hash: string;
  failures: number;
  lockedUntil: number;
}

export type PinCheck = { ok: true } | { ok: false; reason: "no_pin_set" | "wrong" | "locked"; triesLeft?: number };

const WEAK = new Set(["1234", "4321", "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1212", "2580", "123456", "654321", "000000", "111111"]);

function hashOf(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString("base64url");
}

export async function setPin(store: PinStore, userId: string, pin: string): Promise<void> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error("PIN must be 4 to 6 digits");
  if (WEAK.has(pin) || /^(\d)\1+$/.test(pin)) throw new Error("PIN is too easy to guess");
  const salt = randomBytes(16).toString("base64url");
  await store.put<PinRecord>(userId, { salt, hash: hashOf(pin, salt), failures: 0, lockedUntil: 0 });
}

export async function checkPin(store: PinStore, userId: string, pin: string, now = Date.now()): Promise<PinCheck> {
  // One atomic step per try, so guesses sent at the same moment are all counted, and a try can
  // never write back an old PIN over a PIN change.
  return store.update<PinRecord, PinCheck>(userId, (rec) => {
    if (!rec) return { doc: null, result: { ok: false, reason: "no_pin_set" } };
    if (rec.lockedUntil > now) return { doc: rec, result: { ok: false, reason: "locked" } };
    const given = Buffer.from(hashOf(String(pin), rec.salt));
    const want = Buffer.from(rec.hash);
    if (given.length === want.length && timingSafeEqual(given, want)) return { doc: { ...rec, failures: 0, lockedUntil: 0 }, result: { ok: true } };
    const failures = (rec.lockedUntil && rec.lockedUntil <= now ? 0 : rec.failures) + 1;
    const locked = failures >= MAX_TRIES;
    return {
      doc: { ...rec, failures: locked ? 0 : failures, lockedUntil: locked ? now + LOCK_MS : 0 },
      result: locked ? { ok: false, reason: "locked" } : { ok: false, reason: "wrong", triesLeft: MAX_TRIES - failures },
    };
  });
}
