// Natural text-to-speech that runs on the device (Kokoro-82M through kokoro-js). Pure logic: the model, the audio
// output and the browser voice are passed in, so this file is tested with fakes (tts.test.ts).
//
// Rules this file keeps:
// - The first sentence never waits for the model download: until the model is ready the browser voice speaks.
// - Generation has a hard time limit; when it is slow or fails, the browser voice says the rest.
// - A new speak() stops the previous one. Nothing here ever throws to the caller.
// - Text that looks like a PIN, password or card number is dropped before any voice sees it (CLAUDE.md rule 15).
import { spokenSecret } from "./tripwire";

export type TtsStatus = "off" | "loading" | "ready" | "failed";
export interface Audio {
  audio: Float32Array;
  sampling_rate: number;
}
export interface Model {
  generate(text: string): Promise<Audio>;
}
export interface Playing {
  /** Resolves when the sound has finished OR was stopped. */
  done: Promise<void>;
  stop(): void;
}
export interface Deps {
  loadModel(): Promise<Model>;
  play(audio: Audio): Playing;
  /** The browser's own voice. */
  fallback(text: string): Playing;
  /** Longest we wait for one sentence to be generated. */
  generateLimitMs: number;
}

/** Splits after . ! ? when whitespace follows, so decimals such as 3.69 stay together. */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
}

const D = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|\\d)";
export const SPELLED_RUN = new RegExp(`\\b${D}(?:[\\s,-]+${D}\\b){3,}`, "i"); // "4 8 2 6", "four eight two six"
export const LONG_NUMBER = /\b\d{4,}\b(?!\s*(?:naira|dollars?|cents?|kobo|k)\b)/i; // "4826" but not "5000 naira"

/**
 * True when speaking this text could say out loud a PIN, code or card number. The tripwire decides first; then, for
 * the PIN case, we only block when an actual PIN-like number is in the text, so our own instructions such as
 * "choose a PIN of 4 to 6 digits" are still spoken.
 */
export function unsafeToSpeak(text: string): boolean {
  const t = spokenSecret(text);
  if (!t.tripped) return false;
  if (t.kind === "card") return true;
  return SPELLED_RUN.test(text) || LONG_NUMBER.test(text);
}

const TIMED_OUT = Symbol("timed out");

function withLimit<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(TIMED_OUT), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export function createSpeaker(deps: Deps) {
  let status: TtsStatus = "off";
  let model: Model | undefined;
  const listeners = new Set<(s: TtsStatus) => void>();
  let run = 0; // id of the newest speak(); older ones stop at their next step
  let playing: Playing | undefined;

  const set = (s: TtsStatus) => {
    if (s === status) return;
    status = s;
    for (const l of listeners) l(s);
  };

  /** Starts the model download once. Safe to call many times; a failed load is not retried. */
  function load(): void {
    if (status !== "off") return;
    set("loading");
    let p: Promise<Model>;
    try {
      p = deps.loadModel();
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (m) => { model = m; set("ready"); },
      () => set("failed"),
    );
  }

  function stop(): void {
    run++;
    const p = playing;
    playing = undefined;
    try {
      p?.stop();
    } catch {
      /* already ended */
    }
  }

  async function play(mine: number, make: () => Playing): Promise<void> {
    if (mine !== run) return;
    let p: Playing;
    try {
      p = make();
    } catch {
      return;
    }
    playing = p;
    await p.done.catch(() => undefined);
    if (playing === p) playing = undefined;
  }

  async function speak(text: string): Promise<void> {
    try {
      stop();
      const mine = run;
      // A PIN, password or card number is never given to any voice (and so never to a model).
      if (unsafeToSpeak(text)) return;
      const sentences = splitSentences(text);
      if (!sentences.length) return;
      if (status !== "ready" || !model) return await play(mine, () => deps.fallback(text));

      const m = model;
      const gen = (s: string) => withLimit(m.generate(s), deps.generateLimitMs).catch(() => TIMED_OUT);
      let next = gen(sentences[0]);
      for (let i = 0; i < sentences.length; i++) {
        const a = await next;
        if (mine !== run) return;
        if (a === TIMED_OUT) return await play(mine, () => deps.fallback(sentences.slice(i).join(" ")));
        if (i + 1 < sentences.length) next = gen(sentences[i + 1]); // make the next one while this one plays
        await play(mine, () => deps.play(a as Audio));
        if (mine !== run) return;
      }
    } catch {
      /* speaking is best effort: the text is also on the screen */
    }
  }

  return {
    status: () => status,
    onStatus(l: (s: TtsStatus) => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    load,
    speak,
    stop,
  };
}
