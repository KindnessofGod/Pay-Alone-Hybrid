import { describe, expect, it } from "vitest";
import { addPaid, fitScale, formatNairaMinor, parseDemoMessage } from "./demoframes";

const ORIGIN = "https://usepayalone.tech";
const paid = { type: "payalone-demo", event: "paid", amountMinor: "200000", ref: "PA-1234" };

describe("parseDemoMessage (origin and shape)", () => {
  it("accepts a same-origin paid message", () => {
    expect(parseDemoMessage(paid, ORIGIN, ORIGIN)).toEqual({ event: "paid", amountMinor: "200000", ref: "PA-1234" });
  });
  it("refuses another origin", () => {
    expect(parseDemoMessage(paid, "https://evil.example", ORIGIN)).toBeNull();
    expect(parseDemoMessage(paid, "null", ORIGIN)).toBeNull();
  });
  it("refuses a wrong type, event or shape", () => {
    for (const bad of [null, "paid", 5, {}, { ...paid, type: "x" }, { ...paid, event: "mute" }, { ...paid, amountMinor: 2000 }, { ...paid, amountMinor: "20.5" }, { ...paid, amountMinor: "-5" }, { ...paid, amountMinor: "0" }, { ...paid, amountMinor: "" }, { ...paid, ref: 9 }, { ...paid, amountMinor: "9".repeat(16) }]) {
      expect(parseDemoMessage(bad, ORIGIN, ORIGIN)).toBeNull();
    }
  });
  it("allows a missing ref", () => {
    expect(parseDemoMessage({ type: "payalone-demo", event: "paid", amountMinor: "100" }, ORIGIN, ORIGIN)).toEqual({ event: "paid", amountMinor: "100", ref: "" });
  });
});

describe("formatNairaMinor (integer maths)", () => {
  it("formats whole naira without decimals and keeps kobo", () => {
    expect(formatNairaMinor("200000")).toBe("₦2,000");
    expect(formatNairaMinor("150050")).toBe("₦1,500.50");
    expect(formatNairaMinor("5")).toBe("₦0.05");
    expect(formatNairaMinor("100000000000")).toBe("₦1,000,000,000");
  });
});

describe("addPaid", () => {
  it("sums minor units as integers and ignores the same ref twice", () => {
    let s = { total: "0", refs: [] as string[] };
    s = addPaid(s, { amountMinor: "200000", ref: "A" });
    s = addPaid(s, { amountMinor: "150050", ref: "B" });
    s = addPaid(s, { amountMinor: "150050", ref: "B" });
    expect(s.total).toBe("350050");
  });
  it("counts payments that have no ref", () => {
    let s = { total: "0", refs: [] as string[] };
    s = addPaid(s, { amountMinor: "100", ref: "" });
    s = addPaid(s, { amountMinor: "100", ref: "" });
    expect(s.total).toBe("200");
  });
});

describe("fitScale", () => {
  it("scales to the tighter side and never above 1", () => {
    expect(fitScale({ w: 1000, h: 590 }, { w: 820, h: 1180 })).toBeCloseTo(0.5, 5);
    expect(fitScale({ w: 410, h: 5000 }, { w: 820, h: 1180 })).toBeCloseTo(0.5, 5);
    expect(fitScale({ w: 5000, h: 5000 }, { w: 820, h: 1180 })).toBe(1);
  });
  it("fits the landscape iPad (1180x820 screen, 1216x856 with bezel) to the left half", () => {
    expect(fitScale({ w: 608, h: 2000 }, { w: 1216, h: 856 })).toBeCloseTo(0.5, 5);
    expect(fitScale({ w: 2000, h: 428 }, { w: 1216, h: 856 })).toBeCloseTo(0.5, 5);
    expect(fitScale({ w: 880, h: 750 }, { w: 1216, h: 856 })).toBeCloseTo(880 / 1216, 5);
    expect(fitScale({ w: 880, h: Infinity }, { w: 1216, h: 856 })).toBeCloseTo(880 / 1216, 5);
  });
  it("is a small positive number for zero or negative space", () => {
    expect(fitScale({ w: 0, h: 0 }, { w: 820, h: 1180 })).toBeGreaterThan(0);
    expect(fitScale({ w: -5, h: 100 }, { w: 820, h: 1180 })).toBeGreaterThan(0);
  });
});

import { parseMuteMessage } from "./demoframes";
describe("parseMuteMessage", () => {
  it("accepts same-origin mute with a boolean", () => {
    expect(parseMuteMessage({ type: "payalone-demo", event: "mute", on: true }, ORIGIN, ORIGIN)).toBe(true);
    expect(parseMuteMessage({ type: "payalone-demo", event: "mute", on: false }, ORIGIN, ORIGIN)).toBe(false);
  });
  it("refuses other origins and shapes", () => {
    expect(parseMuteMessage({ type: "payalone-demo", event: "mute", on: true }, "https://evil.example", ORIGIN)).toBeNull();
    expect(parseMuteMessage({ type: "payalone-demo", event: "mute", on: "yes" }, ORIGIN, ORIGIN)).toBeNull();
    expect(parseMuteMessage(null, ORIGIN, ORIGIN)).toBeNull();
  });
});
