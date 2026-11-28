// Fixed sentences and answers for the "shop asks, buyer approves" flow. No AI is involved: the amount and the
// shop name come from the server's request, and the words are our own templates.
import { yesNo } from "../hybrid/confirm";
import { spokenSecret } from "../hybrid/tripwire";
import { formatAmount, speakPlain, type Amount } from "../money";

export function requestPrompt(shopName: string, amount: Amount, ref: string): string {
  return `${shopName} is asking for ${speakPlain(amount)}, reference ${ref}. Say yes to check it, or no to decline.`;
}

/** "yes" only opens the check (the usual approval still follows). Same negation-safe rule as everywhere else. */
export function answerToRequest(said: string): "check" | "decline" | "unclear" | "secret" {
  if (spokenSecret(said).tripped) return "secret";
  const a = yesNo(said);
  return a === "yes" ? "check" : a === "no" ? "decline" : "unclear";
}

/** "472913" -> "47 29 13" */
export const formatPayCode = (code: string): string => code.replace(/(\d{2})(?=\d)/g, "$1 ");

/**
 * Pairs, never single digits in a row, so the voice's PIN guard (tts.ts unsafeToSpeak) lets it through.
 * The sentence says plainly that this is a pay code and not a PIN.
 */
export const payCodeSpeech = (code: string): string => `Your pay code is ${formatPayCode(code)}. It is a pay code, not your PIN. A shop uses it to ask you for a payment.`;

export const requestReceiptLine = (shopName: string, ref: string): string => `Paid ${shopName}, reference ${ref}`;

export type ShopTone = "wait" | "good" | "bad";
export function shopStatusView(status: "pending" | "paid" | "declined" | "expired", ref: string, amount: Amount): { tone: ShopTone; headline: string; sub: string; speech?: string } {
  const major = formatAmount(amount).replace(/^NGN /, "₦");
  switch (status) {
    case "paid":
      return { tone: "good", headline: `PAID ${major}`, sub: `Reference ${ref}`, speech: `Payment received, ${speakPlain(amount)}, reference ${ref}` };
    case "declined":
      return { tone: "bad", headline: "Declined", sub: `Reference ${ref}. The customer said no.` };
    case "expired":
      return { tone: "bad", headline: "Expired", sub: `Reference ${ref}. Nothing was paid. Ask again.` };
    default:
      return { tone: "wait", headline: "Waiting for the customer…", sub: `${major} · Reference ${ref}` };
  }
}
