// Plain-code check of what an AI model understood. The model only suggests; this decides.
// A payment proposal exists only if:
//   - the action is "send",
//   - the payee is exactly one saved contact, and the person actually said that name,
//   - the person said an amount (read by plain code, not by the model),
//   - the model's amount, if it gave one, is the same as the plain-code amount,
//   - the amount is within the spending limit.
// Everything else is refused with a reason the app can say out loud.
import { amountFromSpeech } from "../money";

export interface Contact {
  id: string;
  name: string;
}

/** What a model is allowed to return. Anything else it returns is ignored. */
export interface AiIntent {
  action: string;
  amountMinor: number | string | null;
  payee: string | null;
}

export interface Proposal {
  amountMinor: string;
  payeeId: string;
  payeeName: string;
}

export type CheckReason = "not_send" | "unknown_payee" | "payee_not_said" | "no_amount" | "amount_mismatch" | "over_limit";
export type CheckResult = { ok: true; proposal: Proposal } | { ok: false; reason: CheckReason };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param cloudContacts when the model saw a redacted sentence, the names behind [CONTACT_1], [CONTACT_2]...
 */
export function crossCheck(ai: AiIntent, said: string, contacts: Contact[], limitMinor: string, cloudContacts: string[] = []): CheckResult {
  if (ai.action !== "send") return { ok: false, reason: "not_send" };

  let payeeText = typeof ai.payee === "string" ? ai.payee : "";
  const slot = payeeText.match(/^\[CONTACT_(\d+)\]$/);
  if (slot) payeeText = cloudContacts[Number(slot[1]) - 1] ?? "";
  const matches = contacts.filter((c) => norm(c.name) === norm(payeeText));
  if (matches.length !== 1) return { ok: false, reason: "unknown_payee" };
  const payee = matches[0];
  if (!new RegExp(`\\b${escape(payee.name)}\\b`, "i").test(said)) return { ok: false, reason: "payee_not_said" };

  const heard = amountFromSpeech(said, "NGN", 2);
  if (!heard || BigInt(heard.minor) <= BigInt(0)) return { ok: false, reason: "no_amount" };
  if (ai.amountMinor !== null && ai.amountMinor !== undefined) {
    const aiMinor = String(ai.amountMinor);
    if (!/^\d+$/.test(aiMinor) || BigInt(aiMinor) !== BigInt(heard.minor)) return { ok: false, reason: "amount_mismatch" };
  }
  if (BigInt(heard.minor) > BigInt(limitMinor)) return { ok: false, reason: "over_limit" };

  return { ok: true, proposal: { amountMinor: heard.minor, payeeId: payee.id, payeeName: payee.name } };
}
