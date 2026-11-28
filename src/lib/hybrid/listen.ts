// Speech to text with Chrome's Web Speech API. When on-device recognition is available
// (SpeechRecognition.processLocally, Chrome 139+), the voice never leaves the computer.
// Otherwise Chrome's server recognition is used, and the screen says so.
"use client";
import { failAfter, orAfter } from "./timeout";
import { speaker } from "./ttsBrowser";
import { isEmbedMuted } from "../embed";

type Rec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
};
type RecCtor = (new () => Rec) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

function ctor(): RecCtor | undefined {
  const w = globalThis as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export type LocalStatus = "local" | "installable" | "downloading" | "server" | "none";

export async function localSpeechStatus(lang = "en-US"): Promise<LocalStatus> {
  const C = ctor();
  if (!C) return "none";
  if (!C.available) return "server";
  try {
    const a = await failAfter(C.available({ langs: [lang], processLocally: true }), 5_000, "Speech check");
    return a === "available" ? "local" : a === "unavailable" ? "server" : a === "downloading" ? "downloading" : "installable";
  } catch {
    return "server";
  }
}

/**
 * Starts the on-device speech pack download and keeps watching it in the background: asks Chrome every 3 s for up to
 * 3 minutes and reports "downloading", then "local" (ready) or "server" (gave up). Call it from a tap: install()
 * may need a user gesture. cancel() stops the watching.
 */
export function installLocalSpeech(
  lang = "en-US",
  onStatus: (s: "local" | "downloading" | "server" | "none") => void = () => undefined,
  opts: { everyMs?: number; maxMs?: number } = {},
): { done: Promise<"local" | "server" | "none">; cancel: () => void } {
  const C = ctor();
  const every = opts.everyMs ?? 3_000;
  const max = opts.maxMs ?? 180_000;
  let stop: () => void = () => undefined;
  const done = new Promise<"local" | "server" | "none">((resolve) => {
    if (!C || !C.available) {
      const s = C ? "server" : "none";
      onStatus(s);
      return resolve(s);
    }
    let over = false;
    const end = (s: "local" | "server") => {
      if (over) return;
      over = true;
      clearInterval(timer);
      clearTimeout(limit);
      onStatus(s);
      resolve(s);
    };
    const check = async () => {
      if (over) return;
      try {
        const a = await C.available!({ langs: [lang], processLocally: true });
        if (over) return;
        if (a === "available") end("local");
        else if (a === "unavailable") end("server");
      } catch {
        /* try again on the next tick */
      }
    };
    onStatus("downloading");
    try {
      void C.install?.({ langs: [lang], processLocally: true }).then(() => check(), () => undefined);
    } catch {
      /* the polling still tells us */
    }
    const timer = setInterval(() => void check(), every);
    const limit = setTimeout(() => end("server"), max);
    stop = () => {
      if (over) return;
      over = true;
      clearInterval(timer);
      clearTimeout(limit);
      resolve("server");
    };
  });
  return { done, cancel: () => stop() };
}

export type SpeechErrorKind = "permission" | "network" | "language" | "no_mic" | "other";
export type SpeechErrorInfo = { kind: SpeechErrorKind; code: string; say: string };

/** Chrome's error code to a short message, and a code safe to report (letters and underscores only). */
export function speechErrorInfo(chromeCode: string): SpeechErrorInfo {
  switch (chromeCode) {
    case "not-allowed":
    case "service-not-allowed":
      return { kind: "permission", code: chromeCode.replace(/-/g, "_"), say: "I can't use your microphone. Click the lock icon left of the web address, set Microphone to Allow, then reload." };
    case "network":
      return { kind: "network", code: "network", say: "Online speech isn't reachable right now. Please type instead." };
    case "language-not-supported":
      return { kind: "language", code: "language_not_supported", say: "On-device speech isn't ready for this language." };
    case "audio-capture":
      return { kind: "no_mic", code: "audio_capture", say: "No microphone found." };
    default:
      return { kind: "other", code: "other", say: "The microphone did not work. You can type instead." };
  }
}

export class SpeechError extends Error {
  constructor(public info: SpeechErrorInfo) {
    super(info.code);
    this.name = "SpeechError";
  }
}

let current: Rec | undefined;
let finishCurrent: (() => void) | undefined;

/** Stops listening now (the person pressed the button again, or typed instead). Never waits for Chrome. */
export function stopListening(): void {
  current?.stop();
  finishCurrent?.();
}

/** Listens for one sentence. Ends on silence, on stopListening(), or after maxMs at the latest. */
export function listenOnce(opts: { lang?: string; local: boolean; maxMs?: number; onInterim?: (words: string) => void }): Promise<string> {
  return new Promise((resolve, reject) => {
    const C = ctor();
    if (!C) return reject(new Error("no speech recognition"));
    stopListening(); // end any earlier listen first
    const r = new C();
    current = r;
    r.lang = opts.lang ?? "en-US";
    // Interim words are only shown on screen (onInterim). They are never returned, stored or sent anywhere.
    r.interimResults = Boolean(opts.onInterim);
    r.maxAlternatives = 1;
    if (opts.local) r.processLocally = true;
    let heard = "";
    let settled = false;
    // Chrome does not always fire onend after stop(), so we never wait for it: we finish ourselves.
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(limit);
      clearTimeout(hard);
      if (current === r) {
        current = undefined;
        finishCurrent = undefined;
      }
      if (err) reject(err);
      else resolve(heard);
    };
    const limit = setTimeout(() => r.stop(), opts.maxMs ?? 10_000);
    const hard = setTimeout(() => {
      try {
        r.abort?.();
      } catch {
        /* already ended */
      }
      finish();
    }, (opts.maxMs ?? 10_000) + 1_000);
    finishCurrent = () => finish();
    r.onresult = (e) => {
      let fin = "";
      let live = "";
      for (let i = 0; i < e.results.length; i++) {
        const part = e.results[i];
        const t = part[0]?.transcript ?? "";
        if ((part as { isFinal?: boolean }).isFinal === false) live += t;
        else fin += t;
      }
      heard = fin;
      if (live && !settled) opts.onInterim?.((fin + live).trim());
    };
    r.onerror = (e) => (e.error === "no-speech" || e.error === "aborted" ? finish() : finish(new SpeechError(speechErrorInfo(e.error))));
    r.onend = () => finish();
    r.start();
  });
}

/**
 * Speaks one sentence or more. Uses the natural on-device voice (Kokoro) when it is loaded, otherwise the browser
 * voice at once. Resolves when speech ends, or after the time limit; never throws.
 */
export function say(text: string): Promise<void> {
  if (isEmbedMuted()) return Promise.resolve(); // muted by the /demo page
  // The browser voice can stall; the model has its own limit (tts.ts). Never wait longer than speech could take.
  const limit = 3_000 + text.length * 120 + 8_000;
  return orAfter(speaker.speak(text), limit, undefined);
}
