// Yes/no that cannot turn a refusal into a yes (red-team #2).
// 1. Any no/negation word anywhere means "no".
// 2. "yes" only if the WHOLE reply is a short phrase from a closed list.
// 3. Anything else is "unclear", and nothing happens.
// A voice "yes" never pays anyway: it only lets the approval prompt (passkey or PIN) open.
export type Answer = "yes" | "no" | "unclear";

const NO =
  /\b(no|nope|nah|not|don'?t|do not|never|stop|cancel|wrong|incorrect|refuse|decline|wait|abeg no|no want|rara|rárá|mba|mbà|a'?a|ba|kada)\b|n't\b/i;
const YES = /^(yes|yes please|yeah|yep|ok|okay|correct|that'?s right|that is right|right|send it|go ahead|confirm|ehen|bẹẹni|beeni|ee|eh|ii|eeh|toh)$/i;

export function yesNo(said: string): Answer {
  const t = said.normalize("NFKC").trim();
  if (NO.test(t)) return "no";
  const plain = t.toLowerCase().replace(/[.,!?]+/g, " ").replace(/\s+/g, " ").trim();
  return YES.test(plain) ? "yes" : "unclear";
}
