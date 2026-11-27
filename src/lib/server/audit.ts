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

// Order here is the order printed on the console line.
const FIELDS: Record<string, Check> = {
  reason: word,
  receiptId: (v) => typeof v === "string" && /^rcpt_[A-Za-z0-9_-]{4,40}$/.test(v),
  method: oneOf("pin", "passkey"),
  asset: (v) => typeof v === "string" && /^[A-Z]{2,6}$/.test(v),
  simulated: (v) => typeof v === "boolean",
  source: oneOf("on_device", "cloud", "rules"),
  guarded: (v) => typeof v === "boolean",
  voice: oneOf("natural", "browser"),
  code: word,
  ms: (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3_600_000,
  requestId: (v) => typeof v === "string" && /^req_[A-Za-z0-9_-]{4,40}$/.test(v),
};
/** Kept in the person's own history but never printed. */
const STORED_ONLY: Record<string, Check> = {
  amountMinor: (v) => typeof v === "string" && /^\d{1,15}$/.test(v),
};

export type AuditFields = { outcome?: string; reason?: string; receiptId?: string; method?: "pin" | "passkey"; asset?: string; simulated?: boolean; source?: "on_device" | "cloud" | "rules"; guarded?: boolean; voice?: "natural" | "browser"; code?: string; ms?: number; requestId?: string; amountMinor?: string };

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
