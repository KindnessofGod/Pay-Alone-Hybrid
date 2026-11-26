// Speech to text with Chrome's Web Speech API. When on-device recognition is available
// (SpeechRecognition.processLocally, Chrome 139+), the voice never leaves the computer.
// Otherwise Chrome's server recognition is used, and the screen says so.
"use client";

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
    const a = await C.available({ langs: [lang], processLocally: true });
    return a === "available" ? "local" : a === "unavailable" ? "server" : "installable";
  } catch {
    return "server";
  }
}

export async function installLocalSpeech(lang = "en-US"): Promise<boolean> {
  const C = ctor();
  try {
    return Boolean(C?.install && (await C.install({ langs: [lang], processLocally: true })));
  } catch {
    return false;
  }
}

let current: Rec | undefined;

/** Stops listening now (the person pressed the button again, or typed instead). */
export function stopListening(): void {
  current?.stop();
}

/** Listens for one sentence. Ends on silence, on stopListening(), or after maxMs at the latest. */
export function listenOnce(opts: { lang?: string; local: boolean; maxMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const C = ctor();
    if (!C) return reject(new Error("no speech recognition"));
    current?.stop();
    const r = new C();
    current = r;
    r.lang = opts.lang ?? "en-US";
    r.interimResults = false;
    r.maxAlternatives = 1;
    if (opts.local) r.processLocally = true;
    let heard = "";
    const limit = setTimeout(() => r.stop(), opts.maxMs ?? 10_000);
    const done = () => {
      clearTimeout(limit);
      if (current === r) current = undefined;
    };
    r.onresult = (e) => (heard = e.results[0]?.[0]?.transcript ?? "");
    r.onerror = (e) => {
      done();
      if (e.error === "no-speech" || e.error === "aborted") resolve(heard);
      else reject(new Error(e.error));
    };
    r.onend = () => {
      done();
      resolve(heard);
    };
    r.start();
  });
}

export function say(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
