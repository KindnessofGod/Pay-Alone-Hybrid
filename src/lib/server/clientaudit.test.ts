import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory";
import { CLIENT_ERROR_CODES, CLIENT_LIMIT_PER_MINUTE, recordClientBatch, recordClientEvent, validateClientEvent } from "./clientaudit";
import { handle, HttpError } from "./http";
import { loadHistory } from "./history";
import { audit } from "./audit";

afterEach(() => vi.restoreAllMocks());

describe("client-reported events: a small fixed list, checked on the server", () => {
  it("accepts each allowed event with only its own fields", () => {
    expect(validateClientEvent({ event: "app_start" })).toEqual({ event: "app_start", fields: { outcome: "ok" } });
    expect(validateClientEvent({ event: "intent", source: "rules", ms: 12 })).toEqual({ event: "intent", fields: { outcome: "ok", source: "rules", ms: 12 } });
    expect(validateClientEvent({ event: "chat_reply", source: "cloud", guarded: true })).toEqual({ event: "chat_reply", fields: { outcome: "ok", source: "cloud", guarded: true } });
    expect(validateClientEvent({ event: "voice_ready", voice: "natural" })).toEqual({ event: "voice_ready", fields: { outcome: "ok", voice: "natural" } });
    expect(validateClientEvent({ event: "speech_error", code: "not_allowed" })).toEqual({ event: "speech_error", fields: { outcome: "fail", code: "not_allowed" } });
    expect(validateClientEvent({ event: "error", code: CLIENT_ERROR_CODES[0] })).toEqual({ event: "error", fields: { outcome: "fail", code: CLIENT_ERROR_CODES[0] } });
  });

  it("rejects unknown events, wrong values and missing fields", () => {
    for (const bad of [
      {},
      { event: "pay_finish" }, // server events cannot be forged by the client
      { event: "pin_set", outcome: "ok" },
      { event: "intent", source: "magic", ms: 1 },
      { event: "intent", source: "rules" },
      { event: "intent", source: "rules", ms: -1 },
      { event: "intent", source: "rules", ms: 1.5 },
      { event: "chat_reply", source: "cloud", guarded: "yes" },
      { event: "voice_ready", voice: "robot" },
      { event: "error", code: "anything I like" },
      { event: 5 },
      { event: "speech_error" },
      { event: "speech_error", code: "send 5000 naira to Tunde" }, // a sentence is never a code
      { event: "speech_error", code: "not-allowed" },
    ]) expect(validateClientEvent(bad)).toBeNull();
  });

  it("drops extra fields: a sentence, a name, an amount or a PIN is never kept", () => {
    const v = validateClientEvent({ event: "intent", source: "on_device", ms: 40, said: "send 5000 to Mama Ade", payee: "Mama Ade", amountMinor: "500000", pin: "4826" });
    expect(v).toEqual({ event: "intent", fields: { outcome: "ok", source: "on_device", ms: 40 } });
  });

  it("speech_error keeps only the code, never a transcript", () => {
    expect(validateClientEvent({ event: "speech_error", code: "network", transcript: "my pin is 4826", said: "hi" })).toEqual({ event: "speech_error", fields: { outcome: "fail", code: "network" } });
  });

  it("recordClientEvent stores the event for the person and answers 400 for anything else", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const store = new MemoryStore();
    expect(await recordClientEvent(store, "u1", { event: "app_start" })).toEqual({ ok: true });
    const rows = await store.list<{ event: string; userId: string }>("audit");
    expect(rows).toMatchObject([{ event: "app_start", userId: "u1" }]);
    await expect(recordClientEvent(store, "u1", { event: "hack" })).rejects.toMatchObject({ status: 400 });
  });

  it("limits each person to 300 events a minute, and the count resets next minute", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const store = new MemoryStore();
    const t = Date.parse("2026-11-27T10:00:10Z");
    for (let i = 0; i < 300; i++) expect(await recordClientEvent(store, "u1", { event: "app_start" }, t)).toEqual({ ok: true });
    await expect(recordClientEvent(store, "u1", { event: "app_start" }, t + 1000)).rejects.toMatchObject({ status: 429 });
    expect(await recordClientEvent(store, "u2", { event: "app_start" }, t)).toEqual({ ok: true }); // other people are not affected
    expect(await recordClientEvent(store, "u1", { event: "app_start" }, t + 60_000)).toEqual({ ok: true });
    expect(await store.list("audit")).toHaveLength(302);
  });
});

