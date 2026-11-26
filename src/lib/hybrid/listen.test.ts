import { afterEach, describe, expect, it, vi } from "vitest";
import { listenOnce, stopListening } from "./listen";

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
});
