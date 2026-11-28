// Audit log: one durable record per app action (Firestore collection "audit", server only) and one
// console line, because Vercel's free plan keeps logs for about an hour.
// Only WHITELISTED fields are kept, each with a strict shape. A PIN, a token or a name cannot get in:
// unknown keys are dropped, and the allowed text fields are letters and underscores only (no digits).
// An audit failure never breaks the payment.
import type { Store } from "../store";
import { randomToken } from "../secret";

type Check = (v: unknown) => boolean;
const word: Check = (v) => typeof v === "string" && /^[a-z_]{1,40}$/.test(v);
const oneOf = (...a: string[]): Check => (v) => typeof v === "string" && a.includes(v);
const int = (max: number): Check => (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

// Order here is the order printed on the console line.
const FIELDS: Record<string, Check> = {
  // letters, spaces and . : _ - only, no digits, 100 at most (a short sanitized error name and message, or a reason code)
  reason: (v) => typeof v === "string" && /^[A-Za-z _.:-]{1,100}$/.test(v),
  receiptId: (v) => typeof v === "string" && /^rcpt_[A-Za-z0-9_-]{4,40}$/.test(v),
  method: oneOf("pin", "passkey"),
  asset: (v) => typeof v === "string" && /^[A-Z]{2,6}$/.test(v),
  simulated: (v) => typeof v === "boolean",
  source: oneOf("on_device", "cloud", "rules", "none"),
  guarded: (v) => typeof v === "boolean",
  voice: oneOf("natural", "browser"),
  code: word,
  ms: (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3_600_000,
  requestId: (v) => typeof v === "string" && /^req_[A-Za-z0-9_-]{4,40}$/.test(v),
  // Browser step log (clientaudit.ts): enums, booleans and small integers only. Letters only for sid, so it
  // can never look like a PIN.
  sid: (v) => typeof v === "string" && /^[a-z]{8}$/.test(v),
  t: int(604_800_000),
  state: oneOf("start", "stop", "blocked"),
  speech: oneOf("local", "server", "downloading", "none", "checking"),
  mode: oneOf("local", "online"),
  chars: int(100_000),
  choice: oneOf("shown", "online", "type"),
  index: int(20),
  kind: oneOf("proposal", "intent", "unclear", "rejected", "secret_spoken"),
  cloud_raced: (v) => typeof v === "boolean",
  engine: oneOf("kokoro", "browser", "none"),
  ok: (v) => typeof v === "boolean",
  method_offered: oneOf("passkey", "pin"),
  action: oneOf("fingerprint", "pin", "cancel", "wallet_connect", "continue"),
  shown: (v) => typeof v === "boolean",
  tab: oneOf("talk", "receipts", "privacy"),
  count: int(1000),
  where: word,
  stage: oneOf("mic", "player", "connect", "session"),
  close_code: int(65_535),
  who: oneOf("person", "assistant"),
};
/** Kept in the person's own history but never printed. */
const STORED_ONLY: Record<string, Check> = {
  amountMinor: (v) => typeof v === "string" && /^\d{1,15}$/.test(v),
};

export type AuditFields = { outcome?: string; reason?: string; receiptId?: string; method?: "pin" | "passkey"; asset?: string; simulated?: boolean; source?: "on_device" | "cloud" | "rules" | "none"; guarded?: boolean; voice?: "natural" | "browser"; code?: string; ms?: number; requestId?: string; amountMinor?: string;
  sid?: string; t?: number; state?: string; speech?: string; mode?: string; chars?: number; choice?: string; index?: number; kind?: string; cloud_raced?: boolean; engine?: string; ok?: boolean;
  method_offered?: string; action?: string; shown?: boolean; tab?: string; count?: number; where?: string; stage?: string; close_code?: number; who?: string;
};

export interface AuditRecord extends AuditFields {
  userId: string;
  event: string;
  at: string;
}

/** Keeps only whitelisted fields with the right shape. */
export function cleanFields(fields: Record<string, unknown>): AuditFields {
  const out: Record<string, unknown> = {};
  if (word(fields.outcome)) out.outcome = fields.outcome;
  for (const [k, ok] of Object.entries({ ...FIELDS, ...STORED_ONLY })) if (k in fields && ok(fields[k])) out[k] = fields[k];
  return out as AuditFields;
}

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(13, "0");

export async function audit(store: Store, userId: string | null, event: string, fields: AuditFields = {}, now: number = Date.now()): Promise<void> {
  try {
    const f = cleanFields(fields as Record<string, unknown>);
    const evt = /^[a-z_]{1,40}$/.test(event) ? event : "unknown";
    const line = [`audit ${evt} ${f.outcome ?? "-"}`, ...Object.keys(FIELDS).filter((k) => k in f).map((k) => `${k}=${(f as Record<string, unknown>)[k]}`)].join(" ");
    console.info(line);
    if (userId) {
      const rec: AuditRecord = { ...f, userId, event: evt, at: new Date(now).toISOString() };
      await store.put("audit", `${userId}|${pad(now)}|${randomToken(4)}`, rec);
    }
  } catch {
    // never break the caller
  }
}

/** The person's own latest events, newest first. */
export async function recentAudit(store: Store, userId: string, limit: number): Promise<AuditRecord[]> {
  const rows = await store.list<AuditRecord>("audit", { prefix: `${userId}|`, newestFirst: true, limit });
  return rows.filter((r) => r.userId === userId);
}
