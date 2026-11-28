import { describe, expect, it, vi } from "vitest";
import { raceOnDeviceFirst } from "./race";

const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const laterFail = (ms: number, e: Error) => new Promise<never>((_, rej) => setTimeout(() => rej(e), ms));

describe("raceOnDeviceFirst", () => {
  it("fast on-device answer wins and the cloud is never started", async () => {
    const startCloud = vi.fn(() => later(1, "cloud"));
    const r = await raceOnDeviceFirst(later(5, "nano"), startCloud, 60);
    expect(r.winner).toBe("on_device");
    expect(r.value).toBe("nano");
    expect(r.cloudStarted).toBe(false);
    expect(startCloud).not.toHaveBeenCalled();
  });
  it("slow on-device: cloud starts after the head start and wins if first", async () => {
    const startCloud = vi.fn(() => later(5, "cloud"));
    const r = await raceOnDeviceFirst(later(200, "nano"), startCloud, 20);
    expect(startCloud).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ winner: "cloud", value: "cloud", cloudStarted: true });
  });
  it("on-device finishing after the cloud started but before it answers still wins", async () => {
    const r = await raceOnDeviceFirst(later(40, "nano"), () => later(200, "cloud"), 20);
    expect(r).toMatchObject({ winner: "on_device", value: "nano", cloudStarted: true });
  });
  it("on-device throwing fast starts the cloud at once", async () => {
    const t0 = Date.now();
    const r = await raceOnDeviceFirst(laterFail(2, new Error("boom")), () => later(2, "cloud"), 500);
    expect(r).toMatchObject({ winner: "cloud", value: "cloud", cloudStarted: true });
    expect(Date.now() - t0).toBeLessThan(300);
  });
  it("an unusable (null) first answer waits for the other", async () => {
    const r = await raceOnDeviceFirst(later(30, null), () => later(40, "cloud"), 10);
    expect(r).toMatchObject({ winner: "cloud", value: "cloud" });
  });
  it("both fail: no winner, both outcomes reported", async () => {
    const r = await raceOnDeviceFirst(laterFail(30, new Error("a")), () => laterFail(5, new Error("b")), 10);
    expect(r.winner).toBeNull();
    expect(r.device).toMatchObject({ ok: false });
    expect(r.cloud).toMatchObject({ ok: false });
  });
  it("cloud not allowed (startCloud returns undefined): waits for on-device", async () => {
    const r = await raceOnDeviceFirst(later(40, "nano"), () => undefined, 10);
    expect(r).toMatchObject({ winner: "on_device", value: "nano", cloudStarted: false });
  });
  it("a late cloud failure after on-device won is swallowed", async () => {
    const r = await raceOnDeviceFirst(later(30, "nano"), () => laterFail(40, new Error("late")), 10);
    expect(r.winner).toBe("on_device");
    await later(60, 0); // no unhandled rejection
  });
});
