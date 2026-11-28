import { describe, expect, it, vi } from "vitest";
import { createEventQueue, makeSid } from "./eventqueue";

function setup(over: Partial<Parameters<typeof createEventQueue>[0]> = {}) {
  let clock = 1000;
  const sent: { events: Record<string, unknown>[]; o: { signIn: boolean; unloading: boolean } }[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const q = createEventQueue({
    send: (events, o) => void sent.push({ events, o }),
    schedule: (fn, ms) => (timers.set(++id, { fn, ms }), id),
    cancel: (h) => void timers.delete(h as number),
    now: () => clock,
    sid: "abcdefgh",
    ...over,
  });
  return { q, sent, timers, tick: (ms: number) => (clock += ms), fire: () => [...timers.values()].forEach((t) => t.fn()) };
}

describe("client event queue", () => {
  it("stamps each event with the page-load session id and ms since page load", () => {
    const s = setup();
    s.q.push({ event: "app_start" });
    s.tick(250);
    s.q.push({ event: "mic_tap", state: "start" });
    s.q.flush();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].events).toEqual([
      { event: "app_start", sid: "abcdefgh", t: 0 },
      { event: "mic_tap", state: "start", sid: "abcdefgh", t: 250 },
    ]);
  });

  it("a caller cannot set its own sid or t", () => {
    const s = setup();
    s.q.push({ event: "app_start", sid: "forged", t: 999 });
    s.q.flush();
    expect(s.sent[0].events[0]).toMatchObject({ sid: "abcdefgh", t: 0 });
  });

  it("flushes by timer 2 s after the first queued event, one send for the lot", () => {
    const s = setup();
    s.q.push({ event: "a" });
    s.q.push({ event: "b" });
    expect([...s.timers.values()].map((t) => t.ms)).toEqual([2000]); // one timer, not one per event
    expect(s.sent).toHaveLength(0);
    s.fire();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].events.map((e) => e.event)).toEqual(["a", "b"]);
    expect(s.q.size()).toBe(0);
  });

  it("flushes at once when 20 events are queued, and cancels the timer", () => {
    const s = setup();
    for (let i = 0; i < 19; i++) s.q.push({ event: "x" });
    expect(s.sent).toHaveLength(0);
    s.q.push({ event: "x" });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].events).toHaveLength(20);
    expect(s.timers.size).toBe(0);
  });

  it("flush with nothing queued sends nothing", () => {
    const s = setup();
    s.q.flush();
    expect(s.sent).toHaveLength(0);
  });

  it("on page hide it flushes and marks the send as unloading", () => {
    const s = setup();
    s.q.push({ event: "a" });
    s.q.flush(true);
    expect(s.sent[0].o.unloading).toBe(true);
  });

  it("never sends more than 50 events in one request", () => {
    const s = setup({ maxBatch: 200 });
    for (let i = 0; i < 120; i++) s.q.push({ event: "x" });
    s.q.flush();
    expect(s.sent.map((x) => x.events.length)).toEqual([50, 50, 20]);
  });

  it("keeps at most maxQueue events, dropping the oldest", () => {
    const s = setup({ maxBatch: 1000, maxQueue: 5 });
    for (let i = 0; i < 8; i++) s.q.push({ event: "x", index: i });
    expect(s.q.size()).toBe(5);
    s.q.flush();
    expect(s.sent[0].events.map((e) => e.index)).toEqual([3, 4, 5, 6, 7]);
  });

  it("signs in only if some queued event wants it (app_start alone never creates a user)", () => {
    const a = setup();
    a.q.push({ event: "app_start" }, { signIn: false });
    a.q.flush();
    expect(a.sent[0].o.signIn).toBe(false);
    const b = setup();
    b.q.push({ event: "app_start" }, { signIn: false });
    b.q.push({ event: "mic_tap" });
    b.q.flush();
    expect(b.sent[0].o.signIn).toBe(true);
  });

  it("a send that throws never breaks the caller or loses the queue state", () => {
    const send = vi.fn(() => {
      throw new Error("down");
    });
    const s = setup({ send });
    expect(() => (s.q.push({ event: "a" }), s.q.flush())).not.toThrow();
    expect(s.q.size()).toBe(0);
  });
});

describe("makeSid", () => {
  it("is 8 lowercase letters, with no digits", () => {
    for (const r of [0, 0.5, 0.999999]) expect(makeSid(() => r)).toMatch(/^[a-z]{8}$/);
    expect(makeSid()).toMatch(/^[a-z]{8}$/);
  });
});
