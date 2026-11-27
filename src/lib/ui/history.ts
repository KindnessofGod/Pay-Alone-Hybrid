// Words for the "My receipts and activity" section. Pure, so it is tested without a browser.
import { formatAmount, type Amount } from "../money";

export interface ReceiptView {
  id: string;
  payeeName: string;
  debit: Amount;
  method: "pin" | "passkey";
  simulated: boolean;
  createdAt: string;
}
export interface EventView {
  at: string;
  event: string;
  outcome?: string;
  reason?: string;
  receiptId?: string;
}

export const badgeOf = (r: Pick<ReceiptView, "simulated">) => (r.simulated ? "SIMULATED" : "REAL");

const when = (iso: string, locale?: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

/** One receipt as a sentence, for the screen reader and "Read my last receipt". */
export function receiptSentence(r: ReceiptView, locale?: string): string {
  return `${r.simulated ? "Simulated payment, no real money moved." : "Real payment."} ${formatAmount(r.debit)} to ${r.payeeName}, ${when(r.createdAt, locale)}, approved by ${r.method === "passkey" ? "fingerprint" : "PIN"}.`;
}

const EVENT_WORDS: Record<string, string> = {
  pin_set: "PIN set",
  pay_start: "Payment started",
  pay_finish: "Payment approval",
  pay_cancel: "Payment cancelled",
  wallet_connect: "Wallet connect",
  wallet_callback: "Wallet connect, return",
  passkey_options: "Fingerprint, start",
  passkey_register: "Fingerprint, save",
  app_start: "App opened",
  intent: "Request read",
  chat_reply: "Chat reply",
  voice_ready: "Voice ready",
  error: "Error",
};
const OUTCOME_WORDS: Record<string, string> = { ok: "ok", fail: "failed", connected: "connected", failed: "failed", refused: "refused", unreachable: "unreachable", weak: "weak PIN", wrong: "wrong PIN", locked: "locked" };

export function activityLine(e: EventView, locale?: string): string {
  const o = e.outcome ? (OUTCOME_WORDS[e.outcome] ?? e.outcome) : "";
  return `${when(e.at, locale)}: ${EVENT_WORDS[e.event] ?? e.event}${o ? `, ${o}` : ""}${e.reason ? ` (${e.reason.replace(/_/g, " ")})` : ""}`;
}