describe("HttpError through handle()", () => {
  it("answers with the error's status and reason", async () => {
    const r = new Request("https://x/api", { method: "POST", headers: { authorization: "Bearer t" }, body: "{}" });
    const res = await handle(r, async () => "u1", async () => { throw new HttpError(400, "bad_event"); });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "bad_event" });
  });
});

describe("history: the person's own receipts and activity", () => {
  const receipt = (id: string, userId: string, at: number) => ({
    id, userId, requestId: `req_${id}`, paymentId: `p_${id}`, payeeId: "c1", payeeName: `Payee of ${userId}`, debit: { value: "500000", assetCode: "NGN", assetScale: 2 },
    method: "pin", simulated: true, createdAt: new Date(at).toISOString(),
  });
  const put = (s: MemoryStore, r: ReturnType<typeof receipt>) => s.put("receipts_by_user", `${r.userId}|${String(Date.parse(r.createdAt)).padStart(13, "0")}|${r.id}`, r);

  it("returns the last 20 receipts and 50 events, newest first, and only the signed-in person's", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const s = new MemoryStore();
    for (let i = 0; i < 25; i++) await put(s, receipt(`rcpt_u1_${String(i).padStart(2, "0")}`, "u1", 1_000_000 + i));
    await put(s, receipt("rcpt_u10_x", "u10", 5_000_000));
    await put(s, receipt("rcpt_u2_x", "u2", 5_000_001));
    for (let i = 0; i < 55; i++) await audit(s, "u1", "app_start", { outcome: "ok", ms: i }, 1000 + i);
    await audit(s, "u2", "pay_finish", { outcome: "ok" }, 9000);
    await audit(s, "u10", "pay_finish", { outcome: "ok" }, 9001);
    const h = await loadHistory(s, "u1");
    expect(h.receipts).toHaveLength(20);
    expect(h.receipts[0].id).toBe("rcpt_u1_24");
    expect(h.events).toHaveLength(50);
    expect(h.events[0]).toMatchObject({ event: "app_start", ms: 54 });
    const all = JSON.stringify(h);
    expect(all).not.toMatch(/u10|u2|rcpt_u2|Payee of u2|"userId"/);
  });

  it("a receipt row is trimmed to what the screen needs (no user id, payment id or request id)", async () => {
    const s = new MemoryStore();
    await put(s, receipt("rcpt_a", "u1", 1_000_000));
    const h = await loadHistory(s, "u1");
    expect(Object.keys(h.receipts[0]).sort()).toEqual(["createdAt", "debit", "id", "method", "payeeName", "simulated"]);
  });

  it("receipts saved before the per-person list existed are still found, and only the person's own", async () => {
    const s = new MemoryStore();
    await s.put("receipts", "rcpt_old1", receipt("rcpt_old1", "u1", 1_000_000));
    await s.put("receipts", "rcpt_old2", receipt("rcpt_old2", "u1", 2_000_000));
    await s.put("receipts", "rcpt_other", receipt("rcpt_other", "u2", 3_000_000));
    expect((await loadHistory(s, "u1")).receipts.map((r) => r.id)).toEqual(["rcpt_old2", "rcpt_old1"]);
  });

  it("with nothing yet, answers empty lists", async () => {
    expect(await loadHistory(new MemoryStore(), "u1")).toEqual({ ok: true, receipts: [], events: [] });
  });
});

