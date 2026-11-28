// Steps only the browser can see (page opened, how an intent was read, how the voice loaded, an error).
// The browser may send ONLY these events, each with only its own small fields. The server rebuilds the
// record from the checked values, so a sentence, a name, an amount or a PIN cannot be stored even if
// sent. Server-side events (pay_start, pay_finish ...) cannot be forged through here.
import type { Store } from "../store";
import { audit, type AuditFields } from "./audit";
import { HttpError } from "./http";

export const CLIENT_ERROR_CODES = ["understand_failed", "chat_failed", "mic_failed", "start_failed", "approve_failed", "history_failed"] as const;
/** Chrome speech errors as the app reports them: only a code, never a transcript. */
export const SPEECH_ERROR_CODES = ["not_allowed", "service_not_allowed", "network", "language_not_supported", "audio_capture", "other"] as const;
/** Gemini Live prototype: why a session ended or failed. A fixed list, never text. */
export const LIVE_CODES = ["mic_denied", "unavailable", "quota", "tripwire", "stopped", "other"] as const;
export const CLIENT_LIMIT_PER_MINUTE = 300;
export const MAX_BATCH = 50;

const SOURCES = ["on_device", "cloud", "rules"];
const isMs = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3_600_000;

type Check = (v: unknown) => boolean;
const oneOf = (...a: string[]): Check => (v) => typeof v === "string" && a.includes(v);
const bool: Check = (v) => typeof v === "boolean";
const word: Check = (v) => typeof v === "string" && /^[a-z_]{1,40}$/.test(v);
const int = (max: number): Check => (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/**
 * The step log: each event lists its own fields and the check for each. Anything not listed is dropped.
 * `outcome` is "ok" unless the event says otherwise: a fixed word, a list the client may choose from, or a
 * field that decides it (speak: ok -> ok or fail).
 */
const STEP_EVENTS: Record<string, { fields?: Record<string, Check>; optional?: Record<string, Check>; outcome?: string | Check }> = {
  mic_tap: { fields: { state: oneOf("start", "stop", "blocked"), speech: oneOf("local", "server", "downloading", "none", "checking") } },
  listen_start: { fields: { mode: oneOf("local", "online") } },
  listen_end: { outcome: oneOf("heard", "silence", "error", "stopped"), fields: { ms: int(3_600_000), chars: int(100_000) } },
  speech_consent: { fields: { choice: oneOf("shown", "online", "type") } },
  typed_submit: { fields: { chars: int(100_000) } },
  example_chip: { fields: { index: int(20) } },
  understand_done: { fields: { source: oneOf("rules", "on_device", "cloud", "none"), kind: oneOf("proposal", "intent", "unclear", "rejected", "secret_spoken"), ms: int(3_600_000), cloud_raced: bool } },
  chat_done: { fields: { source: oneOf("rules", "on_device", "cloud", "none"), ms: int(3_600_000), guarded: bool } },
  speak: { fields: { engine: oneOf("kokoro", "browser", "none"), ms: int(3_600_000), ok: bool } },
  approve_open: { fields: { method_offered: oneOf("passkey", "pin") } },
  approve_action: { outcome: oneOf("ok", "fail", "cancel"), fields: { action: oneOf("fingerprint", "pin", "cancel", "wallet_connect", "continue"), ms: int(3_600_000) } },
  payment_result: { outcome: oneOf("paid", "failed", "stopped"), fields: { ms: int(3_600_000) }, optional: { simulated: bool } },
  tab_switch: { fields: { tab: oneOf("talk", "receipts", "privacy") } },
  history_load: { fields: { count: int(1000), ms: int(3_600_000) } },
  read_receipt: {},
  live_tool: { fields: { shown: bool, reason: word } },
  client_error: { outcome: "fail", fields: { where: word, code: word } },
};

export function validateClientEvent(b: Record<string, unknown>): { event: string; fields: AuditFields } | null {
  const v = validateOne(b);
  if (!v) return null;
  // Order of a run: the page-load session id and ms since page load. A malformed one is dropped, not fatal.
  if (typeof b.sid === "string" && /^[a-z]{8}$/.test(b.sid)) v.fields.sid = b.sid;
  if (int(604_800_000)(b.t)) v.fields.t = b.t as number;
  return v;
}

function validateOne(b: Record<string, unknown>): { event: string; fields: AuditFields } | null {
  const spec = typeof b.event === "string" && Object.prototype.hasOwnProperty.call(STEP_EVENTS, b.event) ? STEP_EVENTS[b.event] : undefined;
  if (spec) {
    const fields: Record<string, unknown> = {};
    for (const [k, ok] of Object.entries(spec.fields ?? {})) {
      if (!ok(b[k])) return null;
      fields[k] = b[k];
    }
    for (const [k, ok] of Object.entries(spec.optional ?? {})) if (k in b && ok(b[k])) fields[k] = b[k];
    let outcome: unknown = "ok";
    if (typeof spec.outcome === "string") outcome = spec.outcome;
    else if (spec.outcome) {
      if (!spec.outcome(b.outcome)) return null;
      outcome = b.outcome;
    } else if (b.event === "speak") outcome = b.ok ? "ok" : "fail";
    return { event: b.event as string, fields: { outcome: outcome as string, ...fields } as AuditFields };
  }
  switch (b.event) {
    case "app_start":
      return { event: "app_start", fields: { outcome: "ok" } };
    case "intent":
      return typeof b.source === "string" && SOURCES.includes(b.source) && isMs(b.ms) ? { event: "intent", fields: { outcome: "ok", source: b.source as AuditFields["source"], ms: b.ms } } : null;
    case "chat_reply":
      return typeof b.source === "string" && SOURCES.includes(b.source) && typeof b.guarded === "boolean"
        ? { event: "chat_reply", fields: { outcome: "ok", source: b.source as AuditFields["source"], guarded: b.guarded } }
        : null;
    case "voice_ready":
      return b.voice === "natural" || b.voice === "browser" ? { event: "voice_ready", fields: { outcome: "ok", voice: b.voice } } : null;
    case "error":
      return typeof b.code === "string" && (CLIENT_ERROR_CODES as readonly string[]).includes(b.code) ? { event: "error", fields: { outcome: "fail", code: b.code } } : null;
    case "speech_error":
      return typeof b.code === "string" && (SPEECH_ERROR_CODES as readonly string[]).includes(b.code) ? { event: "speech_error", fields: { outcome: "fail", code: b.code } } : null;
    case "live_session":
      if (b.outcome !== "started" && b.outcome !== "ended" && b.outcome !== "error") return null;
    {
      const fields: AuditFields = { outcome: b.outcome };
      if (b.code !== undefined) {
        if (typeof b.code !== "string" || !(LIVE_CODES as readonly string[]).includes(b.code)) return null;
        fields.code = b.code;
      }
      // Where it failed and a sanitized error text (the app strips digits; checked again here). Bad ones are dropped.
      if (oneOf("mic", "player", "connect", "session")(b.stage)) fields.stage = b.stage as string;
      if (typeof b.reason === "string" && /^[A-Za-z _.:-]{1,100}$/.test(b.reason)) fields.reason = b.reason;
      if (int(65_535)(b.close_code)) fields.close_code = b.close_code as number;
      return { event: "live_session", fields };
    }
    default:
      return null;
  }
}

/** How many of `n` events fit under the limit; counts them. One document per person, changed in one step. */
async function allowUpTo(store: Store, userId: string, n: number, now: number): Promise<number> {
  const minute = Math.floor(now / 60_000);
  return store.update<{ minute: number; count: number }, number>("audit_rate", userId, (cur) => {
    const used = cur && cur.minute === minute ? cur.count : 0;
    const granted = Math.max(0, Math.min(n, CLIENT_LIMIT_PER_MINUTE - used));
    if (granted === 0) return { doc: cur, result: 0 };
    return { doc: { minute, count: used + granted }, result: granted };
  });
}

export async function recordClientEvent(store: Store, userId: string, body: Record<string, unknown>, now: number = Date.now()): Promise<{ ok: true }> {
  const v = validateClientEvent(body);
  if (!v) throw new HttpError(400, "bad_event");
  let granted = 0;
  try {
    granted = await allowUpTo(store, userId, 1, now);
  } catch {
    granted = 0; // fail closed: if the limiter cannot count, the event is dropped
  }
  if (!granted) throw new HttpError(429, "rate_limited");
  await audit(store, userId, v.event, v.fields, now);
  return { ok: true };
}

/** Up to 50 events in one call. Each goes through the same check as a single event; bad ones are dropped. */
export async function recordClientBatch(store: Store, userId: string, body: Record<string, unknown>, now: number = Date.now()): Promise<{ ok: true; stored: number; dropped: number }> {
  const list = body.events;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH) throw new HttpError(400, "bad_batch");
  const good: { event: string; fields: AuditFields }[] = [];
  for (const e of list) {
    const v = e && typeof e === "object" && !Array.isArray(e) ? validateClientEvent(e as Record<string, unknown>) : null;
    if (v) good.push(v);
  }
  if (good.length === 0) return { ok: true, stored: 0, dropped: list.length };
  let granted = 0;
  try {
    granted = await allowUpTo(store, userId, good.length, now);
  } catch {
    granted = 0; // fail closed
  }
  if (!granted) throw new HttpError(429, "rate_limited");
  // One millisecond apart, so the saved order is the order the steps happened in.
  for (let i = 0; i < granted; i++) await audit(store, userId, good[i].event, good[i].fields, now + i);
  return { ok: true, stored: granted, dropped: list.length - granted };
}
