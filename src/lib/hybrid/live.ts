// Gemini Live prototype (Firebase AI Logic Live API), behind a flag that is OFF by default (?live=1).
// Plain code only: no Firebase import here, so every rule below is unit-tested with a mock session.
//
// Money stays locked exactly as in the normal flow:
//  - Live is only a voice. The model may call ONE tool, propose_payment, and it never approves anything.
//  - The tool arguments {payee, amount_naira} are only a suggestion: livepay.ts checks them in plain code
//    against the saved contacts, the spending limit and OUR transcript of what the person said. The PIN tripwire runs first.
//  - The read-back the person hears is our template, spoken by our own say(); Live audio is muted then.
//  - The PIN tripwire runs on every transcription chunk. HONEST LIMIT: with Live the audio itself has
//    already reached Google when the words are transcribed, so the tripwire cannot recall it. It stops
//    the session at once and nothing further is sent or used.
import { spokenSecret, type SecretKind } from "./tripwire";
import type { Understood } from "./understand";
import type { Contact } from "./crosscheck";
import { decideLivePayment, promisesDetails } from "./livepay";

export const LIVE_MODEL = "gemini-3.1-flash-live-preview"; // first Gemini Developer API model on firebase.google.com/docs/ai-logic/live-api
export const LIVE_FLAG_KEY = "payalone_live";