describe("older receipts are not hidden once new ones are indexed", () => {
  it("shows a receipt saved before the per-person list alongside a newer indexed one", async () => {
    const store = new MemoryStore();
    const old = { id: "rcpt_old", userId: "u1", requestId: "r0", paymentId: "p0", payeeId: "c2", payeeName: "Tunde", debit: { value: "369", assetCode: "USD", assetScale: 2 }, method: "pin", simulated: false, createdAt: "2026-11-27T20:31:00.000Z" };
    const neu = { ...old, id: "rcpt_new", createdAt: "2026-11-27T21:00:00.000Z" };
    await store.put("receipts", old.id, old);
    await store.put("receipts", neu.id, neu);
    await store.put("receipts_by_user", `u1|${String(Date.parse(neu.createdAt)).padStart(13, "0")}|${neu.id}`, neu);
    const h = await loadHistory(store, "u1");
    expect(h.receipts.map((r) => r.id)).toEqual(["rcpt_new", "rcpt_old"]);
  });
});

describe("client event limiter fails closed", () => {
  it("a limiter that throws drops the event", async () => {
    const store = new MemoryStore();
    vi.spyOn(store, "update").mockRejectedValue(new Error("down"));
    await expect(recordClientEvent(store, "u1", { event: "app_start" })).rejects.toMatchObject({ status: 429 });
    expect((await store.list("audit")).length).toBe(0);
  });
});

describe("live_session event (Gemini Live prototype)", () => {
  it("keeps only outcome and a fixed code", () => {
    expect(validateClientEvent({ event: "live_session", outcome: "started" })).toEqual({ event: "live_session", fields: { outcome: "started" } });
    expect(validateClientEvent({ event: "live_session", outcome: "error", code: "quota", transcript: "my pin is 1234" })).toEqual({ event: "live_session", fields: { outcome: "error", code: "quota" } });
    expect(validateClientEvent({ event: "live_session", outcome: "ended", code: "tripwire" })).toEqual({ event: "live_session", fields: { outcome: "ended", code: "tripwire" } });
  });
  it("rejects unknown outcomes and free-text codes", () => {
    expect(validateClientEvent({ event: "live_session", outcome: "maybe" })).toBeNull();
    expect(validateClientEvent({ event: "live_session" })).toBeNull();
    expect(validateClientEvent({ event: "live_session", outcome: "error", code: "send 5000 naira to Tunde" })).toBeNull();
  });
});

describe("the limit", () => {
  it("is 300 a minute", () => expect(CLIENT_LIMIT_PER_MINUTE).toBe(300));
});

