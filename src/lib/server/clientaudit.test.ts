import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory";
import { CLIENT_ERROR_CODES, recordClientEvent, validateClientEvent } from "./clientaudit";
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
    ]) expect(validateClientEvent(bad)).toBeNull();
  });

  it("drops extra fields: a sentence, a name, an amount or a PIN is never kept", () => {
    const v = validateClientEvent({ event: "intent", source: "on_device", ms: 40, said: "send 5000 to Mama Ade", payee: "Mama Ade", amountMinor: "500000", pin: "4826" });
    expect(v).toEqual({ event: "intent", fields: { outcome: "ok", source: "on_device", ms: 40 } });
  });

  it("recordClientEvent stores the event for the person and answers 400 for anything else", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const store = new MemoryStore();
    expect(await recordClientEvent(store, "u1", { event: "app_start" })).toEqual({ ok: true });
    const rows = await store.list<{ event: string; userId: string }>("audit");
    expect(rows).toMatchObject([{ event: "app_start", userId: "u1" }]);
    await expect(recordClientEvent(store, "u1", { event: "hack" })).rejects.toMatchObject({ status: 400 });
  });

  it("limits each person to 60 events a minute, and the count resets next minute", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const store = new MemoryStore();
    const t = Date.parse("2026-11-27T10:00:10Z");
    for (let i = 0; i < 60; i++) expect(await recordClientEvent(store, "u1", { event: "app_start" }, t)).toEqual({ ok: true });
    await expect(recordClientEvent(store, "u1", { event: "app_start" }, t + 1000)).rejects.toMatchObject({ status: 429 });
    expect(await recordClientEvent(store, "u2", { event: "app_start" }, t)).toEqual({ ok: true }); // other people are not affected
    expect(await recordClientEvent(store, "u1", { event: "app_start" }, t + 60_000)).toEqual({ ok: true });
    expect(await store.list("audit")).toHaveLength(62);
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

  it("returns the last 20 receipts and 30 events, newest first, and only the signed-in person's", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const s = new MemoryStore();
    for (let i = 0; i < 25; i++) await put(s, receipt(`rcpt_u1_${String(i).padStart(2, "0")}`, "u1", 1_000_000 + i));
    await put(s, receipt("rcpt_u10_x", "u10", 5_000_000));
    await put(s, receipt("rcpt_u2_x", "u2", 5_000_001));
    for (let i = 0; i < 35; i++) await audit(s, "u1", "app_start", { outcome: "ok", ms: i }, 1000 + i);
    await audit(s, "u2", "pay_finish", { outcome: "ok" }, 9000);
    await audit(s, "u10", "pay_finish", { outcome: "ok" }, 9001);
    const h = await loadHistory(s, "u1");
    expect(h.receipts).toHaveLength(20);
    expect(h.receipts[0].id).toBe("rcpt_u1_24");
    expect(h.events).toHaveLength(30);
    expect(h.events[0]).toMatchObject({ event: "app_start", ms: 34 });
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
