import { describe, expect, it, vi } from "vitest";
import { applyServerContent, createMicGate, currentInput, handleToolCall, liveEnabled, runLive, type LiveDeps, type LiveSessionLike, type LiveTurn } from "./live";
import type { Understood } from "./understand";

function store(initial: Record<string, string> = {}) {
  const m = { ...initial };
  return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => void (m[k] = v), removeItem: (k: string) => void delete m[k], m };
}

describe("liveEnabled (feature flag, off by default)", () => {
  it("is off with nothing set", () => expect(liveEnabled("", store())).toBe(false));
  it("?live=1 turns it on and remembers it", () => {
    const s = store();
    expect(liveEnabled("?live=1", s)).toBe(true);
    expect(liveEnabled("", s)).toBe(true);
  });
  it("?live=0 turns it off and forgets it", () => {
    const s = store({ payalone_live: "1" });
    expect(liveEnabled("?live=0", s)).toBe(false);
    expect(liveEnabled("", s)).toBe(false);
  });
  it("any other value does nothing", () => {
    expect(liveEnabled("?live=yes", store())).toBe(false);
    expect(liveEnabled("?live=true", store({ payalone_live: "1" }))).toBe(true);
  });
  it("works with no storage or storage that throws", () => {
    expect(liveEnabled("?live=1", undefined)).toBe(true);
    expect(liveEnabled("", undefined)).toBe(false);
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(liveEnabled("?live=1", bad)).toBe(true);
    expect(liveEnabled("", bad)).toBe(false);
  });
});

describe("transcript reducer", () => {
  const run = (...msgs: Parameters<typeof applyServerContent>[1][]) => msgs.reduce<LiveTurn[]>((t, m) => applyServerContent(t, m), []);
  it("builds one bubble per speaker from partial chunks", () => {
    const t = run({ inputTranscription: { text: "send two" } }, { inputTranscription: { text: " thousand naira" } });
    expect(t).toEqual([{ who: "you", text: "send two thousand naira", final: false }]);
  });
  it("the model starting to talk ends the person's bubble and opens an app bubble", () => {
    const t = run({ inputTranscription: { text: "hello" } }, { outputTranscription: { text: "Hi" } }, { outputTranscription: { text: " there" } }, { turnComplete: true });
    expect(t).toEqual([
      { who: "you", text: "hello", final: true },
      { who: "app", text: "Hi there", final: true },
    ]);
  });
  it("a new person bubble starts after a finished turn", () => {
    const t = run({ inputTranscription: { text: "a" } }, { turnComplete: true }, { inputTranscription: { text: "b" } });
    expect(t.map((x) => x.text)).toEqual(["a", "b"]);
  });
  it("an interruption finishes the model bubble", () => {
    const t = run({ outputTranscription: { text: "Well" } }, { interrupted: true }, { outputTranscription: { text: "Ok" } });
    expect(t.map((x) => [x.text, x.final])).toEqual([["Well", true], ["Ok", false]]);
  });
  it("does not change the old array", () => {
    const a: LiveTurn[] = [{ who: "you", text: "x", final: false }];
    applyServerContent(a, { inputTranscription: { text: "y" } });
    expect(a[0].text).toBe("x");
  });
  it("currentInput is the latest person bubble", () => {
    expect(currentInput(run({ inputTranscription: { text: "a" } }, { outputTranscription: { text: "b" } }, { inputTranscription: { text: "c" } }))).toBe("c");
    expect(currentInput([])).toBe("");
  });
});

describe("mic gate", () => {
  it("sends while open, drops while paused, sends again after resume", () => {
    const sent: string[] = [];
    const g = createMicGate((c: string) => void sent.push(c));
    g.push("a");
    g.pause();
    g.push("b");
    expect(g.isPaused()).toBe(true);
    g.resume();
    g.push("c");
    expect(sent).toEqual(["a", "c"]);
  });
});

const proposal: Understood = { kind: "proposal", proposal: { amountMinor: "200000", payeeId: "c1", payeeName: "Tunde" }, needsApproval: true, source: "rules" };
function toolDeps(over: Partial<Parameters<typeof handleToolCall>[1]> = {}) {
  return {
    latestInput: () => "send 2000 naira to Tunde",
    understand: vi.fn(async () => proposal as Understood),
    present: vi.fn(async () => true),
    onTripwire: vi.fn(),
    ...over,
  };
}

