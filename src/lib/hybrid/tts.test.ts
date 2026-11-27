import { describe, expect, it, vi } from "vitest";
import { createSpeaker, splitSentences, type Audio, type Deps, type Playing } from "./tts";


function setup(over: Partial<Deps> = {}) {
  const fallback: { text: string; stopped: boolean; end: () => void }[] = [];
  const played: { audio: Audio; stopped: boolean; end: () => void }[] = [];
  const generated: string[] = [];
  let resolveLoad: (() => void) | undefined;
  const deps: Deps = {
    loadModel: () =>
      new Promise((res) => {
        resolveLoad = () =>
          res({
            generate: async (t: string) => (generated.push(t), { audio: new Float32Array([0.1]), sampling_rate: 24000 }),
          });
      }),
    play: (audio) => {
      let end!: () => void;
      const done = new Promise<void>((r) => (end = r));
      const p = { audio, stopped: false, end };
      played.push(p);
      return { done, stop: () => { p.stopped = true; end(); } } satisfies Playing;
    },
    fallback: (text) => {
      let end!: () => void;
      const done = new Promise<void>((r) => (end = r));
      const f = { text, stopped: false, end };
      fallback.push(f);
      return { done, stop: () => { f.stopped = true; end(); } };
    },
    generateLimitMs: 8000,
    ...over,
  };
  return { deps, fallback, played, generated, ready: () => resolveLoad!() };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("splitSentences", () => {
  it("splits on sentence ends and keeps numbers like 3.69 together", () => {
    expect(splitSentences("You want to send money to Mama Ade. It will take 3.69 dollars. Fees included!")).toEqual([
      "You want to send money to Mama Ade.",
      "It will take 3.69 dollars.",
      "Fees included!",
    ]);
  });
  it("returns one piece for text with no end mark, and nothing for blank text", () => {
    expect(splitSentences("hello there")).toEqual(["hello there"]);
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("speaker status and loading", () => {
  it("starts off, goes loading then ready, and load runs the model loader only once", async () => {
    const s = setup();
    const loadModel = vi.fn(s.deps.loadModel);
    const sp = createSpeaker({ ...s.deps, loadModel });
    const seen: string[] = [];
    sp.onStatus((x) => seen.push(x));
    expect(sp.status()).toBe("off");
    sp.load();
    sp.load();
    expect(sp.status()).toBe("loading");
    s.ready();
    await tick();
    expect(sp.status()).toBe("ready");
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["loading", "ready"]);
  });
  it("goes to failed when loading throws, and never throws to the caller", async () => {
    const s = setup({ loadModel: () => Promise.reject(new Error("offline")) });
    const sp = createSpeaker(s.deps);
    sp.load();
    await tick();
    expect(sp.status()).toBe("failed");
    const p = sp.speak("Hello.");
    s.fallback[0].end();
    await expect(p).resolves.toBeUndefined();
  });
  it("does not retry a failed load on every sentence", async () => {
    const loadModel = vi.fn(() => Promise.reject(new Error("offline")));
    const s = setup({ loadModel });
    const sp = createSpeaker(s.deps);
    sp.load();
    await tick();
    sp.load();
    expect(loadModel).toHaveBeenCalledTimes(1);
  });
});

describe("speak", () => {
  it("uses the browser voice at once while the model is not ready, and never waits for the download", async () => {
    const s = setup();
    const sp = createSpeaker(s.deps);
    sp.load();
    const p = sp.speak("Hello there.");
    expect(s.fallback.map((f) => f.text)).toEqual(["Hello there."]);
    expect(s.generated).toEqual([]);
    s.fallback[0].end();
    await p;
  });
  it("speaks with the model once ready, sentence by sentence, and resolves when the audio ends", async () => {
    const s = setup();
    const sp = createSpeaker(s.deps);
    sp.load();
    s.ready();
    await tick();
    let done = false;
    const p = sp.speak("First one. Second one.").then(() => (done = true));
    await tick();
    expect(s.fallback).toEqual([]);
    expect(s.played).toHaveLength(1);
    expect(s.generated).toContain("First one.");
    s.played[0].end();
    await tick();
    expect(s.played).toHaveLength(2);
    expect(done).toBe(false);
    s.played[1].end();
    await p;
    expect(s.generated).toEqual(["First one.", "Second one."]);
  });
  it("a new sentence stops the previous one (model audio and browser voice)", async () => {
    const s = setup();
    const sp = createSpeaker(s.deps);
    sp.load();
    s.ready();
    await tick();
    const a = sp.speak("One long sentence.");
    await tick();
    const b = sp.speak("Another.");
    await a; // the cancelled call resolves
    expect(s.played[0].stopped).toBe(true);
    await tick();
    s.played[1].end();
    await b;
    const s2 = setup();
    const sp2 = createSpeaker(s2.deps);
    const c = sp2.speak("Browser one.");
    const d = sp2.speak("Browser two.");
    await c;
    expect(s2.fallback[0].stopped).toBe(true);
    s2.fallback[1].end();
    await d;
  });
  it("stop() ends current speech", async () => {
    const s = setup();
    const sp = createSpeaker(s.deps);
    const p = sp.speak("Hello.");
    sp.stop();
    await p;
    expect(s.fallback[0].stopped).toBe(true);
  });
  it("falls back to the browser voice for the rest when generation is slower than the limit", async () => {
    vi.useFakeTimers();
    try {
      const s = setup({ loadModel: async () => ({ generate: () => new Promise(() => {}) }) });
      const sp = createSpeaker(s.deps);
      sp.load();
      await vi.advanceTimersByTimeAsync(0);
      expect(sp.status()).toBe("ready");
      const p = sp.speak("First one. Second one.");
      await vi.advanceTimersByTimeAsync(8000);
      expect(s.fallback.map((f) => f.text)).toEqual(["First one. Second one."]);
      s.fallback[0].end();
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
  it("falls back when generation throws or playback throws, and never rejects", async () => {
    const s = setup({ loadModel: async () => ({ generate: async () => { throw new Error("boom"); } }) });
    const sp = createSpeaker(s.deps);
    sp.load();
    await tick();
    const p = sp.speak("Hello.");
    await tick();
    expect(s.fallback.map((f) => f.text)).toEqual(["Hello."]);
    s.fallback[0].end();
    await expect(p).resolves.toBeUndefined();
    const s2 = setup({ fallback: () => { throw new Error("no speechSynthesis"); } });
    await expect(createSpeaker(s2.deps).speak("Hi.")).resolves.toBeUndefined();
  });
});

describe("PIN safety (CLAUDE.md rule 15) on the speech path", () => {
  it.each(["Your pin is 4826.", "The code is four eight two six.", "Card 4111 1111 1111 1111"])("%s is never given to the model or the browser voice", async (text) => {
    const s = setup();
    const sp = createSpeaker(s.deps);
    sp.load();
    s.ready();
    await tick();
    await sp.speak(text);
    expect(s.generated).toEqual([]);
    expect(s.fallback).toEqual([]);
    expect(s.played).toEqual([]);
  });
  it("the app's own PIN instructions still speak (they say 'PIN' and a length, not a PIN)", async () => {
    const s = setup();
    const sp = createSpeaker(s.deps);
    const p = sp.speak("First, choose a PIN of 4 to 6 digits. Type it on the keys. Never say it out loud.");
    expect(s.fallback).toHaveLength(1);
    s.fallback[0].end();
    await p;
  });
  it("normal read-backs with amounts still speak", async () => {
    const s = setup();
    const sp = createSpeaker(s.deps);
    const p = sp.speak("You want to send money to Mama Ade. It will take 3 dollars and 69 cents from your wallet, fees included.");
    expect(s.fallback).toHaveLength(1);
    s.fallback[0].end();
    await p;
  });
});
