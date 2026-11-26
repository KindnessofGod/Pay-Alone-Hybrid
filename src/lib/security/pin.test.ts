import { describe, expect, it } from "vitest";
import { setPin, checkPin, MAX_TRIES, LOCK_MS, type PinStore } from "./pin";

function memoryStore(): PinStore {
  const m = new Map<string, unknown>();
  return {
    get: async <T,>(id: string) => (m.get(id) as T) ?? null,
    put: async <T,>(id: string, v: T) => void m.set(id, v),
  };
}

describe("app PIN (red-team #3): no default, hashed, per-user lockout that is stored", () => {
  it("there is no default PIN: checking before setting fails", async () => {
    const s = memoryStore();
    expect(await checkPin(s, "u1", "1234")).toEqual({ ok: false, reason: "no_pin_set" });
  });

  it("refuses weak PINs", async () => {
    const s = memoryStore();
    for (const p of ["1234", "0000", "1111", "123", "abcd", "123456789"]) {
      await expect(setPin(s, "u1", p)).rejects.toThrow();
    }
  });

  it("stores only a hash, never the PIN", async () => {
    const s = memoryStore();
    await setPin(s, "u1", "4826");
    const rec = await s.get<Record<string, unknown>>("u1");
    expect(JSON.stringify(rec)).not.toContain("4826");
  });

  it("accepts the right PIN and refuses a wrong one", async () => {
    const s = memoryStore();
    await setPin(s, "u1", "4826");
    expect(await checkPin(s, "u1", "4826")).toEqual({ ok: true });
    expect(await checkPin(s, "u1", "4827")).toMatchObject({ ok: false, reason: "wrong" });
  });

  it("locks the user after MAX_TRIES wrong PINs, and the lock survives a new session", async () => {
    const s = memoryStore();
    await setPin(s, "u1", "4826");
    const now = 1_000_000;
    for (let i = 0; i < MAX_TRIES; i++) await checkPin(s, "u1", "0101", now);
    // A "new call" or new browser session uses the same stored record:
    expect(await checkPin(s, "u1", "4826", now + 1000)).toEqual({ ok: false, reason: "locked" });
    expect(await checkPin(s, "u1", "4826", now + LOCK_MS + 1)).toEqual({ ok: true });
  });

  it("a lockout for one user does not affect another", async () => {
    const s = memoryStore();
    await setPin(s, "u1", "4826");
    await setPin(s, "u2", "7391");
    for (let i = 0; i < MAX_TRIES; i++) await checkPin(s, "u1", "0101");
    expect(await checkPin(s, "u2", "7391")).toEqual({ ok: true });
  });
});