/** ?live=1 turns the prototype on for this tab session (remembered), ?live=0 turns it off. Default: off. */
export function liveEnabled(search: string, storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">): boolean {
  const q = new URLSearchParams(search).get("live");
  try {
    if (q === "1") storage?.setItem(LIVE_FLAG_KEY, "1");
    else if (q === "0") storage?.removeItem(LIVE_FLAG_KEY);
  } catch {
    /* storage blocked: the flag then only lasts for this page load */
  }
  if (q === "1") return true;
  if (q === "0") return false;
  try {
    return storage?.getItem(LIVE_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

// ---- transcripts ----------------------------------------------------------------------------------

export interface LiveTurn {
  who: "you" | "app";
  text: string;
  final: boolean;
}
export interface ServerContentLike {
  inputTranscription?: { text?: string };
  outputTranscription?: { text?: string };
  turnComplete?: boolean;
  interrupted?: boolean;
}

const finishLast = (t: LiveTurn[]): LiveTurn[] => (t.length && !t[t.length - 1].final ? [...t.slice(0, -1), { ...t[t.length - 1], final: true }] : t);

/** Folds one server message into the bubble list. Partial chunks grow the open bubble; returns a new array. */
export function applyServerContent(turns: LiveTurn[], m: ServerContentLike): LiveTurn[] {
  let t = turns;
  const add = (who: "you" | "app", text: string) => {
    const last = t[t.length - 1];
    if (last && last.who === who && !last.final) t = [...t.slice(0, -1), { ...last, text: last.text + text }];
    else t = [...finishLast(t), { who, text, final: false }];
  };
  if (m.inputTranscription?.text) add("you", m.inputTranscription.text);
  if (m.outputTranscription?.text) add("app", m.outputTranscription.text);
  if (m.turnComplete || m.interrupted) t = finishLast(t);
  return t;
}

/** The person's latest words, as we transcribed them. */
export function currentInput(turns: LiveTurn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].who === "you") return turns[i].text.trim();
  return "";
}

// ---- mic gate -------------------------------------------------------------------------------------

/** Chunks pass while open and are dropped (never queued) while paused, e.g. during approval. */
export function createMicGate<T>(send: (chunk: T) => void) {
  let paused = false;
  return {
    push: (c: T) => {
      if (!paused) send(c);
    },
    pause: () => void (paused = true),
    resume: () => void (paused = false),
    isPaused: () => paused,
  };
}

// ---- the one tool ---------------------------------------------------------------------------------

export type ToolResponse = { shown: boolean; reason?: string; names?: string[] };
export type ToolOutcome = { kind: "response"; response: ToolResponse } | { kind: "tripwire"; secret: SecretKind };
type ProposalResult = Extract<Understood, { kind: "proposal" }>;

export interface ToolDeps {
  latestInput: () => string;
  /** The person's last few turns, oldest first (e.g. "send 500 to Sunday", then "Yes, Tunde"). */
  recentInputs?: () => string[];
  contacts: Contact[];
  limitMinor: () => string;
  /** Opens the existing Approve card. False if the app could not (the dialog said no). */
  present: (r: ProposalResult, said: string) => Promise<boolean>;
  onTripwire: (secret: SecretKind) => void;
}

/** The arguments are checked in plain code against our own transcript (livepay.ts); they never open anything alone. */
export async function handleToolCall(call: { name: string; args?: unknown }, d: ToolDeps): Promise<ToolOutcome> {
  if (call.name !== "propose_payment") return { kind: "response", response: { shown: false, reason: "unknown_tool" } };
  const said = d.latestInput();
  const trip = spokenSecret(said);
  if (trip.tripped) {
    d.onTripwire(trip.kind ?? "pin");
    return { kind: "tripwire", secret: trip.kind ?? "pin" };
  }
  let v = decideLivePayment(call.args, said, d.contacts, d.limitMinor());
  let used = said;
  // A follow-up ("Yes, Tunde") may hold only part of the request: also try the last two, then three, turns
  // joined. The same plain checks apply, so an amount or name still has to be in what the person said.
  const recent = d.recentInputs?.() ?? [];
  for (let n = 2; !v.ok && v.reason !== "over_limit" && n <= Math.min(3, recent.length); n++) {
    const joined = recent.slice(-n).join(" ").trim();
    if (spokenSecret(joined).tripped) break;
    const w = decideLivePayment(call.args, joined, d.contacts, d.limitMinor());
    if (w.ok) {
      v = w;
      used = joined;
    }
  }
  if (!v.ok) return { kind: "response", response: { shown: false, reason: v.reason, ...(v.names ? { names: v.names } : {}) } };
  const r: ProposalResult = { kind: "proposal", proposal: v.proposal, needsApproval: true, source: "rules" };
  try {
    const ok = await d.present(r, used);
    return { kind: "response", response: ok ? { shown: true } : { shown: false, reason: "not_ready" } };
  } catch {
    return { kind: "response", response: { shown: false, reason: "failed" } };
  }
}

// ---- the session loop -----------------------------------------------------------------------------

type Part = { type?: string; inlineData?: { mimeType?: string; data?: string } };
type Msg =
  | ({ type: "serverContent"; modelTurn?: { parts?: Part[] } } & ServerContentLike)
  | { type: "toolCall"; functionCalls: { id?: string; name: string; args?: unknown }[] }
  | { type: string };

/** The part of Firebase's LiveSession that we use, so tests can pass a mock. */
export interface LiveSessionLike {
  readonly isClosed: boolean;
  receive(): AsyncGenerator<Msg>;
  sendAudioRealtime(blob: { mimeType: string; data: string }): Promise<void>;
  sendFunctionResponses(r: { id?: string; name: string; response: object }[]): Promise<void>;
  close(): Promise<void>;
}

export type LiveEnd = "ended" | "tripwire" | "error";
export interface LiveDeps {
  contacts: Contact[];
  limitMinor: () => string;
  present: ToolDeps["present"];
  /** Fallback only: the existing understand() path, used when the model promised details but never called the tool. */
  understand?: (said: string) => Promise<Understood>;
  /** Every tool call, answered: for the audit event (shown, reason) and the ?debug=1 panel (raw, memory only). */
  onTool?: (e: { shown: boolean; reason: string; call: { name: string; args?: unknown }; response: ToolResponse }) => void;
  /** A finished turn: who spoke and how many characters. Counts only. */
  onTurnDone?: (who: "person" | "assistant", chars: number) => void;
  onTurns: (turns: LiveTurn[]) => void;
  onTripwire: (secret: SecretKind) => void;
  /** Base64 16-bit PCM at 24 kHz from the model. Not called while output is muted. */
  onAudioOut: (b64: string) => void;
  /** The person talked over the model: drop any audio still queued. */
  onInterrupted?: () => void;
  /** Called once. code is a fixed word for the audit event, never text. */
  onEnd: (how: LiveEnd, code?: string, detail?: { reason: string; closeCode?: number }) => void;
}

/** Error text for the step log: name and message, every digit removed, only letters, spaces and . : _ - kept, max 100. */
export function sanitizeReason(e: unknown): string {
  const raw = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return raw.replace(/[^A-Za-z .:_-]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** An integer WebSocket close code, if the error carries one. */
export function closeCodeOf(e: unknown): number | undefined {
  if (!e || typeof e !== "object") return undefined;
  const o = e as Record<string, unknown>;
  for (const v of [o.code, o.closeCode]) if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 65_535) return v;
  return undefined;
}

export function liveErrorCode(e: unknown): string {
  const m = (e instanceof Error ? `${e.name} ${e.message}` : String(e)).toLowerCase();
  if (/notallowed|permission|denied/.test(m)) return "mic_denied";
  if (/quota|429|exhaust|rate/.test(m)) return "quota";
  if (/unavailable|not found|404|503|unsupported|network/.test(m)) return "unavailable";
  return "other";
}

export function runLive(session: LiveSessionLike, d: LiveDeps, opts: { startMuted?: boolean } = {}) {
  let turns: LiveTurn[] = [];
  let ended = false;
  let muted = Boolean(opts.startMuted);
  let counted = 0;
  let toolSeen = false; // a tool call came in during the current turn
  const gate = createMicGate<string>((b64) => void session.sendAudioRealtime({ mimeType: "audio/pcm;rate=16000", data: b64 }).catch(() => undefined));

  const finish = async (how: LiveEnd, code?: string, detail?: { reason: string; closeCode?: number }) => {
    if (ended) return;
    ended = true;
    gate.pause();
    try {
      await session.close();
    } catch {
      /* already closed */
    }
    if (detail) d.onEnd(how, code, detail);
    else d.onEnd(how, code);
  };
  const trip = async (secret: SecretKind) => {
    if (ended) return;
    d.onTripwire(secret); // the page shows "PIN stopped" and speaks the warning
    await finish("tripwire", "tripwire");
  };

  /** At the end of a turn: if the model promised to show details but called no tool, run the person's words through understand() ourselves. */
  async function fallback() {
    const sawTool = toolSeen;
    toolSeen = false;
    if (sawTool || ended || muted || !d.understand) return;
    const reply = [...turns].reverse().find((t) => t.who === "app")?.text ?? "";
    const said = currentInput(turns);
    if (!said || !promisesDetails(reply) || spokenSecret(said).tripped) return;
    try {
      const r = await d.understand(said);
      if (r.kind !== "proposal") return;
      const ok = await d.present(r, said);
      if (ok) {
        gate.pause();
        muted = true;
      }
      d.onTool?.({ shown: ok, reason: ok ? "fallback" : "not_ready", call: { name: "fallback" }, response: { shown: ok } });
    } catch {
      /* the normal flow stays available */
    }
  }

  async function onMessage(m: Msg) {
    if (m.type === "serverContent") {
      const c = m as Extract<Msg, { type: "serverContent" }>;
      if (c.inputTranscription?.text) {
        const next = applyServerContent(turns, c);
        const t = spokenSecret(currentInput(next));
        if (t.tripped) return trip(t.kind ?? "pin"); // the words are never shown or kept
      }
      const heard = muted ? { ...c, outputTranscription: undefined } : c; // not heard, so not shown either
      if (c.interrupted) d.onInterrupted?.();
      turns = applyServerContent(turns, heard);
      d.onTurns(turns);
      while (counted < turns.length && turns[counted].final) {
        d.onTurnDone?.(turns[counted].who === "you" ? "person" : "assistant", turns[counted].text.length);
        counted++;
      }
      if (c.turnComplete) await fallback();
      if (!muted) for (const p of c.modelTurn?.parts ?? []) if (p.inlineData?.data && (p.inlineData.mimeType ?? "").startsWith("audio/")) d.onAudioOut(p.inlineData.data);
    } else if (m.type === "toolCall") {
      toolSeen = true;
      for (const call of (m as Extract<Msg, { type: "toolCall" }>).functionCalls) {
        let out: ToolOutcome;
        try {
          out = await handleToolCall(call, {
            latestInput: () => currentInput(turns),
            recentInputs: () => turns.filter((t) => t.who === "you").slice(-3).map((t) => t.text.trim()),
            contacts: d.contacts,
            limitMinor: d.limitMinor,
            present: async (r, said) => {
              const ok = await d.present(r, said);
              if (ok) {
                gate.pause(); // no audio goes to Live while the card is open
                muted = true; // and its voice stays silent: our own read-back is the only thing spoken
              }
              return ok;
            },
            onTripwire: (s) => void trip(s),
          });
        } catch {
          out = { kind: "response", response: { shown: false, reason: "failed" } };
        }
        if (out.kind === "tripwire" || ended) return; // nothing further is sent
        d.onTool?.({ shown: out.response.shown, reason: out.response.shown ? "ok" : (out.response.reason ?? "failed"), call, response: out.response });
        await session.sendFunctionResponses([{ ...(call.id ? { id: call.id } : {}), name: call.name, response: out.response }]);
      }
    }
  }

  const done = (async () => {
    try {
      while (!ended && !session.isClosed) {
        for await (const m of session.receive()) {
          if (ended) break;
          await onMessage(m);
        }
      }
      await finish("ended");
    } catch (e) {
      await finish("error", liveErrorCode(e), { reason: sanitizeReason(e), closeCode: closeCodeOf(e) });
    }
  })();

  return {
    done,
    sendMic: (b64: string) => {
      if (!ended) gate.push(b64);
    },
    pauseMic: gate.pause,
    resume: () => {
      muted = false;
      if (!ended) gate.resume();
    },
    isMicPaused: gate.isPaused,
    setOutputMuted: (v: boolean) => void (muted = v),
    stop: () => finish("ended", "stopped"),
  };
}
export type LiveController = ReturnType<typeof runLive>;
