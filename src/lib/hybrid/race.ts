// On-device first, with a head start. Gemini Nano gets a few seconds alone; if it has not given a usable
// answer by then, the cloud call is started TOO and the first usable answer wins. Pure timing logic:
// redaction, the rate guard and the safety checks all stay in the callers (chat.ts, understand.ts).

export const HEAD_START_MS = 2500;

/** ok with null means the engine answered but the answer was not usable. */
export type Outcome<T> = { ok: true; value: T | null } | { ok: false; error: unknown };

export interface Raced<T> {
  winner: "on_device" | "cloud" | null;
  value: T | null;
  device: Outcome<T> | "pending";
  cloud: Outcome<T> | "pending" | "not_started";
  /** True if the cloud call was actually made, even if on-device won. */
  cloudStarted: boolean;
}

const settle = <T>(p: Promise<T | null>): Promise<Outcome<T>> =>
  p.then(
    (value): Outcome<T> => ({ ok: true, value }),
    (error): Outcome<T> => ({ ok: false, error }),
  );
const usable = <T>(o: Outcome<T> | undefined): o is { ok: true; value: T } => !!o && o.ok && o.value !== null && o.value !== undefined;

/**
 * `startCloud` is called at most once, only when needed. It returns undefined when the cloud may not be
 * used (rate guard): then we simply keep waiting for on-device.
 */
export async function raceOnDeviceFirst<T>(
  device: Promise<T | null>,
  startCloud: () => Promise<T | null> | undefined,
  headStartMs: number = HEAD_START_MS,
): Promise<Raced<T>> {
  const d = settle(device);
  let dOut: Outcome<T> | undefined;
  let cOut: Outcome<T> | undefined;
  void d.then((o) => (dOut = o));

  let timer: ReturnType<typeof setTimeout> | undefined;
  const head = new Promise<"head">((r) => (timer = setTimeout(() => r("head"), headStartMs)));
  const first = await Promise.race([d, head]);
  clearTimeout(timer);
  if (first !== "head" && usable(first)) return { winner: "on_device", value: first.value, device: first, cloud: "not_started", cloudStarted: false };

  const cp = startCloud();
  if (!cp) {
    const o = dOut ?? (await d);
    return usable(o)
      ? { winner: "on_device", value: o.value, device: o, cloud: "not_started", cloudStarted: false }
      : { winner: null, value: null, device: o, cloud: "not_started", cloudStarted: false };
  }
  const c = settle(cp);
  void c.then((o) => (cOut = o));

  const w = await Promise.race([d.then((o) => ({ who: "on_device" as const, o })), c.then((o) => ({ who: "cloud" as const, o }))]);
  if (usable(w.o)) return { winner: w.who, value: w.o.value, device: dOut ?? "pending", cloud: cOut ?? "pending", cloudStarted: true };
  // The first to finish was unusable: wait for the other.
  const other = w.who === "on_device" ? await c : await d;
  if (w.who === "on_device") cOut = other;
  else dOut = other;
  const who = w.who === "on_device" ? "cloud" : "on_device";
  return {
    winner: usable(other) ? who : null,
    value: usable(other) ? other.value : null,
    device: dOut ?? "pending",
    cloud: cOut ?? "pending",
    cloudStarted: true,
  };
}
