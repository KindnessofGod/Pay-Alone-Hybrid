import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory";
import type { Store } from "../store";
import { audit, recentAudit } from "./audit";

afterEach(() => vi.restoreAllMocks());
const spy = () => vi.spyOn(console, "info").mockImplementation(() => {});

describe("audit log", () => {
  it("stores a durable record per user and prints one console line", async () => {
    const info = spy();
    const store = new MemoryStore();
    await audit(store, "u1", "pay_finish", { outcome: "ok", receiptId: "rcpt_abc123", method: "pin", asset: "NGN", simulated: true, ms: 120, requestId: "req_abc123" });
    expect(info.mock.calls.map((c) => c.join(" "))).toEqual(["audit pay_finish ok receiptId=rcpt_abc123 method=pin asset=NGN simulated=true ms=120 requestId=req_abc123"]);
    const rows = await recentAudit(store, "u1", 30);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "pay_finish", outcome: "ok", receiptId: "rcpt_abc123", method: "pin", simulated: true });
    expect(typeof rows[0].at).toBe("string");
  });

  it("keeps only the whitelisted fields, so a PIN, token or name passed by mistake is dropped", async () => {
    const info = spy();
    const store = new MemoryStore();
    await audit(store, "u1", "pin_set", {
      outcome: "ok",
      pin: "4826",
      oldPin: "1357",
      accessToken: "tok_SECRET",
      payeeName: "Mama Ade",
      name: "Tunde",
      reason: "4826", // a digit string is not an allowed reason
      requestId: "Mama Ade pays 4826",
    } as never);
    const all = JSON.stringify(await store.list("audit")) + info.mock.calls.join();
    expect(all).not.toMatch(/4826|1357|tok_SECRET|Mama|Tunde|oldPin|payeeName/);
    expect(info.mock.calls.map((c) => c.join(" "))).toEqual(["audit pin_set ok"]);
  });

  it("never prints the user id or the amount to the console, but keeps the amount for the person's own history", async () => {
    const info = spy();
    const store = new MemoryStore();
    await audit(store, "uid-Secret9", "pay_start", { outcome: "ok", amountMinor: "500000", asset: "NGN", simulated: true });
    expect(info.mock.calls.join()).not.toMatch(/uid-Secret9|500000/);
    expect((await recentAudit(store, "uid-Secret9", 5))[0]).toMatchObject({ amountMinor: "500000", asset: "NGN" });
  });

  it("an audit failure never breaks the caller", async () => {
    spy();
    const broken = { put: async () => Promise.reject(new Error("db down")) } as unknown as Store;
    await expect(audit(broken, "u1", "pay_finish", { outcome: "ok" })).resolves.toBeUndefined();
  });

  it("recentAudit is newest first, limited, and never returns another user's rows", async () => {
    spy();
    const store = new MemoryStore();
    for (let i = 0; i < 5; i++) await audit(store, "u1", "app_start", { outcome: "ok", ms: i }, 1000 + i);
    await audit(store, "u10", "app_start", { outcome: "ok", ms: 99 }, 2000);
    await audit(store, "u2", "app_start", { outcome: "ok", ms: 98 }, 2001);
    const rows = await recentAudit(store, "u1", 3);
    expect(rows.map((r) => r.ms)).toEqual([4, 3, 2]);
  });

  it("works with no user (a failed wallet callback): console only", async () => {
    const info = spy();
    const store = new MemoryStore();
    await audit(store, null, "wallet_callback", { outcome: "failed" });
    expect(info.mock.calls.map((c) => c.join(" "))).toEqual(["audit wallet_callback failed"]);
    expect(await store.list("audit")).toHaveLength(0);
  });
});
