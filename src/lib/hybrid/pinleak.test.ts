import { describe, expect, it, vi } from "vitest";
import { understand, type Engines } from "./understand";

const contacts = [{ id: "c1", name: "Tunde" }];

describe("PIN-leak test (red-team #4): a spoken PIN never reaches a model, the network, the result or logs", () => {
  it.each(["my pin is 4826", "send 5000 to Tunde my pin is four eight two six", "pin 4 8 2 6", "the code na 4826"])("%s", async (said) => {
    const calls: string[] = [];
    const engines: Engines = {
      onDevice: vi.fn(async (p: string) => (calls.push(p), { action: "unclear", amountMinor: null, payee: null })),
      cloud: vi.fn(async (p: string) => (calls.push(p), { action: "unclear", amountMinor: null, payee: null })),
    };
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const policy of ["on_device_first", "cloud_only", "ai_off"] as const) {
      const r = await understand(said, { contacts, limitMinor: "5000000", policy, deviceAvailable: true }, engines);
      expect(r.kind).toBe("secret_spoken");
      expect(JSON.stringify(r)).not.toMatch(/4\s*8\s*2\s*6|four eight two six/i);
    }
    expect(calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const spy of [log, warn, error]) for (const c of spy.mock.calls) expect(JSON.stringify(c)).not.toMatch(/4826/);
    vi.unstubAllGlobals();
  });
});

describe("PIN-leak test: the text-to-speech path never gets a PIN", () => {
  it.each(["my pin is 4826", "send 5000 to Tunde my pin is four eight two six", "pin 4 8 2 6", "the code na 4826"])("%s", async (said) => {
    const { createSpeaker } = await import("./tts");
    const seen: string[] = [];
    const speaker = createSpeaker({
      loadModel: async () => ({ generate: async (t: string) => (seen.push(t), { audio: new Float32Array(1), sampling_rate: 24000 }) }),
      play: () => ({ done: Promise.resolve(), stop() {} }),
      fallback: (t: string) => (seen.push(t), { done: Promise.resolve(), stop() {} }),
      generateLimitMs: 1000,
    });
    speaker.load();
    await new Promise((r) => setTimeout(r, 0));
    // if some code ever echoed what the person said, or a PIN they typed, back to the voice, nothing is spoken
    await speaker.speak(`You said: ${said}`);
    await speaker.speak(said);
    expect(seen).toEqual([]);
    expect(speaker.status()).toBe("ready");
  });
});
