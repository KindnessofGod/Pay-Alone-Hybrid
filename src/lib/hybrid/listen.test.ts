import { afterEach, describe, expect, it, vi } from "vitest";
import { installLocalSpeech, listenOnce, localSpeechStatus, say, SpeechError, speechErrorInfo, stopListening } from "./listen";

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

describe("speechErrorInfo maps Chrome error codes to short, specific messages", () => {
  it("microphone blocked", () => {
    for (const c of ["not-allowed", "service-not-allowed"]) {
      const i = speechErrorInfo(c);
      expect(i.kind).toBe("permission");
      expect(i.say).toBe("I can't use your microphone. Click the lock icon left of the web address, set Microphone to Allow, then reload.");
    }
  });
  it("network", () => {
    expect(speechErrorInfo("network")).toMatchObject({ kind: "network", say: "Online speech isn't reachable right now. Please type instead." });
  });
  it("language not supported asks for the opt-in flow", () => {
    expect(speechErrorInfo("language-not-supported").kind).toBe("language");
  });
  it("no microphone", () => {
    expect(speechErrorInfo("audio-capture")).toMatchObject({ kind: "no_mic", say: "No microphone found." });
  });
  it("anything else is generic, and the audit code is lowercase letters and underscores only", () => {
    expect(speechErrorInfo("weird thing 42")).toMatchObject({ kind: "other", code: "other" });
    for (const c of ["not-allowed", "service-not-allowed", "network", "language-not-supported", "audio-capture"]) expect(speechErrorInfo(c).code).toMatch(/^[a-z_]+$/);
  });
});

describe("listenOnce errors are typed", () => {
  it("rejects with a SpeechError carrying the info", async () => {
    (globalThis as Record<string, unknown>).SpeechRecognition = FakeRec;
    const p = listenOnce({ local: false });
    FakeRec.last!.onerror!({ error: "not-allowed" });
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(SpeechError);
    expect(e.info.kind).toBe("permission");
  });
  it("no-speech and aborted are not errors", async () => {
    (globalThis as Record<string, unknown>).SpeechRecognition = FakeRec;
    const p = listenOnce({ local: false });
    FakeRec.last!.onerror!({ error: "no-speech" });
    expect(await p).toBe("");
  });
});

describe("live words while listening (interim) never become the answer", () => {
  it("asks for interim results only when someone is watching, and shows them", async () => {
    (globalThis as Record<string, unknown>).SpeechRecognition = FakeRec;
    const seen: string[] = [];
    const p = listenOnce({ local: true, onInterim: (t) => seen.push(t) });
    expect(FakeRec.last!.interimResults).toBe(true);
    FakeRec.last!.onresult!({ results: [Object.assign([{ transcript: "send five" }], { isFinal: false })] });
    FakeRec.last!.onresult!({ results: [Object.assign([{ transcript: "send five hundred" }], { isFinal: false })] });
    expect(seen).toEqual(["send five", "send five hundred"]);
    FakeRec.last!.onresult!({ results: [Object.assign([{ transcript: "send 500 naira to Tunde" }], { isFinal: true })] });
    FakeRec.last!.onend!();
    expect(await p).toBe("send 500 naira to Tunde");
  });
  it("without a watcher interim stays off", async () => {
    (globalThis as Record<string, unknown>).SpeechRecognition = FakeRec;
    const p = listenOnce({ local: true });
    expect(FakeRec.last!.interimResults).toBe(false);
    stopListening();
    await p;
  });
  it("words that never became final are not returned", async () => {
    (globalThis as Record<string, unknown>).SpeechRecognition = FakeRec;
    const p = listenOnce({ local: true, onInterim: () => undefined });
    FakeRec.last!.onresult!({ results: [Object.assign([{ transcript: "half a sentence" }], { isFinal: false })] });
    FakeRec.last!.onend!();
    expect(await p).toBe("");
  });
});

describe("installLocalSpeech keeps going in the background", () => {
  type Opts = { langs: string[]; processLocally: boolean };
  function pack(states: string[]) {
    const calls = { install: 0, available: 0 };
    let i = 0;
    class R extends FakeRec {
      static available = async (_o: Opts) => { calls.available++; return states[Math.min(i++, states.length - 1)]; };
      static install = async (_o: Opts) => { calls.install++; return false; };
    }
    (globalThis as Record<string, unknown>).SpeechRecognition = R;
    return calls;
  }
  it("calls install once, polls every 3 s, and reports local when the pack arrives", async () => {
    vi.useFakeTimers();
    const calls = pack(["downloading", "downloading", "available"]);
    const seen: string[] = [];
    const h = installLocalSpeech("en-US", (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await h.done).toBe("local");
    expect(calls.install).toBe(1);
    expect(seen[0]).toBe("downloading");
    expect(seen.at(-1)).toBe("local");
    const n = calls.available;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.available).toBe(n); // stopped polling
  });
  it("gives up after 3 minutes with server", async () => {
    vi.useFakeTimers();
    pack(["downloading"]);
    const seen: string[] = [];
    const h = installLocalSpeech("en-US", (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(181_000);
    expect(await h.done).toBe("server");
    expect(seen.at(-1)).toBe("server");
  });
  it("reports server at once when the pack is unavailable", async () => {
    vi.useFakeTimers();
    pack(["unavailable"]);
    const h = installLocalSpeech("en-US", () => undefined);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await h.done).toBe("server");
  });
  it("cancel() stops polling", async () => {
    vi.useFakeTimers();
    const calls = pack(["downloading"]);
    const h = installLocalSpeech("en-US", () => undefined);
    await vi.advanceTimersByTimeAsync(3_000);
    h.cancel();
    const n = calls.available;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.available).toBe(n);
  });
  it("reports none when there is no speech recognition", async () => {
    const h = installLocalSpeech("en-US", () => undefined);
    expect(await h.done).toBe("none");
  });
});

describe("localSpeechStatus", () => {
  it("tells downloadable, downloading, available and unavailable apart", async () => {
    for (const [a, want] of [["available", "local"], ["downloadable", "installable"], ["downloading", "downloading"], ["unavailable", "server"]] as const) {
      class R extends FakeRec { static available = async () => a; }
      (globalThis as Record<string, unknown>).SpeechRecognition = R;
      expect(await localSpeechStatus()).toBe(want);
    }
  });
  it("is none without speech recognition", async () => {
    expect(await localSpeechStatus()).toBe("none");
  });
});