describe("full step log: every client event, only its own checked fields", () => {
  const v = (b: Record<string, unknown>) => validateClientEvent(b);
  it("accepts each new event and keeps only whitelisted fields", () => {
    expect(v({ event: "mic_tap", state: "start", speech: "local" })).toEqual({ event: "mic_tap", fields: { outcome: "ok", state: "start", speech: "local" } });
    expect(v({ event: "mic_tap", state: "blocked", speech: "checking" })).not.toBeNull();
    expect(v({ event: "listen_start", mode: "online" })).toEqual({ event: "listen_start", fields: { outcome: "ok", mode: "online" } });
    expect(v({ event: "listen_end", outcome: "heard", ms: 3000, chars: 22 })).toEqual({ event: "listen_end", fields: { outcome: "heard", ms: 3000, chars: 22 } });
    expect(v({ event: "speech_consent", choice: "shown" })).toEqual({ event: "speech_consent", fields: { outcome: "ok", choice: "shown" } });
    expect(v({ event: "typed_submit", chars: 14 })).toEqual({ event: "typed_submit", fields: { outcome: "ok", chars: 14 } });
    expect(v({ event: "example_chip", index: 2 })).toEqual({ event: "example_chip", fields: { outcome: "ok", index: 2 } });
    expect(v({ event: "understand_done", source: "none", kind: "unclear", ms: 5, cloud_raced: false })).toEqual({ event: "understand_done", fields: { outcome: "ok", source: "none", kind: "unclear", ms: 5, cloud_raced: false } });
    expect(v({ event: "chat_done", source: "cloud", ms: 900, guarded: true })).toEqual({ event: "chat_done", fields: { outcome: "ok", source: "cloud", ms: 900, guarded: true } });
    expect(v({ event: "speak", engine: "kokoro", ms: 1200, ok: true })).toEqual({ event: "speak", fields: { outcome: "ok", engine: "kokoro", ms: 1200, ok: true } });
    expect(v({ event: "speak", engine: "none", ms: 0, ok: false })).toMatchObject({ fields: { outcome: "fail" } });
    expect(v({ event: "approve_open", method_offered: "passkey" })).toEqual({ event: "approve_open", fields: { outcome: "ok", method_offered: "passkey" } });
    expect(v({ event: "approve_action", action: "wallet_connect", outcome: "cancel", ms: 10 })).toEqual({ event: "approve_action", fields: { outcome: "cancel", action: "wallet_connect", ms: 10 } });
    expect(v({ event: "payment_result", outcome: "paid", simulated: true, ms: 8000 })).toEqual({ event: "payment_result", fields: { outcome: "paid", simulated: true, ms: 8000 } });
    expect(v({ event: "payment_result", outcome: "stopped", ms: 80 })).toEqual({ event: "payment_result", fields: { outcome: "stopped", ms: 80 } });
    expect(v({ event: "tab_switch", tab: "privacy" })).toEqual({ event: "tab_switch", fields: { outcome: "ok", tab: "privacy" } });
    expect(v({ event: "history_load", count: 3, ms: 400 })).toEqual({ event: "history_load", fields: { outcome: "ok", count: 3, ms: 400 } });
    expect(v({ event: "read_receipt" })).toEqual({ event: "read_receipt", fields: { outcome: "ok" } });
    expect(v({ event: "demo_opened", name: "Mama Put" })).toEqual({ event: "demo_opened", fields: { outcome: "ok" } }); // /demo page opened: nothing else is kept
    expect(v({ event: "live_tool", shown: true, reason: "approve_card" })).toEqual({ event: "live_tool", fields: { outcome: "ok", shown: true, reason: "approve_card" } });
    expect(v({ event: "template_mismatch", text: "You are paying Tunde 5000" })).toEqual({ event: "template_mismatch", fields: { outcome: "ok" } });
    expect(v({ event: "live_turn", who: "person", chars: 24, text: "send 5000 to Tunde" })).toEqual({ event: "live_turn", fields: { outcome: "ok", who: "person", chars: 24 } });
    expect(v({ event: "live_turn", who: "Tunde", chars: 2 })).toBeNull();
    expect(v({ event: "live_tool", shown: false, reason: "amount_not_heard" })).toEqual({ event: "live_tool", fields: { outcome: "ok", shown: false, reason: "amount_not_heard" } });
    expect(v({ event: "live_check", result: "agree", source: "on_device", text: "send 5000 to Tunde" })).toEqual({ event: "live_check", fields: { outcome: "ok", result: "agree", source: "on_device" } });
    expect(v({ event: "live_check", result: "mismatch", source: "cloud" })).toEqual({ event: "live_check", fields: { outcome: "ok", result: "mismatch", source: "cloud" } });
    expect(v({ event: "live_check", result: "yes", source: "on_device" })).toBeNull();
    expect(v({ event: "handoff", to: "device", reason: "offline", name: "Tunde" })).toEqual({ event: "handoff", fields: { outcome: "ok", to: "device", reason: "offline" } });
    expect(v({ event: "handoff", to: "mars", reason: "offline" })).toBeNull();
    expect(v({ event: "handoff", to: "cloud", reason: "has digits 12" })).toBeNull();
    expect(v({ event: "client_error", where: "understand", code: "failed" })).toEqual({ event: "client_error", fields: { outcome: "fail", where: "understand", code: "failed" } });
  });

  it("carries sid and t on any event, and drops them silently when malformed", () => {
    expect(v({ event: "read_receipt", sid: "abcdefgh", t: 1500 })).toEqual({ event: "read_receipt", fields: { outcome: "ok", sid: "abcdefgh", t: 1500 } });
    expect(v({ event: "read_receipt", sid: "my pin is 1234", t: -4 })).toEqual({ event: "read_receipt", fields: { outcome: "ok" } });
    expect(v({ event: "read_receipt", sid: "abc1efgh" })).toEqual({ event: "read_receipt", fields: { outcome: "ok" } });
  });

  it("rejects wrong enums, wrong types and missing fields", () => {
    for (const bad of [
      { event: "mic_tap", state: "start" },
      { event: "mic_tap", state: "start", speech: "magic" },
      { event: "listen_start", mode: "cloud" },
      { event: "listen_end", outcome: "heard", ms: 1 },
      { event: "listen_end", outcome: "heard", ms: 1, chars: -1 },
      { event: "listen_end", outcome: "send 5000 to Tunde", ms: 1, chars: 3 },
      { event: "speech_consent", choice: "yes" },
      { event: "typed_submit", chars: "14" },
      { event: "typed_submit", chars: 1.5 },
      { event: "example_chip", index: 99 },
      { event: "understand_done", source: "rules", kind: "weird", ms: 1, cloud_raced: false },
      { event: "understand_done", source: "rules", kind: "proposal", ms: 1 },
      { event: "chat_done", source: "cloud", ms: 1 },
      { event: "speak", engine: "robot", ms: 1, ok: true },
      { event: "approve_open", method_offered: "face" },
      { event: "approve_action", action: "pin", outcome: "paid", ms: 1 },
      { event: "payment_result", outcome: "ok", ms: 1 },
      { event: "tab_switch", tab: "admin" },
      { event: "history_load", count: -1, ms: 1 },
      { event: "live_tool", shown: "yes", reason: "x" },
      { event: "live_tool", shown: true, reason: "has digits 1234" },
      { event: "client_error", where: "understand" },
      { event: "client_error", where: "my pin is 4826", code: "x" },
    ]) expect(v(bad), JSON.stringify(bad)).toBeNull();
  });

  it("drops extra fields: text, names, amounts and PINs never get through any event", () => {
    const extras = { said: "send 5000 to Mama Ade", text: "my pin is 4826", pin: "4826", payee: "Mama Ade", amountMinor: "500000", transcript: "hi" };
    const r = v({ event: "typed_submit", chars: 14, ...extras });
    expect(r).toEqual({ event: "typed_submit", fields: { outcome: "ok", chars: 14 } });
    expect(JSON.stringify(v({ event: "client_error", where: "chat", code: "failed", ...extras }))).not.toMatch(/Mama|4826|5000/);
  });
});

