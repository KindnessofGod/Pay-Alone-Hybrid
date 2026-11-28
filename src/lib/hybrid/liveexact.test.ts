import { describe, expect, it, vi } from "vitest";
import { runLive, type LiveDeps, type LiveSessionLike } from "./live";

/** A session we can push messages into while the test runs. */
function pushSession() {
  const queue: unknown[] = [];
  let wake: () => void = () => undefined;
  let closed = false;
  const sent = { audio: [] as unknown[], text: [] as string[] };
  const s: LiveSessionLike & { sendTextRealtime: (t: string) => Promise<void> } = {
    get isClosed() { return closed; },
    async *receive() {
      while (!closed) {
        while (queue.length) yield queue.shift() as never;
        await new Promise<void>((r) => (wake = r));
      }
    },
    sendAudioRealtime: async (b) => void sent.audio.push(b),
    sendFunctionResponses: async () => undefined,
    sendTextRealtime: async (t) => void sent.text.push(t),
    close: async () => { closed = true; wake(); },
  };
  const push = (m: unknown) => { queue.push(m); wake(); };
  return { s, sent, push };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const audio = (d = "AAAA") => ({ type: "serverContent", modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: d } }] } });
const said = (t: string) => ({ type: "serverContent", outputTranscription: { text: t } });

function setup() {
  const { s, sent, push } = pushSession();
  const out: string[] = [];
  const d = {
    contacts: [], limitMinor: () => "1", present: async () => true, onTurns: vi.fn(), onTripwire: vi.fn(),
    onAudioOut: (b: string) => void out.push(b), onInterrupted: vi.fn(), onEnd: vi.fn(), onMismatch: vi.fn(),
  } as unknown as LiveDeps;
  const c = runLive(s, d, { startMuted: true });
  return { c, sent, push, out, d };
}
const T = "You are paying Tunde 3,000 naira.";

describe("sendText", () => {
  it("sends a plain text turn", async () => {
    const { c, sent } = setup();
    await c.sendText("[app opened]");
    expect(sent.text).toEqual(["[app opened]"]);
    await c.stop();
  });
});

describe("sendText with wait", () => {
  it("resolves when the model's turn is complete", async () => {
    const { c, push } = setup();
    let done = false;
    const p = c.sendText("[app opened]", { wait: true }).then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    push({ type: "serverContent", outputTranscription: { text: "Hello" } });
    push({ type: "serverContent", turnComplete: true });
    await p;
    expect(done).toBe(true);
    await c.stop();
  });
  it("gives up waiting after the time limit", async () => {
    const { c } = setup();
    await c.sendText("[app opened]", { wait: true, timeoutMs: 20 });
    await c.stop();
  });
});

describe("speakExact", () => {
  it("asks the model to read the template, plays its audio even when output was muted, and reports spoken", async () => {
    const { c, sent, push, out } = setup();
    const p = c.speakExact(T);
    await tick();
    expect(sent.text[0]).toBe(`Read this exactly, word for word, nothing else: ${T}`);
    push(audio("A1"));
    push(said("You are paying Tunde "));
    push(said("three thousand naira."));
    push({ type: "serverContent", turnComplete: true });
    expect(await p).toBe("spoken");
    expect(out).toEqual(["A1"]);
    push(audio("A2")); // output is muted again afterwards
    await tick();
    expect(out).toEqual(["A1"]);
    await c.stop();
  });

  it("stops at once when the model says something else: flush, no more audio, mismatch", async () => {
    const { c, push, out, d } = setup();
    const p = c.speakExact(T);
    await tick();
    push(audio("A1"));
    push(said("You are paying Chidi 5,000 naira. "));
    await tick();
    push(audio("A2"));
    expect(await p).toBe("mismatch");
    await tick();
    expect(d.onMismatch).toHaveBeenCalledTimes(1);
    expect(d.onInterrupted).toHaveBeenCalled();
    expect(out).toEqual(["A1"]);
    await c.stop();
  });

  it("a finished turn that does not match is a mismatch too", async () => {
    const { c, push } = setup();
    const p = c.speakExact(T);
    await tick();
    push(said("Okay."));
    push({ type: "serverContent", turnComplete: true });
    expect(await p).toBe("mismatch");
    await c.stop();
  });

  it("does not put the template in the conversation bubbles", async () => {
    const { c, push, d } = setup();
    const p = c.speakExact(T);
    await tick();
    push(said(T));
    push({ type: "serverContent", turnComplete: true });
    await p;
    const all = (d.onTurns as ReturnType<typeof vi.fn>).mock.calls.flatMap((x) => x[0] as { text: string }[]);
    expect(all.some((t) => t.text.includes("Tunde"))).toBe(false);
    await c.stop();
  });

  it("closes the microphone while it speaks and restores it after", async () => {
    const { c, push, sent } = setup();
    c.sendMic("m0");
    const p = c.speakExact(T);
    await tick();
    c.sendMic("m1");
    push(said(T));
    push({ type: "serverContent", turnComplete: true });
    await p;
    c.sendMic("m2");
    await tick();
    expect(sent.audio.map((a) => (a as { data: string }).data)).toEqual(["m0", "m2"]);
    await c.stop();
  });

  it("keeps the microphone closed if it was closed (card open) before", async () => {
    const { c, push, sent } = setup();
    c.pauseMic();
    const p = c.speakExact(T);
    await tick();
    push(said(T));
    push({ type: "serverContent", turnComplete: true });
    await p;
    c.sendMic("m");
    expect(sent.audio).toEqual([]);
    expect(c.isMicPaused()).toBe(true);
    await c.stop();
  });

  it("gives up after the time limit", async () => {
    const { c } = setup();
    expect(await c.speakExact(T, { timeoutMs: 20 })).toBe("failed");
    await c.stop();
  });

  it("fails when the session is over", async () => {
    const { c } = setup();
    await c.stop();
    expect(await c.speakExact(T)).toBe("failed");
  });
});

describe("user pause (space bar)", () => {
  it("drops microphone chunks while paused and resume() does not undo a user pause", async () => {
    const { c, sent } = setup();
    c.setUserPaused(true);
    c.sendMic("a");
    c.resume();
    c.sendMic("b");
    expect(sent.audio).toEqual([]);
    c.setUserPaused(false);
    c.sendMic("c");
    await tick();
    expect(sent.audio.map((a) => (a as { data: string }).data)).toEqual(["c"]);
    await c.stop();
  });
});
