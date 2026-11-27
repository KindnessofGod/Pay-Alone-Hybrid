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

describe("PIN-leak test: the conversation never speaks or keeps a spoken PIN or the person's own words", () => {
  it.each(["my pin is 4826", "send 5000 to Tunde my pin is four eight two six", "pin 4 8 2 6", "the code na 4826"])("%s", async (said) => {
    const { next, initialDialog } = await import("./dialog");
    const { spokenSecret } = await import("./tripwire");
    const u = await understand(
      said,
      { contacts, limitMinor: "5000000", policy: "ai_off", deviceAvailable: false },
      { onDevice: async () => ({}), cloud: async () => ({}) },
    );
    expect(spokenSecret(said).tripped).toBe(true);
    const start = { ...initialDialog(), payeeId: "c1", amountMinor: "100" };
    const o = next(start, u, { contacts, said, limitMinor: "5000000" });
    expect(o.say).not.toMatch(/\d/);
    expect(o.then).not.toBe("approve");
    expect(JSON.stringify(o)).not.toMatch(/4826|four eight two six|4 8 2 6/i);
    expect(o.state.payeeId).toBeUndefined();
    expect(o.state.amountMinor).toBeUndefined();
  });
  it("answers that are not understood are never echoed", async () => {
    const { next, initialDialog } = await import("./dialog");
    for (const said of ["xyzzy plugh 4826", "the quick brown fox"]) {
      const o = next(initialDialog(), { kind: "unclear", source: "rules" }, { contacts, said, limitMinor: "5000000" });
      expect(o.say).not.toMatch(/xyzzy|plugh|4826|quick|fox/);
    }
  });
});

describe("PIN-leak test: the PIN sent to /api/passkey/options (adding a fingerprint)", () => {
  it("never appears in results, stored documents, logs or network calls, right PIN or wrong", async () => {
    const { MemoryStore } = await import("../store/memory");
    const { setUserPin } = await import("../server/payflow");
    const { passkeyOptions } = await import("../server/passkeyflow");
    const { handle } = await import("../server/http");
    process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
    const store = new MemoryStore();
    const d = { store, baseUrl: "https://pay-alone-hybrid.vercel.app", limitMinor: 1, contacts: async () => [], quote: async () => ({ quoteId: "q", debit: { value: "1", assetCode: "NGN", assetScale: 2 }, simulated: true }), pay: async () => ({ paymentId: "p", simulated: true }) };
    await setUserPin(d, "u1", { pin: "4826" });
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const seen: string[] = [];
    for (const pin of ["7391", "4826"]) {
      seen.push(JSON.stringify(await passkeyOptions(d, "u1", { pin })));
      // the same call through the HTTP wrapper, with a handler that throws on purpose
      const res = await handle(
        new Request("https://x.test/api/passkey/options", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ pin }) }),
        async () => "u1",
        async (_u, body) => {
          throw new Error(`boom ${JSON.stringify(body)}`);
        },
      );
      seen.push(await res.text());
    }
    for (const col of ["pins", "passkey_pending", "passkeys", "challenges"]) seen.push(JSON.stringify(await store.list(col)).replace(/"(salt|hash)":"[^"]*"/g, ""));
    for (const text of seen) expect(text).not.toMatch(/7391|4826/);
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const spy of spies) for (const c of spy.mock.calls) expect(JSON.stringify(c)).not.toMatch(/7391|4826/);
    vi.unstubAllGlobals();
  });
});
