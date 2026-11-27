import { describe, expect, it } from "vitest";
import { RESUME_TTL_MS, saveResume, takeResume } from "./resume";

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("resume the payment after the one-time wallet connection", () => {
  it("gives back the payee and amount once, then forgets them", () => {
    const s = mem();
    saveResume(s, { payeeId: "c1", amountMinor: "500000" }, 1000);
    expect(takeResume(s, 2000)).toEqual({ payeeId: "c1", amountMinor: "500000" });
    expect(takeResume(s, 2000)).toBeNull();
  });

  it("forgets a request older than 15 minutes", () => {
    const s = mem();
    saveResume(s, { payeeId: "c1", amountMinor: "500000" }, 0);
    expect(takeResume(s, RESUME_TTL_MS + 1)).toBeNull();
  });

  it("ignores anything that is not a payee id and whole-number amount", () => {
    const s = mem();
    for (const bad of ["not json", JSON.stringify({ payeeId: "c1", amountMinor: "5.5", at: 0 }), JSON.stringify({ payeeId: 7, amountMinor: "1", at: 0 })]) {
      s.setItem("payalone.resume", bad);
      expect(takeResume(s, 1)).toBeNull();
    }
  });

  it("never stores a PIN or anything but payee, amount and time", () => {
    const s = mem();
    saveResume(s, { payeeId: "c1", amountMinor: "500000", pin: "4826" } as never, 0);
    expect([...s.m.values()].join()).not.toContain("4826");
  });

  it("works when storage is blocked", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => saveResume(broken, { payeeId: "c1", amountMinor: "1" }, 0)).not.toThrow();
    expect(takeResume(broken, 0)).toBeNull();
  });
});
