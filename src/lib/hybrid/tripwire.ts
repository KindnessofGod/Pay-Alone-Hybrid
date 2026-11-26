// The spoken-secret tripwire. It runs on the device, in plain code, BEFORE any AI model or network call.
// A PIN, password, one-time code or card number must never be said out loud: someone nearby can hear it,
// and a recording of it should not exist. If one is detected, the transcript is thrown away.
//
// It errs on the side of tripping: a false alarm costs one repeated sentence, a miss can cost savings.
import { numberWordsToDigits } from "../money";

export type SecretKind = "pin" | "card";
export interface TripResult {
  tripped: boolean;
  kind?: SecretKind;
}

const SECRET_WORDS = /\b(pin|password|passcode|pass code|otp|one[- ]time code|code|cvv|cvc|token)\b/i;
const UNIT = "(k|naira|kobo|thousand|million|dollars?|cents?)\\b";
const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

/** "one two three four" -> "1 2 3 4" (single digits only; "twenty" etc. are left alone). */
function singleDigitWords(text: string): string {
  return text.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi, (w) => DIGIT_WORDS[w.toLowerCase()]);
}

export function spokenSecret(said: string): TripResult {
  const text = said.normalize("NFKC");
  const singles = singleDigitWords(text);

  // 1. A card number: 13 or more digits in one run, whatever else was said.
  const runs = (singles.match(/\d[\d\s-]*\d|\d/g) ?? []).map((r) => r.replace(/[\s-]/g, ""));
  if (runs.some((r) => r.length >= 13)) return { tripped: true, kind: "card" };

  // 2. A secret word plus any number that is not an amount ("2500 naira", "5k" are amounts).
  if (SECRET_WORDS.test(text)) {
    const withoutAmounts = numberWordsToDigits(text)
      .replace(new RegExp(`₦\\s?\\d[\\d,.]*|\\d[\\d,.]*\\s?${UNIT}`, "gi"), " ")
      .replace(/\b(send|pay|give|transfer)\s+\d[\d,.]*/gi, " ");
    if (/\d/.test(withoutAmounts)) return { tripped: true, kind: "pin" };
  }

  // 3. Four or more digits said one by one ("one two three four", "4 5 6 7") not followed by a unit.
  if (new RegExp(`\\b\\d(\\s+\\d\\b){3,}(?!\\s*${UNIT})`, "i").test(singles)) return { tripped: true, kind: "pin" };

  return { tripped: false };
}