describe("batches", () => {
  const quiet = () => vi.spyOn(console, "info").mockImplementation(() => {});
  it("stores the good events, drops the bad, and says how many of each", async () => {
    quiet();
    const store = new MemoryStore();
    const r = await recordClientBatch(store, "u1", {
      events: [
        { event: "mic_tap", state: "start", speech: "local", sid: "abcdefgh", t: 10 },
        { event: "pay_finish", outcome: "ok" }, // server-only event: refused
        { event: "typed_submit", chars: "x" },
        { event: "typed_submit", chars: 9, sid: "abcdefgh", t: 20, said: "send 500" },
        "not an object",
        null,
      ],
    });
    expect(r).toEqual({ ok: true, stored: 2, dropped: 4 });
    const rows = await store.list<Record<string, unknown>>("audit");
    expect(rows.map((x) => x.event).sort()).toEqual(["mic_tap", "typed_submit"]);
    expect(JSON.stringify(rows)).not.toMatch(/send 500|pay_finish/);
    expect(rows.every((x) => x.userId === "u1")).toBe(true);
  });

  it("keeps the order inside a batch, so a run reads back in order", async () => {
    quiet();
    const store = new MemoryStore();
    await recordClientBatch(store, "u1", { events: [1, 2, 3].map((n) => ({ event: "example_chip", index: n })) }, 5000);
    const rows = await store.list<{ index: number }>("audit", { prefix: "u1|", newestFirst: true });
    expect(rows.map((r) => r.index)).toEqual([3, 2, 1]);
  });

  it("refuses a batch that is not a list, is empty, or has more than 50 events", async () => {
    quiet();
    const store = new MemoryStore();
    await expect(recordClientBatch(store, "u1", { events: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(recordClientBatch(store, "u1", { events: [] })).rejects.toMatchObject({ status: 400 });
    await expect(recordClientBatch(store, "u1", { events: Array.from({ length: 51 }, () => ({ event: "app_start" })) })).rejects.toMatchObject({ status: 400 });
    expect(await store.list("audit")).toHaveLength(0);
    expect(await recordClientBatch(store, "u1", { events: Array.from({ length: 50 }, () => ({ event: "app_start" })) })).toEqual({ ok: true, stored: 50, dropped: 0 });
  });

  it("counts each stored event against the 300 a minute, keeps what fits, and answers 429 when nothing fits", async () => {
    quiet();
    const store = new MemoryStore();
    const t = Date.parse("2026-11-27T10:00:10Z");
    const full = { events: Array.from({ length: 50 }, () => ({ event: "app_start" })) };
    for (let i = 0; i < 5; i++) await recordClientBatch(store, "u1", full, t); // 250
    expect(await recordClientBatch(store, "u1", full, t)).toEqual({ ok: true, stored: 50, dropped: 0 }); // 300
    await expect(recordClientBatch(store, "u1", { events: [{ event: "app_start" }] }, t)).rejects.toMatchObject({ status: 429 });
    expect(await recordClientBatch(store, "u2", { events: [{ event: "app_start" }] }, t)).toMatchObject({ stored: 1 });
    expect(await recordClientBatch(store, "u1", { events: [{ event: "app_start" }] }, t + 60_000)).toMatchObject({ stored: 1 });
  });

  it("partly over the limit: stores what fits and drops the rest", async () => {
    quiet();
    const store = new MemoryStore();
    const t = Date.parse("2026-11-27T10:00:10Z");
    const forty = { events: Array.from({ length: 40 }, () => ({ event: "app_start" })) };
    for (let i = 0; i < 7; i++) await recordClientBatch(store, "u1", forty, t); // 280
    expect(await recordClientBatch(store, "u1", forty, t)).toEqual({ ok: true, stored: 20, dropped: 20 });
  });

  it("a limiter that throws drops the batch (fails closed)", async () => {
    const store = new MemoryStore();
    vi.spyOn(store, "update").mockRejectedValue(new Error("down"));
    await expect(recordClientBatch(store, "u1", { events: [{ event: "app_start" }] })).rejects.toMatchObject({ status: 429 });
    expect(await store.list("audit")).toHaveLength(0);
  });
});

describe("live_session failure detail", () => {
  const v = (b: Record<string, unknown>) => validateClientEvent(b);
  it("keeps stage, a digit-free reason and an integer close_code", () => {
    expect(v({ event: "live_session", outcome: "error", code: "other", stage: "connect", reason: "NetworkError WebSocket closed: going away", close_code: 1006 })).toEqual({
      event: "live_session",
      fields: { outcome: "error", code: "other", stage: "connect", reason: "NetworkError WebSocket closed: going away", close_code: 1006 },
    });
  });
  it("drops a malformed stage, reason or close_code without losing the event", () => {
    expect(v({ event: "live_session", outcome: "error", code: "other", stage: "kitchen", reason: "has digits 1234", close_code: "x" })).toEqual({ event: "live_session", fields: { outcome: "error", code: "other" } });
    expect(v({ event: "live_session", outcome: "error", reason: "a".repeat(101) })).toEqual({ event: "live_session", fields: { outcome: "error" } });
    expect(v({ event: "live_session", outcome: "started", transcript: "my pin is 1234" })).toEqual({ event: "live_session", fields: { outcome: "started" } });
  });
  it("is stored and printed, but never with digits", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...a) => void lines.push(a.join(" ")));
    const store = new MemoryStore();
    await recordClientEvent(store, "u1", { event: "live_session", outcome: "error", code: "other", stage: "session", reason: "Error socket closed", close_code: 1011 });
    expect((await store.list("audit"))[0]).toMatchObject({ stage: "session", reason: "Error socket closed", close_code: 1011 });
    expect(lines[0]).toContain("stage=session");
  });
});
