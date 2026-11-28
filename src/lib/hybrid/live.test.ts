import { describe, expect, it, vi } from "vitest";
import { applyServerContent, createMicGate, currentInput, handleToolCall, liveEnabled, runLive, type LiveDeps, type LiveSessionLike, type LiveTurn } from "./live";

function store(initial: Record<string, string> = {}) {
  const m = { ...initial };
  return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => void (m[k] = v), removeItem: (k: string) => void delete m[k], m };
}

describe("liveEnabled (Live is the default; ?live=0 turns it off)", () => {
  it("is on with nothing set", () => expect(liveEnabled("", store())).toBe(true));
  it("?live=0 turns it off and remembers it for the tab", () => {
    const s = store();
    expect(liveEnabled("?live=0", s)).toBe(false);
    expect(liveEnabled("", s)).toBe(false);
  });
  it("?live=1 turns it back on and forgets the off switch", () => {
    const s = store({ payalone_live: "0" });
    expect(liveEnabled("?live=1", s)).toBe(true);
    expect(liveEnabled("", s)).toBe(true);
  });
  it("any other value does nothing", () => {
    expect(liveEnabled("?live=yes", store())).toBe(true);
    expect(liveEnabled("?live=no", store({ payalone_live: "0" }))).toBe(false);
  });
  it("works with no storage or storage that throws", () => {
    expect(liveEnabled("?live=0", undefined)).toBe(false);
    expect(liveEnabled("", undefined)).toBe(true);
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(liveEnabled("?live=0", bad)).toBe(false);
    expect(liveEnabled("", bad)).toBe(true);
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

const CONTACTS = [
  { id: "c1", name: "Mama Ade" },
  { id: "c2", name: "Tunde" },
  { id: "c3", name: "Chidi Okafor" },
];
const args = (over: Record<string, unknown> = {}) => ({ payee: "Tunde", amount_naira: 2000, request: "x", ...over });
function toolDeps(over: Partial<Parameters<typeof handleToolCall>[1]> = {}) {
  return {
    latestInput: () => "send 2000 naira to Tunde",
    contacts: CONTACTS,
    limitMinor: () => "5000000",
    present: vi.fn(async () => true),
    onTripwire: vi.fn(),
    ...over,
  };
}

describe("handleToolCall", () => {
  it("valid args that match the transcript: opens the card with a proposal in kobo, answers shown:true", async () => {
    const d = toolDeps();
    const r = await handleToolCall({ name: "propose_payment", args: args() }, d);
    expect(d.present).toHaveBeenCalledWith({ kind: "proposal", proposal: { amountMinor: "200000", payeeId: "c2", payeeName: "Tunde" }, needsApproval: true, source: "rules" }, "send 2000 naira to Tunde");
    expect(r).toEqual({ kind: "response", response: { shown: true } });
  });
  it("a misheard name (Tundi) still works when Tunde is the closest contact", async () => {
    const d = toolDeps({ latestInput: () => "send 500 to Tundi" });
    expect(await handleToolCall({ name: "propose_payment", args: args({ amount_naira: 500 }) }, d)).toEqual({ kind: "response", response: { shown: true } });
  });
  it("a follow-up turn ('Yes, Tunde') still works: the amount and name may come from the person's last few turns", async () => {
    const d = toolDeps({ latestInput: () => "Yes, Tunde", recentInputs: () => ["I would like to send 500 naira to Sunday", "Yes, Tunde"] });
    expect(await handleToolCall({ name: "propose_payment", args: args({ amount_naira: 500 }) }, d)).toEqual({ kind: "response", response: { shown: true } });
    expect(d.present).toHaveBeenCalledWith(expect.objectContaining({ proposal: { amountMinor: "50000", payeeId: "c2", payeeName: "Tunde" } }), "I would like to send 500 naira to Sunday Yes, Tunde");
  });
  it("earlier turns never add an amount the person did not say", async () => {
    const d = toolDeps({ latestInput: () => "yes", recentInputs: () => ["send 500 naira to Tunde", "yes"] });
    expect(await handleToolCall({ name: "propose_payment", args: args({ amount_naira: 900 }) }, d)).toEqual({ kind: "response", response: { shown: false, reason: "amount_not_heard" } });
  });
  it("unknown payee: shown:false, reason and the saved names, no card", async () => {
    const d = toolDeps();
    const r = await handleToolCall({ name: "propose_payment", args: args({ payee: "Sunday" }) }, d);
    expect(r).toEqual({ kind: "response", response: { shown: false, reason: "unknown_payee", names: ["Mama Ade", "Tunde", "Chidi Okafor"] } });
    expect(d.present).not.toHaveBeenCalled();
  });
  it("amount not in the transcript: amount_not_heard", async () => {
    const d = toolDeps({ latestInput: () => "send some money to Tunde" });
    expect(await handleToolCall({ name: "propose_payment", args: args() }, d)).toEqual({ kind: "response", response: { shown: false, reason: "amount_not_heard" } });
    expect(d.present).not.toHaveBeenCalled();
  });
  it("over the limit: over_limit", async () => {
    const d = toolDeps({ limitMinor: () => "100000" });
    expect(await handleToolCall({ name: "propose_payment", args: args() }, d)).toEqual({ kind: "response", response: { shown: false, reason: "over_limit" } });
  });
  it("no transcript yet: not_ready", async () => {
    const d = toolDeps({ latestInput: () => "" });
    expect(await handleToolCall({ name: "propose_payment", args: args() }, d)).toEqual({ kind: "response", response: { shown: false, reason: "not_ready" } });
  });
  it("card refused by the dialog: not_ready", async () => {
    const d = toolDeps({ present: vi.fn(async () => false) });
    expect(await handleToolCall({ name: "propose_payment", args: args() }, d)).toEqual({ kind: "response", response: { shown: false, reason: "not_ready" } });
  });
  it("present throws: failed", async () => {
    const d = toolDeps({ present: vi.fn(async () => { throw new Error("boom"); }) });
    expect(await handleToolCall({ name: "propose_payment", args: args() }, d)).toEqual({ kind: "response", response: { shown: false, reason: "failed" } });
  });
  describe("Nano double-check before the card", () => {
    const agree = { result: "agree" as const, source: "on_device" as const };
    it("agree: the card opens with source on_device and the check is reported", async () => {
      const deviceCheck = vi.fn(async () => agree);
      const onCheck = vi.fn();
      const d = toolDeps({ deviceCheck, onCheck });
      const r = await handleToolCall({ name: "propose_payment", args: args() }, d);
      expect(deviceCheck).toHaveBeenCalledWith("send 2000 naira to Tunde", { amountMinor: "200000", payeeId: "c2" });
      expect(d.present).toHaveBeenCalledWith(expect.objectContaining({ source: "on_device" }), "send 2000 naira to Tunde", { deviceCheck: "agree" });
      expect(onCheck).toHaveBeenCalledWith(agree);
      expect(r).toEqual({ kind: "response", response: { shown: true } });
    });
    it("mismatch: no card, device_check_mismatch, reported", async () => {
      const onCheck = vi.fn();
      const d = toolDeps({ deviceCheck: async () => ({ result: "mismatch" as const, source: "on_device" as const }), onCheck });
      const r = await handleToolCall({ name: "propose_payment", args: args() }, d);
      expect(d.present).not.toHaveBeenCalled();
      expect(r).toEqual({ kind: "response", response: { shown: false, reason: "device_check_mismatch" } });
      expect(onCheck).toHaveBeenCalledWith({ result: "mismatch", source: "on_device" });
    });
    it("unavailable: the card still opens, honestly marked rules", async () => {
      const onCheck = vi.fn();
      const d = toolDeps({ deviceCheck: async () => ({ result: "unavailable" as const, source: "rules" as const }), onCheck });
      const r = await handleToolCall({ name: "propose_payment", args: args() }, d);
      expect(d.present).toHaveBeenCalledWith(expect.objectContaining({ source: "rules" }), "send 2000 naira to Tunde", { deviceCheck: "unavailable" });
      expect(onCheck).toHaveBeenCalledWith({ result: "unavailable", source: "rules" });
      expect(r).toEqual({ kind: "response", response: { shown: true } });
    });
    it("a check that throws counts as unavailable, never as a block", async () => {
      const d = toolDeps({ deviceCheck: async () => { throw new Error("x"); } });
      expect(await handleToolCall({ name: "propose_payment", args: args() }, d)).toEqual({ kind: "response", response: { shown: true } });
    });
    it("plain-code failure never reaches the check", async () => {
      const deviceCheck = vi.fn();
      const d = toolDeps({ deviceCheck, latestInput: () => "send some money to Tunde" });
      await handleToolCall({ name: "propose_payment", args: args() }, d);
      expect(deviceCheck).not.toHaveBeenCalled();
    });
    it("the PIN tripwire runs before the check", async () => {
      const deviceCheck = vi.fn();
      const d = toolDeps({ deviceCheck, latestInput: () => "my pin is 4 8 2 6" });
      const r = await handleToolCall({ name: "propose_payment", args: args() }, d);
      expect(r.kind).toBe("tripwire");
      expect(deviceCheck).not.toHaveBeenCalled();
    });
  });
  it("spoken PIN in the transcript: tripwire, nothing checked, no response", async () => {
    const d = toolDeps({ latestInput: () => "my pin is 4 8 2 6" });
    const r = await handleToolCall({ name: "propose_payment", args: args() }, d);
    expect(r).toEqual({ kind: "tripwire", secret: "pin" });
    expect(d.present).not.toHaveBeenCalled();
    expect(d.onTripwire).toHaveBeenCalledOnce();
  });
  it("unknown tool: shown:false", async () => {
    expect(await handleToolCall({ name: "approve_payment", args: {} }, toolDeps())).toEqual({ kind: "response", response: { shown: false, reason: "unknown_tool" } });
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
    contacts: CONTACTS,
    limitMinor: () => "5000000",
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
      { type: "toolCall", functionCalls: [{ id: "f1", name: "propose_payment", args: args() }] },
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
    expect(deps.present).not.toHaveBeenCalled();
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

describe("runLive: the model always gets an answer, and the events carry no content", () => {
  const call = (a: unknown) => ({ type: "toolCall", functionCalls: [{ id: "f1", name: "propose_payment", args: a }] });
  const say = { type: "serverContent", inputTranscription: { text: "send 2000 naira to Tunde" } };
  it("every failure reason is answered, never left waiting", async () => {
    for (const [a, reason] of [
      [args({ payee: "Sunday" }), "unknown_payee"],
      [args({ amount_naira: 3000 }), "amount_not_heard"],
      [args({ amount_naira: 99999999 }), "over_limit"],
    ] as const) {
      const { s, sent } = mockSession([say, call(a)]);
      const c = runLive(s, liveDeps());
      await settle();
      expect(sent.responses, reason).toHaveLength(1);
      expect(sent.responses[0]).toMatchObject({ id: "f1", name: "propose_payment", response: { shown: false, reason } });
      await c.stop();
    }
  });
  it("a card that throws is answered failed", async () => {
    const { s, sent } = mockSession([say, call(args())]);
    const c = runLive(s, liveDeps({ present: vi.fn(async () => { throw new Error("x"); }) }));
    await settle();
    expect(sent.responses[0]).toMatchObject({ response: { shown: false, reason: "failed" } });
    await c.stop();
  });
  it("onTool reports shown and a reason code only", async () => {
    const { s } = mockSession([say, call(args())]);
    const onTool = vi.fn();
    const c = runLive(s, liveDeps({ onTool }));
    await settle();
    expect(onTool).toHaveBeenCalledWith({ shown: true, reason: "ok", call: { id: "f1", name: "propose_payment", args: args() }, response: { shown: true } });
    await c.stop();
  });
  it("onTurnDone reports who and a character count for each finished turn", async () => {
    const { s } = mockSession([
      { type: "serverContent", inputTranscription: { text: "hello" } },
      { type: "serverContent", outputTranscription: { text: "Hi there" } },
      { type: "serverContent", turnComplete: true },
    ]);
    const onTurnDone = vi.fn();
    const c = runLive(s, liveDeps({ onTurnDone }));
    await settle();
    expect(onTurnDone.mock.calls).toEqual([["person", 5], ["assistant", 8]]);
    await c.stop();
  });
});

describe("runLive: fallback when the model promises details but never called the tool", () => {
  const prop = { kind: "proposal", proposal: { amountMinor: "50000", payeeId: "c2", payeeName: "Tunde" }, needsApproval: true, source: "rules" } as const;
  const turn = (said: string, reply: string, extra: unknown[] = []) => [
    { type: "serverContent", inputTranscription: { text: said } },
    { type: "serverContent", outputTranscription: { text: reply } },
    ...extra,
    { type: "serverContent", turnComplete: true },
  ];
  it("runs the person's words through understand() and opens the card", async () => {
    const { s } = mockSession(turn("send 500 naira to Sunday", "I'll show you the details. Is that okay?"));
    const understand = vi.fn(async () => prop);
    const deps = liveDeps({ understand });
    const c = runLive(s, deps);
    await settle();
    expect(understand).toHaveBeenCalledWith("send 500 naira to Sunday");
    expect(deps.present).toHaveBeenCalledWith(prop, "send 500 naira to Sunday");
    await c.stop();
  });
  it("does nothing when the tool was called in that turn", async () => {
    const { s } = mockSession(turn("send 2000 naira to Tunde", "I'll show you the details.", [{ type: "toolCall", functionCalls: [{ id: "f1", name: "propose_payment", args: args() }] }]));
    const understand = vi.fn(async () => prop);
    const deps = liveDeps({ understand });
    const c = runLive(s, deps);
    await settle();
    expect(understand).not.toHaveBeenCalled();
    expect(deps.present).toHaveBeenCalledTimes(1);
    await c.stop();
  });
  it("does nothing when understand() does not give a proposal, or the reply makes no promise", async () => {
    for (const [reply, u] of [["I'll show you the details.", { kind: "unclear", source: "rules" }], ["Who do you want to pay?", prop]] as const) {
      const { s } = mockSession(turn("send 500 naira to Sunday", reply));
      const understand = vi.fn(async () => u as never);
      const deps = liveDeps({ understand });
      const c = runLive(s, deps);
      await settle();
      expect(deps.present).not.toHaveBeenCalled();
      await c.stop();
    }
  });
  it("a spoken PIN never reaches understand()", async () => {
    const { s } = mockSession(turn("my pin is 4 8 2 6", "I'll show you the details."));
    const understand = vi.fn(async () => prop);
    const c = runLive(s, liveDeps({ understand }));
    await c.done;
    expect(understand).not.toHaveBeenCalled();
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
