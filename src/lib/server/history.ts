// The person's own receipts and activity, for the "My receipts and activity" section.
// Receipts are indexed by user id ("receipts_by_user", id = userId|time|receiptId), so this is one
// prefix read, not a scan of everyone's receipts.
import { formatAmount, type Amount } from "../money";
import type { Store } from "../store";
import { recentAudit, type AuditRecord } from "./audit";
import type { Receipt } from "./payflow";

export const HISTORY_RECEIPTS = 20;
export const HISTORY_EVENTS = 30;

export interface ReceiptRow {
  id: string;
  payeeName: string;
  debit: Amount;
  method: "pin" | "passkey";
  simulated: boolean;
  createdAt: string;
}
export type EventRow = Omit<AuditRecord, "userId">;
export interface History {
  ok: true;
  receipts: ReceiptRow[];
  events: EventRow[];
}

export async function loadHistory(store: Store, userId: string): Promise<History> {
  let rs = await store.list<Receipt>("receipts_by_user", { prefix: `${userId}|`, newestFirst: true, limit: HISTORY_RECEIPTS });
  if (rs.length === 0) {
    // Receipts saved before the per-person list existed: read them once the slow way, own ones only.
    rs = (await store.list<Receipt>("receipts")).filter((r) => r.userId === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, HISTORY_RECEIPTS);
  }
  const receipts = rs
    .filter((r) => r.userId === userId)
    .map((r) => ({ id: r.id, payeeName: r.payeeName, debit: r.debit, method: r.method, simulated: r.simulated, createdAt: r.createdAt }));
  const events = (await recentAudit(store, userId, HISTORY_EVENTS)).map(({ userId: _u, ...rest }) => rest);
  return { ok: true, receipts, events };
}

/** One receipt as a sentence for the screen reader and the voice. */
export function receiptSentence(r: ReceiptRow, locale?: string): string {
  const when = new Date(r.createdAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  return `${r.simulated ? "Simulated payment, no real money moved." : "Real payment."} ${formatAmount(r.debit)} to ${r.payeeName}, ${when}, approved by ${r.method === "passkey" ? "fingerprint" : "PIN"}.`;
}
