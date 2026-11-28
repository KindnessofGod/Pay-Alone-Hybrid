import { describe, expect, it } from "vitest";
import { OFFLINE_SAY, BACK_ONLINE_SAY, initialHandoff, stepHandoff } from "./handoff";

const run = (events: Parameters<typeof stepHandoff>[1][], from = initialHandoff()) => {
  let s = from;
  const out: ReturnType<typeof stepHandoff>[] = [];
  for (const e of events) {
    const r = stepHandoff(s, e);
    out.push(r);
    s = r.state;
  }
  return { s, out };
};

describe("handoff state machine (cloud Live <-> on-device loop)", () => {
  it("starts in the cloud, online, no offer", () => {
    expect(initialHandoff()).toEqual({ mode: "cloud", online: true, offer: false });
  });
  it("going offline while on Live: switch to the device, say the line, log once", () => {
    const { out, s } = run([{ type: "offline" }]);
    expect(s).toEqual({ mode: "device", online: false, offer: false });
    expect(out[0].say).toBe(OFFLINE_SAY);
    expect(out[0].log).toEqual({ to: "device", reason: "offline" });
  });
  it("the Live socket closing right after (offline) does not log or say twice", () => {
    const { out } = run([{ type: "offline" }, { type: "live_closed" }]);
    expect(out[1].say).toBeUndefined();
    expect(out[1].log).toBeUndefined();
    expect(out[1].state.mode).toBe("device");
  });
  it("Live closing while still online: switch to the device, reason live_closed, no offline line", () => {
    const { out } = run([{ type: "live_closed" }]);
    expect(out[0].state).toEqual({ mode: "device", online: true, offer: false });
    expect(out[0].log).toEqual({ to: "device", reason: "live_closed" });
    expect(out[0].say).toBeUndefined();
  });
  it("back online after an offline switch: offer Live again, do not switch yet", () => {
    const { out } = run([{ type: "offline" }, { type: "online" }]);
    expect(out[1].state).toEqual({ mode: "device", online: true, offer: true });
    expect(out[1].say).toBe(BACK_ONLINE_SAY);
    expect(out[1].log).toBeUndefined();
  });
  it("Live started again: back to cloud, logged, offer cleared", () => {
    const { out, s } = run([{ type: "offline" }, { type: "online" }, { type: "live_started" }]);
    expect(s).toEqual({ mode: "cloud", online: true, offer: false });
    expect(out[2].log).toEqual({ to: "cloud", reason: "restored" });
  });
  it("online while already on Live does nothing", () => {
    const { out } = run([{ type: "online" }]);
    expect(out[0].state).toEqual(initialHandoff());
    expect(out[0].say).toBeUndefined();
    expect(out[0].log).toBeUndefined();
  });
  it("the first live_started is not a handoff", () => {
    const { out } = run([{ type: "live_started" }]);
    expect(out[0].log).toBeUndefined();
  });
  it("offline twice speaks and logs once", () => {
    const { out } = run([{ type: "offline" }, { type: "offline" }]);
    expect(out[1].say).toBeUndefined();
    expect(out[1].log).toBeUndefined();
  });
  it("a Live close that arrives while the browser says offline counts as offline", () => {
    const { out } = run([{ type: "live_closed", online: false }]);
    expect(out[0].log).toEqual({ to: "device", reason: "offline" });
    expect(out[0].say).toBe(OFFLINE_SAY);
  });
  it("the person stopping Live is not a handoff", () => {
    const { out } = run([{ type: "live_stopped" }]);
    expect(out[0].log).toBeUndefined();
    expect(out[0].state.mode).toBe("cloud");
  });
});
