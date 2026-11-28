import { describe, expect, it, vi } from "vitest";
import { decideDeviceCheck, runDeviceCheck, DEVICE_CHECK_MS } from "./nanocheck";
import type { Understood } from "./understand";

const live = { amountMinor: "200000", payeeId: "c2" };
const prop = (amountMinor: string, payeeId: string, source: "on_device" | "cloud" | "rules" = "on_device"): Understood => ({
  kind: "proposal",
  proposal: { amountMinor, payeeId, payeeName: "X" },
  needsApproval: true,
  source,
});

describe("decideDeviceCheck (pure)", () => {
  it("agree: Nano read the same amount and payee", () => {
    expect(decideDeviceCheck(live, prop("200000", "c2"))).toEqual({ result: "agree", source: "on_device" });
  });
  it("mismatch: a different amount", () => {
    expect(decideDeviceCheck(live, prop("20000", "c2"))).toEqual({ result: "mismatch", source: "on_device" });
  });
  it("mismatch: a different payee", () => {
    expect(decideDeviceCheck(live, prop("200000", "c1"))).toEqual({ result: "mismatch", source: "on_device" });
  });
  it("unavailable: Nano missing, busy or too slow", () => {
    expect(decideDeviceCheck(live, "unavailable")).toEqual({ result: "unavailable", source: "rules" });
    expect(decideDeviceCheck(live, "timeout")).toEqual({ result: "unavailable", source: "rules" });
  });
  it("unavailable: an answer not made on the device never counts (cloud or rules)", () => {
    expect(decideDeviceCheck(live, prop("200000", "c2", "cloud"))).toEqual({ result: "unavailable", source: "rules" });
    expect(decideDeviceCheck(live, prop("20000", "c1", "rules"))).toEqual({ result: "unavailable", source: "rules" });
  });
  it("unavailable: Nano gave no usable reading (unclear, rejected, other intent)", () => {
    expect(decideDeviceCheck(live, { kind: "unclear", source: "on_device" })).toEqual({ result: "unavailable", source: "rules" });
    expect(decideDeviceCheck(live, { kind: "rejected", reason: "amount_missing" as never, source: "on_device" })).toEqual({ result: "unavailable", source: "rules" });
  });
});

const CONTACTS = [{ id: "c2", name: "Tunde" }, { id: "c1", name: "Mama Ade" }];
describe("runDeviceCheck (on device only, never cloud)", () => {
  const base = { contacts: CONTACTS, limitMinor: "5000000", live, deviceAvailable: true };
  it("agrees when Nano reads the same thing; the cloud engine is never called", async () => {
    const cloud = vi.fn(async () => ({}));
    const onDevice = vi.fn(async () => ({ action: "send", amountMinor: 200000, payee: "Tunde" }));
    const r = await runDeviceCheck("send 2000 naira to Tunde", { ...base, engines: { onDevice, cloud } });
    expect(r).toEqual({ result: "agree", source: "on_device" });
    expect(cloud).not.toHaveBeenCalled();
    expect(onDevice).toHaveBeenCalledTimes(1);
  });
  it("does not take the instant shortcut: a clean command still goes to Nano", async () => {
    const onDevice = vi.fn(async () => ({ action: "send", amountMinor: 200000, payee: "Tunde" }));
    await runDeviceCheck("send 2000 naira to Tunde", { ...base, engines: { onDevice, cloud: vi.fn() } });
    expect(onDevice).toHaveBeenCalled();
  });
  it("mismatch when Nano reads another amount that the transcript supports", async () => {
    const onDevice = vi.fn(async () => ({ action: "send", amountMinor: 20000, payee: "Tunde" }));
    const r = await runDeviceCheck("send 200 naira and then 2000 naira to Tunde", { ...base, engines: { onDevice, cloud: vi.fn() } });
    expect(["mismatch", "unavailable"]).toContain(r.result);
  });
  it("unavailable without calling anything when the device has no Nano", async () => {
    const onDevice = vi.fn();
    const r = await runDeviceCheck("send 2000 naira to Tunde", { ...base, deviceAvailable: false, engines: { onDevice, cloud: vi.fn() } });
    expect(r).toEqual({ result: "unavailable", source: "rules" });
    expect(onDevice).not.toHaveBeenCalled();
  });
  it("unavailable when Nano is busy", async () => {
    const onDevice = vi.fn();
    const r = await runDeviceCheck("send 2000 naira to Tunde", { ...base, engines: { onDevice, cloud: vi.fn(), onDeviceBusy: () => true } });
    expect(r).toEqual({ result: "unavailable", source: "rules" });
    expect(onDevice).not.toHaveBeenCalled();
  });
  it("unavailable when Nano throws", async () => {
    const r = await runDeviceCheck("send 2000 naira to Tunde", { ...base, engines: { onDevice: async () => { throw new Error("nope"); }, cloud: vi.fn() } });
    expect(r).toEqual({ result: "unavailable", source: "rules" });
  });
  it("unavailable when Nano is slower than the cap", async () => {
    vi.useFakeTimers();
    const p = runDeviceCheck("send 2000 naira to Tunde", { ...base, engines: { onDevice: () => new Promise(() => undefined), cloud: vi.fn() } });
    await vi.advanceTimersByTimeAsync(DEVICE_CHECK_MS + 10);
    expect(await p).toEqual({ result: "unavailable", source: "rules" });
    vi.useRealTimers();
  });
  it("a spoken PIN never reaches Nano", async () => {
    const onDevice = vi.fn();
    const r = await runDeviceCheck("my pin is 4 8 2 6", { ...base, engines: { onDevice, cloud: vi.fn() } });
    expect(onDevice).not.toHaveBeenCalled();
    expect(r.result).toBe("unavailable");
  });
});
