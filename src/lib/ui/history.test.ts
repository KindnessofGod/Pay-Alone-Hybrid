import { describe, expect, it } from "vitest";
import { activityLine, badgeOf, debugLine, receiptSentence, type ReceiptView } from "./history";

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

describe("debug log lines (the person's own last 50 events)", () => {
  it("shows t, event, outcome and every whitelisted field, in a fixed order", () => {
    const l = debugLine({ at: "2026-11-27T10:05:00.000Z", event: "understand_done", outcome: "ok", t: 4210, sid: "abcdefgh", source: "cloud", kind: "proposal", ms: 840, cloud_raced: false });
    expect(l).toBe("t=4210 understand_done ok kind=proposal source=cloud cloud_raced=false ms=840");
  });
  it("server events without t still read well, with the saved time instead", () => {
    const l = debugLine({ at: "2026-11-27T10:05:00.000Z", event: "pay_finish", outcome: "wrong", reason: "wrong_pin", method: "pin" }, "en-NG");
    expect(l).toContain("pay_finish wrong");
    expect(l).toContain("reason=wrong_pin");
    expect(l).not.toContain("t=");
  });
  it("never prints a field it does not know (no user id, no free text)", () => {
    const l = debugLine({ at: "2026-11-27T10:05:00.000Z", event: "x", outcome: "ok", userId: "u1", said: "my pin is 1234" } as never);
    expect(l).not.toMatch(/u1|1234|said/);
  });
});
