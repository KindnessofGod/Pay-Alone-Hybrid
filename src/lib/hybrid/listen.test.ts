import { afterEach, describe, expect, it, vi } from "vitest";
import { listenOnce, say, stopListening } from "./listen";

class FakeRec {
  static last: FakeRec | undefined;
  lang = "";
  interimResults = false;
  maxAlternatives = 1;
  processLocally?: boolean;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  stopped = false;
  constructor() {
    FakeRec.last = this;
  }
  start() {}
  stop() {
    this.stopped = true;
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    this.stop();
  }
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).SpeechRecognition;
});

describe("listenOnce never hangs on 'Listening...'", () => {
  it("stops by itself after the time limit and returns what it heard (nothing)", async () => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).SpeechRecognition = FakeRec;
    const p = listenOnce({ local: true, maxMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    expect(FakeRec.last?.stopped).toBe(true);
    expect(await p).toBe("");
  });
  it("stopListening() ends it at once (used when the person types instead)", async () => {
    (globalThis as Record<string, unknown>).SpeechRecognition = FakeRec;
    const p = listenOnce({ local: true });
    stopListening();
    expect(await p).toBe("");
  });
  it("returns the words heard", async () => {
    (globalThis as Record<string, unknown>).SpeechRecognition = FakeRec;
    const p = listenOnce({ local: true });
    FakeRec.last!.onresult!({ results: [[{ transcript: "send 5000 naira to Tunde" }]] });
    FakeRec.last!.onend!();
    expect(await p).toBe("send 5000 naira to Tunde");
  });

  it("still ends when Chrome never fires onend after stop (seen on a real PC)", async () => {
    vi.useFakeTimers();
    class DeafRec extends FakeRec { stop() { this.stopped = true; } abort() { this.stopped = true; } }
    (globalThis as Record<string, unknown>).SpeechRecognition = DeafRec;
    const p = listenOnce({ local: true, maxMs: 8000 });
    await vi.advanceTimersByTimeAsync(9000);
    expect(await p).toBe("");
  });
  it("stopListening() ends it at once even when Chrome never fires onend", async () => {
    class DeafRec extends FakeRec { stop() { this.stopped = true; } abort() { this.stopped = true; } }
    (globalThis as Record<string, unknown>).SpeechRecognition = DeafRec;
    const p = listenOnce({ local: true });
    stopListening();
    expect(await p).toBe("");
  });
});

describe("say keeps its contract on the browser voice (model not loaded)", () => {
  class FakeUtterance {
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    voice: unknown;
    rate = 1;
    constructor(public text: string) {}
  }
  function fakeSynth(finish: boolean) {
    const spoken: FakeUtterance[] = [];
    const synth = {
      cancel: vi.fn(),
      getVoices: () => [],
      speak: (u: FakeUtterance) => {
        spoken.push(u);
        if (finish) queueMicrotask(() => u.onend?.());
      },
    };
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    return { synth, spoken };
  }
  afterEach(() => vi.unstubAllGlobals());

  it("resolves when the sentence ends", async () => {
    const { spoken } = fakeSynth(true);
    await say("Hello there.");
    expect(spoken.map((u) => u.text)).toEqual(["Hello there."]);
  });
  it("resolves by itself when the browser never finishes (time limit)", async () => {
    vi.useFakeTimers();
    fakeSynth(false);
    const p = say("Hi.");
    await vi.advanceTimersByTimeAsync(3_000 + 3 * 120 + 10);
    await expect(p).resolves.toBeUndefined();
  });
  it("a new say() cancels the earlier one", async () => {
    const { synth } = fakeSynth(false);
    void say("One.");
    void say("Two.");
    expect(synth.cancel.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
  it("does nothing, and does not throw, when there is no speech output", async () => {
    await expect(say("Hello.")).resolves.toBeUndefined();
  });
  it("never speaks a PIN", async () => {
    const { spoken } = fakeSynth(true);
    await say("Your pin is 4826.");
    expect(spoken).toEqual([]);
  });
});