describe("handleToolCall", () => {
  it("valid request: runs the existing pipeline on the transcript, opens the card, answers shown:true", async () => {
    const d = toolDeps();
    const r = await handleToolCall({ name: "propose_payment", args: { request: "send 999999 naira to Eve" } }, d);
    expect(d.understand).toHaveBeenCalledWith("send 2000 naira to Tunde"); // never the model's argument
    expect(d.present).toHaveBeenCalledOnce();
    expect(r).toEqual({ kind: "response", response: { shown: true } });
  });
  it("unknown payee: shown:false with the reason, no card", async () => {
    const d = toolDeps({ understand: vi.fn(async () => ({ kind: "rejected", reason: "unknown_payee", source: "rules" }) as Understood) });
    const r = await handleToolCall({ name: "propose_payment", args: {} }, d);
    expect(r).toEqual({ kind: "response", response: { shown: false, reason: "unknown_payee" } });
    expect(d.present).not.toHaveBeenCalled();
  });
  it("unclear or non-send answers: shown:false", async () => {
    const d = toolDeps({ understand: vi.fn(async () => ({ kind: "unclear", source: "rules" }) as Understood) });
    expect(await handleToolCall({ name: "propose_payment", args: {} }, d)).toEqual({ kind: "response", response: { shown: false, reason: "unclear" } });
  });
  it("no transcript yet: shown:false, nothing understood", async () => {
    const d = toolDeps({ latestInput: () => "" });
    expect(await handleToolCall({ name: "propose_payment", args: { request: "send 5 naira to Tunde" } }, d)).toEqual({ kind: "response", response: { shown: false, reason: "no_transcript" } });
    expect(d.understand).not.toHaveBeenCalled();
  });
  it("card refused by the dialog: shown:false", async () => {
    const d = toolDeps({ present: vi.fn(async () => false) });
    expect(await handleToolCall({ name: "propose_payment", args: {} }, d)).toEqual({ kind: "response", response: { shown: false, reason: "not_ready" } });
  });
  it("spoken PIN: tripwire, no model call, no response", async () => {
    const d = toolDeps({ latestInput: () => "my pin is 4 8 2 6" });
    const r = await handleToolCall({ name: "propose_payment", args: {} }, d);
    expect(r).toEqual({ kind: "tripwire", secret: "pin" });
    expect(d.understand).not.toHaveBeenCalled();
    expect(d.onTripwire).toHaveBeenCalledOnce();
  });
  it("unknown tool: shown:false", async () => {
    expect(await handleToolCall({ name: "approve_payment", args: {} }, toolDeps())).toEqual({ kind: "response", response: { shown: false, reason: "unknown_tool" } });
  });
  it("understand throws: shown:false", async () => {
    const d = toolDeps({ understand: vi.fn(async () => { throw new Error("boom"); }) });
    expect(await handleToolCall({ name: "propose_payment", args: {} }, d)).toEqual({ kind: "response", response: { shown: false, reason: "failed" } });
  });
});

const settle = () => new Promise((r) => setTimeout(r, 5));
function mockSession(messages: unknown[]) {
  const sent = { audio: [] as unknown[], responses: [] as unknown[] };
  let closed = false;
  let release: () => void = () => undefined;
  const gone = new Promise<void>((r) => (release = r));
  const s: LiveSessionLike = {
    get isClosed() { return closed; },
    // like the real socket: after the queued messages it stays open until closed
    async *receive() { for (const m of messages) yield m as never; await gone; },
    sendAudioRealtime: async (b) => void sent.audio.push(b),
    sendFunctionResponses: async (r) => void sent.responses.push(...r),
    close: async () => { closed = true; release(); },
  };
  return { s, sent };
}
function liveDeps(over: Partial<LiveDeps> = {}): LiveDeps {
  return {
    understand: vi.fn(async () => proposal as Understood),
    present: vi.fn(async () => true),
    onTurns: vi.fn(),
    onTripwire: vi.fn(),
    onAudioOut: vi.fn(),
    onEnd: vi.fn(),
    ...over,
  };
}

