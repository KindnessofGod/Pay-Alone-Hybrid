// Redaction for the cloud path. The cloud model is only asked "what kind of request is this?".
// It never receives who (saved names become [CONTACT_n]), how much (amounts become [AMOUNT]) or any
// other number (account or phone numbers become [NUMBER]). The plain-code reader on the device keeps
// the real values and puts them back after the cloud answers (see crosscheck.ts).
import { numberWordsToDigits } from "../money";

export interface Redacted {
  text: string;
  /** The saved names, in the order their placeholders were numbered: [CONTACT_1] is contacts[0]. */
  contacts: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redactForCloud(said: string, savedNames: string[]): Redacted {
  // 1. Saved names, longest first so "Chidi Okafor" wins over "Chidi". Numbered by first appearance.
  // Each full name, then each part of a name (3+ letters) on its own, so "chidi" is hidden for "Chidi Okafor".
  const patterns: { pattern: string; name: string }[] = [];
  for (const name of savedNames) {
    patterns.push({ pattern: name, name });
    for (const part of name.split(/\s+/)) if (part.length >= 3 && part !== name) patterns.push({ pattern: part, name });
  }
  patterns.sort((a, b) => b.pattern.length - a.pattern.length);
  const found: { name: string; at: number }[] = [];
  let text = said.normalize("NFKC");
  const marks: string[] = [];
  for (const { pattern, name } of patterns) {
    const re = new RegExp(`\\b${escape(pattern)}\\b`, "gi");
    text = text.replace(re, (_m, offset: number) => {
      found.push({ name, at: offset });
      marks.push(name);
      return `\u0001${String.fromCharCode(97 + marks.length - 1)}\u0001`;
    });
  }
  const order: string[] = [];
  for (const f of [...found].sort((a, b) => a.at - b.at)) if (!order.includes(f.name)) order.push(f.name);

  // 2. Number words to digits, so "one hundred and fifty" is caught by the digit rules.
  text = numberWordsToDigits(text);

  // 3. Long digit runs (account, phone, card) are numbers, not amounts.
  text = text.replace(/\+?\d[\d\s-]{6,}\d/g, "[NUMBER]");
  // 4. Amounts: 2,500 / 5000 / 5k / 1.5 million / ₦500.
  text = text.replace(/₦?\d[\d,]*(\.\d+)?(\s?(k|thousand|million)\b)?/gi, "[AMOUNT]");

  // 4b. Names that are not saved: a capitalised word that is not a common sentence word (speech
  //     recognition capitalises names). Over-hiding is safe; the plain-code check rejects unknown people.
  const KEEP = /^(I|Naira|Kobo|OK|Okay|Abeg|Please|Send|Pay|Give|Transfer|How|What|Who|Whose|When|Can|Could|Help|Repeat|Say|Cancel|Stop|Yes|No|My|Is|Do|Did|Tell|Check|Show|Read)$/;
  text = text.replace(/[A-Za-z][A-Za-z'’-]*/g, (w) => {
    if (!/^[A-Z]/.test(w) || KEEP.test(w) || /^(AMOUNT|NUMBER|CONTACT_)/.test(w)) return w;
    return "[PERSON]";
  });
  text = text.replace(/\[PERSON\](\s+\[PERSON\])+/g, "[PERSON]");

  // 5. Put the contact placeholders in, numbered by first appearance.
  text = text.replace(/\u0001([a-z])\u0001/g, (_m, c: string) => `[CONTACT_${order.indexOf(marks[c.charCodeAt(0) - 97]) + 1}]`);
  return { text: text.replace(/\s{2,}/g, " ").trim(), contacts: order };
}
