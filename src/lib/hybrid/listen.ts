// Speech to text with Chrome's Web Speech API. When on-device recognition is available
// (SpeechRecognition.processLocally, Chrome 139+), the voice never leaves the computer.
// Otherwise Chrome's server recognition is used, and the screen says so.
"use client";
import { failAfter, orAfter } from "./timeout";

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

export async function localSpeechStatus(lang = "en-US"): Promise<"local" | "installable" | "server" | "none"> {
  const C = ctor();
  if (!C) return "none";
  if (!C.available) return "server";
  try {
    const a = await failAfter(C.available({ langs: [lang], processLocally: true }), 5_000, "Speech check");
    return a === "available" ? "local" : a === "unavailable" ? "server" : "installable";
  } catch {
    return "server";
  }
}

export async function installLocalSpeech(lang = "en-US"): Promise<boolean> {
  const C = ctor();
  try {
    // The pack may keep downloading in the background; we do not wait more than 5 seconds for it.
    return Boolean(C?.install && (await orAfter(C.install({ langs: [lang], processLocally: true }), 5_000, false)));
  } catch {
    return false;
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
export function listenOnce(opts: { lang?: string; local: boolean; maxMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const C = ctor();
    if (!C) return reject(new Error("no speech recognition"));
    stopListening(); // end any earlier listen first
    const r = new C();
    current = r;
    r.lang = opts.lang ?? "en-US";
    r.interimResults = false;
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
    r.onresult = (e) => (heard = e.results[0]?.[0]?.transcript ?? "");
    r.onerror = (e) => (e.error === "no-speech" || e.error === "aborted" ? finish() : finish(new Error(e.error)));
    r.onend = () => finish();
    r.start();
  });
}

export function say(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9;
    // Chrome sometimes never fires onend; never wait longer than the sentence could take.
    const t = setTimeout(resolve, 3_000 + text.length * 120);
    u.onend = () => { clearTimeout(t); resolve(); };
    u.onerror = () => { clearTimeout(t); resolve(); };
    speechSynthesis.speak(u);
  });
}
