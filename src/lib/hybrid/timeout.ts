// Browser features (Gemini Nano, speech packs, Remote Config, speech output) can stall without an error.
// Every such call goes through one of these, so the app always moves on and can say why.

/** The answer if it comes within ms, else (or on failure) the fallback. */
export function orAfter<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(fallback); },
    );
  });
}

/** The answer if it comes within ms, else an error naming what stalled. */
export function failAfter<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} did not answer in ${Math.round(ms / 1000)} seconds`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
