import { describe, expect, it } from "vitest";
import { activityLine, badgeOf, receiptSentence, type ReceiptView } from "./history";

const r: ReceiptView = { id: "rcpt_a", payeeName: "Mama Ade", debit: { value: "502000", assetCode: "NGN", assetScale: 2 }, method: "pin", simulated: true, createdAt: "2026-11-27T10:05:00.000Z" };

describe("receipt history text", () => {
  it("the badge says REAL or SIMULATED in words, never only by colour", () => {
    expect(badgeOf(r)).toBe("SIMULATED");
    expect(badgeOf({ ...r, simulated: false })).toBe("REAL");
  });
  it("the spoken sentence starts with real or simulated, then amount from the receipt, payee, time and method", () => {
    const s = receiptSentence(r, "en-NG");
    expect(s).toMatch(/^Simulated payment, no real money moved\./);
    expect(s).toContain("NGN 5,020.00 to Mama Ade");
    expect(s).toContain("approved by PIN");
    expect(receiptSentence({ ...r, simulated: false, method: "passkey" }, "en-NG")).toMatch(/^Real payment\..*approved by fingerprint/);
  });
  it("activity lines are plain words: time, event, outcome", () => {
    const a = activityLine({ at: "2026-11-27T10:05:00.000Z", event: "pay_finish", outcome: "fail", reason: "wrong" }, "en-NG");
    expect(a).toContain("Payment approval");
    expect(a).toContain("failed");
    expect(a).toContain("wrong");
    expect(activityLine({ at: "2026-11-27T10:05:00.000Z", event: "mystery" }, "en-NG")).toContain("mystery");
  });
});