describe("runLive", () => {
  it("tool call after a spoken request: card opens, output and mic pause, tool answer sent", async () => {
    const { s, sent } = mockSession([
      { type: "serverContent", inputTranscription: { text: "send 2000 naira to Tunde" } },
      { type: "toolCall", functionCalls: [{ id: "f1", name: "propose_payment", args: { request: "x" } }] },
    ]);
    const deps = liveDeps();
    const c = runLive(s, deps);
    await settle();
    expect(sent.responses).toEqual([{ id: "f1", name: "propose_payment", response: { shown: true } }]);
    expect(c.isMicPaused()).toBe(true); // stays paused until the card closes
    c.sendMic("chunk");
    expect(sent.audio).toHaveLength(0);
    c.resume();
    c.sendMic("chunk");
    expect(sent.audio).toHaveLength(1);
    await c.stop();
  });
  it("model audio is dropped while muted and played otherwise", async () => {
    const { s } = mockSession([
      { type: "serverContent", modelTurn: { parts: [{ type: "inlineData", inlineData: { mimeType: "audio/pcm", data: "AAA" } }] } },
    ]);
    const deps = liveDeps();
    const c1 = runLive(s, deps);
    await settle();
    await c1.stop();
    expect(deps.onAudioOut).toHaveBeenCalledWith("AAA");
    const m = mockSession([{ type: "serverContent", modelTurn: { parts: [{ type: "inlineData", inlineData: { mimeType: "audio/pcm", data: "BBB" } }] } }]);
    const d2 = liveDeps();
    const c = runLive(m.s, d2, { startMuted: true });
    await settle();
    await c.stop();
    expect(d2.onAudioOut).not.toHaveBeenCalled();
  });
  it("tripwire on a transcription chunk: session closed, nothing more sent, no tool answer", async () => {
    const { s, sent } = mockSession([
      { type: "serverContent", inputTranscription: { text: "my pin is 4 8" } },
      { type: "serverContent", inputTranscription: { text: " 2 6" } },
      { type: "toolCall", functionCalls: [{ id: "f1", name: "propose_payment", args: {} }] },
    ]);
    const deps = liveDeps();
    const c = runLive(s, deps);
    await c.done;
    expect(deps.onTripwire).toHaveBeenCalledOnce();
    expect(s.isClosed).toBe(true);
    expect(sent.responses).toHaveLength(0);
    c.sendMic("late");
    expect(sent.audio).toHaveLength(0);
    expect(deps.understand).not.toHaveBeenCalled();
    // the secret never reaches the bubbles
    const all = (deps.onTurns as ReturnType<typeof vi.fn>).mock.calls.flat().flat() as LiveTurn[];
    expect(JSON.stringify(all)).not.toMatch(/4 8 2 6|pin is/);
    expect(deps.onEnd).toHaveBeenCalledWith("tripwire", "tripwire");
  });
  it("transcripts reach the screen as turns", async () => {
    const { s } = mockSession([
      { type: "serverContent", inputTranscription: { text: "hello" } },
      { type: "serverContent", outputTranscription: { text: "Hi!" }, turnComplete: true },
    ]);
    const deps = liveDeps();
    const c2 = runLive(s, deps);
    await settle();
    await c2.stop();
    const last = (deps.onTurns as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as LiveTurn[];
    expect(last.map((t) => t.text)).toEqual(["hello", "Hi!"]);
  });
  it("a receive error ends with an error outcome", async () => {
    const s: LiveSessionLike = { isClosed: false, receive: async function* () { throw new Error("quota exceeded"); }, sendAudioRealtime: async () => undefined, sendFunctionResponses: async () => undefined, close: async () => undefined };
    const deps = liveDeps();
    await runLive(s, deps).done;
    expect(deps.onEnd).toHaveBeenCalledWith("error", "quota", { reason: "Error quota exceeded", closeCode: undefined });
  });
  it("stop() closes the session once", async () => {
    const { s } = mockSession([]);
    const deps = liveDeps();
    const c = runLive(s, deps);
    await c.stop();
    await c.stop();
    await c.done;
    expect(deps.onEnd).toHaveBeenCalledTimes(1);
    expect(deps.onEnd).toHaveBeenCalledWith("ended", "stopped");
  });
});

describe("live error detail for the step log (no digits, no free text)", () => {
  it("sanitizeReason keeps name and message, removes every digit, keeps only letters, spaces and . : _ -, max 100", async () => {
    const { sanitizeReason } = await import("./live");
    const e = new Error("WebSocket 1006 closed (code=4001) at wss://x.y/z?key=abc123");
    e.name = "NetworkError";
    const r = sanitizeReason(e);
    expect(r).not.toMatch(/\d/);
    expect(r).toMatch(/^[A-Za-z .:_-]+$/);
    expect(r.startsWith("NetworkError")).toBe(true);
    expect(sanitizeReason(new Error("x".repeat(300))).length).toBe(100);
    expect(sanitizeReason("my pin is 1234")).not.toMatch(/\d/);
    expect(sanitizeReason(undefined)).toBe("undefined");
  });
  it("closeCodeOf reads an integer close code if the error carries one", async () => {
    const { closeCodeOf } = await import("./live");
    expect(closeCodeOf({ code: 1006 })).toBe(1006);
    expect(closeCodeOf({ closeCode: 4001 })).toBe(4001);
    expect(closeCodeOf({ code: "1006" })).toBeUndefined();
    expect(closeCodeOf(new Error("x"))).toBeUndefined();
    expect(closeCodeOf({ code: 99999 })).toBeUndefined();
  });
});
