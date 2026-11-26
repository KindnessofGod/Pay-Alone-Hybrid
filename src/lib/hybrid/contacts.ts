// Saved names are untrusted input (red-team #7): a name could be used to smuggle instructions into a
// model or a read-back. A saved name may only contain letters (any script), spaces, hyphens and
// apostrophes, 1 to 40 characters, and must not look like a number or a placeholder.
const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million)\b/i;

export function validContactName(name: string): boolean {
  const n = name.normalize("NFC").trim();
  if (n.length < 1 || n.length > 40) return false;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}' ’-]*$/u.test(n)) return false;
  if (NUMBER_WORDS.test(n)) return false;
  return true;
}
