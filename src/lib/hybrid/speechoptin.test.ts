import { describe, expect, it } from "vitest";
import { CLOUD_SPEECH_KEY, readCloudOptIn, writeCloudOptIn } from "./speechoptin";

function store(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}
const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } } as unknown as Storage;

describe("remembered online-speech choice", () => {
  it("is off by default and when storage is missing or blocked", () => {
    expect(readCloudOptIn(store())).toBe(false);
    expect(readCloudOptIn(undefined)).toBe(false);
    expect(readCloudOptIn(broken)).toBe(false);
  });
  it("remembers a yes under payalone.cloudSpeech=1 and forgets on no", () => {
    const s = store();
    writeCloudOptIn(s, true);
    expect(s.getItem(CLOUD_SPEECH_KEY)).toBe("1");
    expect(CLOUD_SPEECH_KEY).toBe("payalone.cloudSpeech");
    expect(readCloudOptIn(s)).toBe(true);
    writeCloudOptIn(s, false);
    expect(readCloudOptIn(s)).toBe(false);
  });
  it("never throws when storage is blocked", () => {
    expect(() => writeCloudOptIn(broken, true)).not.toThrow();
    expect(() => writeCloudOptIn(undefined, true)).not.toThrow();
  });
  it("only the exact value 1 counts as yes", () => {
    const s = store();
    s.setItem(CLOUD_SPEECH_KEY, "true");
    expect(readCloudOptIn(s)).toBe(false);
  });
});
