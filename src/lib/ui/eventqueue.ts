// Queue for the browser's step log: events are stamped (page-load session id, ms since page load) and sent
// in batches, so one run can be rebuilt in order without one request per step. Pure: the clock, the timer and
// the send are passed in, so it is tested without a browser. It holds only the small fixed fields that the
// server whitelist accepts (clientaudit.ts); nothing the person said or typed ever goes in.
export type QueuedEvent = Record<string, string | number | boolean>;
export interface SendOptions {
  signIn: boolean;
  /** True on page hide: the send must be fire-and-forget (fetch keepalive). */
  unloading: boolean;
}
export interface QueueDeps {
  send: (events: QueuedEvent[], o: SendOptions) => void;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  now: () => number;
  sid: string;
  maxBatch?: number; // flush at once at this many queued events (default 20)
  intervalMs?: number; // flush this long after the first queued event (default 2000)
  maxQueue?: number; // oldest events are dropped beyond this (default 200)
}
export const MAX_PER_REQUEST = 50;

/** 8 random lowercase letters (letters only, so a session id can never look like a PIN). */
export function makeSid(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += String.fromCharCode(97 + Math.min(25, Math.floor(random() * 26)));
  return s;
}

export function createEventQueue(d: QueueDeps) {
  const maxBatch = d.maxBatch ?? 20;
  const interval = d.intervalMs ?? 2000;
  const maxQueue = d.maxQueue ?? 200;
  const start = d.now();
  let items: { e: QueuedEvent; signIn: boolean }[] = [];
  let timer: unknown;
  let timerOn = false;

  function clearTimer() {
    if (timerOn) d.cancel(timer);
    timerOn = false;
  }

  function flush(unloading = false): void {
    clearTimer();
    const all = items;
    items = [];
    for (let i = 0; i < all.length; i += MAX_PER_REQUEST) {
      const chunk = all.slice(i, i + MAX_PER_REQUEST);
      try {
        d.send(
          chunk.map((c) => c.e),
          { signIn: chunk.some((c) => c.signIn), unloading },
        );
      } catch {
        // logging never breaks the app
      }
    }
  }

  function push(fields: QueuedEvent, opts: { signIn?: boolean } = {}): void {
    items.push({ e: { ...fields, sid: d.sid, t: Math.max(0, Math.round(d.now() - start)) }, signIn: opts.signIn !== false });
    if (items.length > maxQueue) items = items.slice(items.length - maxQueue);
    if (items.length >= maxBatch) return flush();
    if (!timerOn) {
      timer = d.schedule(() => {
        timerOn = false;
        flush();
      }, interval);
      timerOn = true;
    }
  }

  return { push, flush, size: () => items.length };
}
