// The sentence the app says before approval. It is a fixed template filled from the proposal, which
// itself comes from plain code and the saved contact list. Model text is never read out, so a model
// can never tell the person that money moved.
import { speakPlain, type Amount } from "../money";
import type { Proposal } from "./crosscheck";

export function readBack(p: Proposal): string {
  const amount = speakPlain({ value: p.amountMinor, assetCode: "NGN", assetScale: 2 });
  return `You want to send ${amount} to ${p.payeeName}. To approve, use your fingerprint or type your PIN. Say no to cancel.`;
}

/** Read-back built from the quote: the amount that will leave the wallet, fees included (rule 7). */
export function quoteReadBack(payeeName: string, debit: Amount): string {
  return `You want to send money to ${payeeName}. It will take ${speakPlain(debit)} from your wallet, fees included. To approve, use your fingerprint or type your PIN. Say no to cancel.`;
}
