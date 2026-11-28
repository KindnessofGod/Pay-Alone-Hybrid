// "Read this exactly" support for the one natural voice. Our money sentences (read-back, approval prompts,
// receipts) are OUR templates. While a Live session is open the Live voice speaks them, so the person hears one
// voice instead of switching to the robotic browser voice. Because a model could say something else, we
// compare what it actually said (output transcription) with the template, word by word, and the page falls
// back to our own say() the moment they differ. Pure functions: tested in exact.test.ts.
import { numberWordsToDigits } from "../money";
import { editDistance } from "./livepay";

export const EXACT_PREFIX = "Read this exactly, word for word, nothing else:";

/** The text sent to the model as a client turn. */
export const exactInstruction = (template: string): string => `${EXACT_PREFIX} ${template}`;

/** Lowercase tokens: punctuation removed, "3,000" and "3 000" joined, number words as digits, naira sign as "naira". */
export function normalizeSpoken(text: string): string[] {
  let t = text.normalize("NFKC").toLowerCase().replace(/₦/g, " naira ").replace(/\bngn\b/g, " naira ");
  t = t.replace(/(\d)[,   ](?=\d{3}\b)/g, "$1");
  t = numberWordsToDigits(t);
  t = t.replace(/(\d)[,   ](?=\d{3}\b)/g, "$1");
  return t.split(/[^\p{L}\p{M}\p{N}.]+/u).map((w) => w.replace(/^\.+|\.+$/g, "")).filter(Boolean);
}

const isNum = (w: string) => /^\d/.test(w);
/** Same word, or one slip of spelling (plural, tense) on words of 4+ letters. Numbers must be identical. */
const same = (a: string, b: string): boolean => a === b || (!isNum(a) && !isNum(b) && a.length >= 4 && b.length >= 4 && editDistance(a, b) <= 1);

export interface Verdict {
  ok: boolean;
  reason?: "empty" | "number" | "word" | "extra";
}

/** The whole transcript against the whole template, once the turn is complete. */
export function matchesTemplate(template: string, said: string): Verdict {
  const T = normalizeSpoken(template);
  const S = normalizeSpoken(said);
  if (S.length === 0) return { ok: false, reason: "empty" };
  const tNums = T.filter(isNum);
  const sNums = S.filter(isNum);
  if (sNums.some((n) => !tNums.includes(n)) || tNums.some((n) => !sNums.includes(n))) return { ok: false, reason: "number" };
  // longest common subsequence with the lenient word match
  const dp = Array.from({ length: T.length + 1 }, () => new Array<number>(S.length + 1).fill(0));
  for (let i = 1; i <= T.length; i++)
    for (let j = 1; j <= S.length; j++) dp[i][j] = same(T[i - 1], S[j - 1]) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const common = dp[T.length][S.length];
  const missing = T.length - common;
  const extra = S.length - common;
  if (missing > 1 || (missing === 1 && longestMissingOver3(T, S))) return { ok: false, reason: "word" };
  if (extra > Math.max(1, Math.floor(T.length * 0.1))) return { ok: false, reason: "extra" };
  return { ok: true };
}

/** With exactly one template word missing: it may only be a short filler (3 letters or fewer), never a name or longer word. */
function longestMissingOver3(T: string[], S: string[]): boolean {
  const left = [...S];
  for (const w of T) {
    const i = left.findIndex((x) => same(x, w));
    if (i >= 0) left.splice(i, 1);
    else return w.length > 3;
  }
  return false;
}

/** While the model is still talking: has what it said so far stayed inside the template? */
export function stillOnTrack(template: string, partial: string): Verdict {
  const T = normalizeSpoken(template);
  let S = normalizeSpoken(partial);
  // the last word may be cut in half by the chunk boundary; judge it only if the text clearly ended it
  if (S.length && !/[\s.,!?;:。]$/.test(partial)) S = S.slice(0, -1);
  let pos = 0;
  let strays = 0;
  for (const w of S) {
    let hit = -1;
    for (let i = pos; i < T.length; i++)
      if (same(T[i], w)) {
        hit = i;
        break;
      }
    if (hit >= 0) pos = hit + 1;
    else {
      if (isNum(w)) return { ok: false, reason: "number" };
      if (w.length >= 4) return { ok: false, reason: "word" };
      if (++strays > 2) return { ok: false, reason: "extra" };
    }
  }
  return { ok: true };
}
