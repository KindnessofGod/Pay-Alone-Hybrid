// Gemini Live prototype (Firebase AI Logic Live API), behind a flag that is OFF by default (?live=1).
// Plain code only: no Firebase import here, so every rule below is unit-tested with a mock session.
//
// Money stays locked exactly as in the normal flow:
//  - Live is only a voice. The model may call ONE tool, propose_payment, and it never approves anything.
//  - The words used for a payment are OUR transcript of what the person said (input transcription), not
//    the tool arguments. They go through the existing path: tripwire -> understand() -> crossCheck.
//  - The read-back the person hears is our template, spoken by our own say(); Live audio is muted then.
//  - The PIN tripwire runs on every transcription chunk. HONEST LIMIT: with Live the audio itself has
//    already reached Google when the words are transcribed, so the tripwire cannot recall it. It stops
//    the session at once and nothing further is sent or used.
import { spokenSecret, type SecretKind } from "./tripwire";
import type { Understood } from "./understand";

export const LIVE_MODEL = "gemini-3.1-flash-live-preview"; // first Gemini Developer API model on firebase.google.com/docs/ai-logic/live-api
export const LIVE_FLAG_KEY = "payalone_live";

export const LIVE_SYSTEM_INSTRUCTION =
  "You are the friendly voice assistant of Pay Alone, a payment app for blind, elderly and non-reading people. " +
  "Speak English. Keep every answer short and plain, one or two sentences. " +
  "You can never approve, confirm or send money, and you never say that money was sent. " +
  "Never ask for a PIN, a password or a code, and never repeat one. If a PIN comes up, tell the person to type it on the keypad on the screen. " +
  "When the person wants to pay someone, call the tool propose_payment with request set to the person's own words. " +
  "After you call it, say only that you will show them the details. Do not repeat the name or the amount.";

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

export type ToolOutcome = { kind: "response"; response: { shown: boolean; reason?: string } } | { kind: "tripwire"; secret: SecretKind };

export interface ToolDeps {
  latestInput: () => string;
  understand: (said: string) => Promise<Understood>;
  /** Opens the existing Approve card. False if the app could not (the dialog said no). */
  present: (r: Extract<Understood, { kind: "proposal" }>, said: string) => Promise<boolean>;
  onTripwire: (secret: SecretKind) => void;
}

/** The tool arguments are ignored on purpose: our own transcript is the source of truth. */
export async function handleToolCall(call: { name: string; args?: unknown }, d: ToolDeps): Promise<ToolOutcome> {
  if (call.name !== "propose_payment") return { kind: "response", response: { shown: false, reason: "unknown_tool" } };
  const said = d.latestInput();
  if (!said) return { kind: "response", response: { shown: false, reason: "no_transcript" } };
  const trip = spokenSecret(said);
  if (trip.tripped) {
    d.onTripwire(trip.kind ?? "pin");
    return { kind: "tripwire", secret: trip.kind ?? "pin" };
  }
  let r: Understood;
  try {
    r = await d.understand(said);
  } catch {
    return { kind: "response", response: { shown: false, reason: "failed" } };
  }
  if (r.kind === "secret_spoken") {
    d.onTripwire(r.secret);
    return { kind: "tripwire", secret: r.secret };
  }
  if (r.kind === "proposal") {
    const ok = await d.present(r, said).catch(() => false);
    return { kind: "response", response: ok ? { shown: true } : { shown: false, reason: "not_ready" } };
  }
  return { kind: "response", response: { shown: false, reason: r.kind === "rejected" ? r.reason : "unclear" } };
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
  understand: ToolDeps["understand"];
  present: ToolDeps["present"];
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
      if (!muted) for (const p of c.modelTurn?.parts ?? []) if (p.inlineData?.data && (p.inlineData.mimeType ?? "").startsWith("audio/")) d.onAudioOut(p.inlineData.data);
    } else if (m.type === "toolCall") {
      for (const call of (m as Extract<Msg, { type: "toolCall" }>).functionCalls) {
        const out = await handleToolCall(call, {
          latestInput: () => currentInput(turns),
          understand: d.understand,
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
        if (out.kind === "tripwire" || ended) return; // nothing further is sent
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
