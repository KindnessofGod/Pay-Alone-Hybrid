// The browser's own voices differ a lot. The old Windows voices (David, Zira) sound robotic;
// neural "Natural" voices and Chrome's Google voices sound much closer to a person.
const RANKS: RegExp[] = [/natural/i, /google uk english female/i, /google us english/i, /google uk english male/i, /google/i, /zira|aria|jenny|samantha/i];

export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const en = voices.filter((x) => /^en([-_]|$)/i.test(x.lang));
  for (const r of RANKS) {
    const hit = en.find((x) => r.test(x.name));
    if (hit) return hit;
  }
  return en[0];
}
