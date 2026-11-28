import { describe, expect, it } from "vitest";
import { MOVE_MS, initialDemo, stepDemo, tokenText, type DemoState } from "./demoflow";

const amt = { value: "200000", assetCode: "NGN", assetScale: 2 };
const run = (events: Parameters<typeof stepDemo>[1][], from: DemoState = initialDemo) => events.reduce(stepDemo, from);

describe("demo animation state machine", () => {
  it("starts idle with no token", () => {
    expect(initialDemo).toEqual({ stage: "idle" });
  });
  it("idle -> asked -> approving -> moving -> done", () => {
    expect(run([{ type: "asked", amount: amt, ref: "31" }])).toMatchObject({ stage: "asked", ref: "31" });
    expect(run([{ type: "asked", amount: amt, ref: "31" }, { type: "approving" }]).stage).toBe("approving");
    const moving = run([{ type: "asked", amount: amt, ref: "31" }, { type: "approving" }, { type: "paid" }]);
    expect(moving).toMatchObject({ stage: "moving", amount: amt, ref: "31" });
    expect(stepDemo(moving, { type: "moveEnd" }).stage).toBe("done");
  });
  it("the money only moves on a paid event, never on approving or moveEnd alone", () => {
    expect(run([{ type: "asked", amount: amt, ref: "31" }, { type: "moveEnd" }]).stage).toBe("asked");
    expect(run([{ type: "approving" }]).stage).toBe("idle");
    expect(run([{ type: "paid" }]).stage).toBe("idle");
  });
  it("paid from the server status alone (customer closed the card) still moves, once", () => {
    const s = run([{ type: "asked", amount: amt, ref: "31" }, { type: "paid" }]);
    expect(s.stage).toBe("moving");
    expect(stepDemo(s, { type: "paid" })).toBe(s);
    const d = stepDemo(s, { type: "moveEnd" });
    expect(stepDemo(d, { type: "paid" })).toBe(d); // no second animation for the same payment
  });
  it("declined and expired end the request without any movement", () => {
    expect(run([{ type: "asked", amount: amt, ref: "31" }, { type: "declined" }]).stage).toBe("declined");
    expect(run([{ type: "asked", amount: amt, ref: "31" }, { type: "approving" }, { type: "expired" }]).stage).toBe("expired");
    expect(run([{ type: "asked", amount: amt, ref: "31" }, { type: "declined" }, { type: "paid" }]).stage).toBe("declined");
  });
  it("approving can go back to asked when the customer stops", () => {
    expect(run([{ type: "asked", amount: amt, ref: "31" }, { type: "approving" }, { type: "stopped" }]).stage).toBe("asked");
  });
  it("reset and a new ask start over from any stage", () => {
    const d = run([{ type: "asked", amount: amt, ref: "31" }, { type: "paid" }, { type: "moveEnd" }]);
    expect(stepDemo(d, { type: "reset" })).toEqual({ stage: "idle" });
    expect(stepDemo(d, { type: "asked", amount: amt, ref: "42" })).toMatchObject({ stage: "asked", ref: "42" });
  });
  it("token text comes from the amount in minor units", () => {
    expect(tokenText(amt)).toBe("₦2,000.00 →");
    expect(MOVE_MS).toBeGreaterThan(500);
  });
});
