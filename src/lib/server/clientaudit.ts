// Steps only the browser can see (page opened, how an intent was read, how the voice loaded, an error).
// The browser may send ONLY these events, each with only its own small fields. The server rebuilds the
// record from the checked values, so a sentence, a name, an amount or a PIN cannot be stored even if
// sent. Server-side events (pay_start, pay_finish ...) cannot be forged through here.
import type { Store } from "../store";
import { audit, type AuditFields } from "./audit";
import { HttpError } from "./http";

export const CLIENT_ERROR_CODES = ["understand_failed", "chat_failed", "mic_failed", "start_failed", "approve_failed", "history_failed"] as const;
export const CLIENT_LIMIT_PER_MINUTE = 60;

const SOURCES = ["on_device", "cloud", "rules"];
const isMs = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3_600_000;

export function validateClientEvent(b: Record<string, unknown>): { event: string; fields: AuditFields } | null {
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
    default:
      return null;
  }
}

/** True while the person is under the limit; counts this call. One document per person, changed in one step. */
async function allow(store: Store, userId: string, now: number): Promise<boolean> {
  const minute = Math.floor(now / 60_000);
  return store.update<{ minute: number; count: number }, boolean>("audit_rate", userId, (cur) => {
    const count = cur && cur.minute === minute ? cur.count : 0;
    if (count >= CLIENT_LIMIT_PER_MINUTE) return { doc: cur, result: false };
    return { doc: { minute, count: count + 1 }, result: true };
  });
}

export async function recordClientEvent(store: Store, userId: string, body: Record<string, unknown>, now: number = Date.now()): Promise<{ ok: true }> {
  const v = validateClientEvent(body);
  if (!v) throw new HttpError(400, "bad_event");
  let ok = false;
  try {
    ok = await allow(store, userId, now);
  } catch {
    ok = true; // the limiter itself failing must not hide the event
  }
  if (!ok) throw new HttpError(429, "rate_limited");
  await audit(store, userId, v.event, v.fields, now);
  return { ok: true };
}
