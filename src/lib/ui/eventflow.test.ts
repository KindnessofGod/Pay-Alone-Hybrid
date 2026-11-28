import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventQueue } from "./eventqueue";
import { recordClientBatch } from "../server/clientaudit";
import { loadHistory } from "../server/history";
import { debugLine } from "./history";
import { MemoryStore } from "../store/memory";
import { spokenSecret } from "../hybrid/tripwire";

afterEach(() => vi.restoreAllMocks());

// A fake run through the app: the same events the screens report, with a typed PIN, a spoken PIN and a
// typed sentence along the way. Whatever the screens put in the queue goes to the real server check and
// store; then every saved row, the history the person sees, and every console line is searched.
describe("pin-leak test for the step log: no event carries a PIN, a spoken sentence or typed text", () => {
  const TYPED_PIN = "4826";
  const SPOKEN = "my pin is 1234";
  const TYPED_TEXT = "send 5000 naira to Mama Ade";

  it("a whole fake flow stores only codes, counts and times", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...a) => void lines.push(a.join(" ")));
    vi.spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
    const store = new MemoryStore();
    const batches: Record<string, unknown>[][] = [];
    let clock = 0;
    const q = createEventQueue({ send: (e) => void batches.push(e), schedule: () => 0, cancel: () => undefined, now: () => (clock += 37), sid: "qwertyui" });

    // What each screen does at each step: lengths and codes only, never the text itself.
    q.push({ event: "app_start" });
    q.push({ event: "mic_tap", state: "start", speech: "local" });
    q.push({ event: "listen_start", mode: "local" });
    const secret = spokenSecret(SPOKEN);
    expect(secret.tripped).toBe(true); // the spoken PIN is caught before any model
    q.push({ event: "listen_end", outcome: "heard", ms: 2100, chars: SPOKEN.length });
    q.push({ event: "understand_done", source: "rules", kind: "secret_spoken", ms: 0, cloud_raced: false });
    q.push({ event: "typed_submit", chars: TYPED_TEXT.length });
    q.push({ event: "understand_done", source: "cloud", kind: "proposal", ms: 900, cloud_raced: true });
    q.push({ event: "speak", engine: "kokoro", ms: 1500, ok: true });
    q.push({ event: "approve_open", method_offered: "pin" });
    q.push({ event: "approve_action", action: "pin", outcome: "ok", ms: 1200 }); // TYPED_PIN was typed here: not reported
    q.push({ event: "payment_result", outcome: "paid", simulated: true, ms: 9000 });
    q.push({ event: "client_error", where: "chat", code: "failed" });
    // Even if a bug passed the raw values along, the server drops everything outside the whitelist.
    q.push({ event: "typed_submit", chars: 5, text: TYPED_TEXT, pin: TYPED_PIN, said: SPOKEN, transcript: SPOKEN });
    q.push({ event: "client_error", where: SPOKEN, code: TYPED_PIN }); // free text in a code slot: refused
    q.flush();

    let stored = 0;
    for (const b of batches) stored += (await recordClientBatch(store, "u1", { events: b })).stored;
    expect(stored).toBe(13); // 14 pushed, the one with free text in a code slot is dropped

    const rows = await store.list("audit");
    const history = JSON.stringify(await loadHistory(store, "u1"));
    const shown = (await loadHistory(store, "u1")).events.map((e) => debugLine(e)).join("\n");
    const everything = [JSON.stringify(rows), history, shown, ...lines].join("\n");
    for (const bad of [TYPED_PIN, "1234", "my pin", "Mama Ade", "5000 naira", "send 5000"]) expect(everything).not.toContain(bad);
    // and the time/order markers are there
    expect(rows.every((r) => (r as { sid?: string }).sid === "qwertyui")).toBe(true);
    expect(shown).toMatch(/t=\d+ payment_result paid simulated=true ms=9000/);
  });
});
