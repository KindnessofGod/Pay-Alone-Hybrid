import { describe, expect, it } from "vitest";
import { approvalMessage } from "./messages";

describe("what the app says after an approval try", () => {
  it("wrong PIN says the tries left", () => {
    expect(approvalMessage({ ok: false, reason: "wrong", triesLeft: 3 })).toBe("That PIN is not right. You have 3 tries left. Type it again, or say no to cancel.");
  });
  it("lockout, tap-only and unknown reasons", () => {
    expect(approvalMessage({ ok: false, reason: "locked" })).toBe("Too many wrong tries. Payments are locked for 15 minutes. Nothing was sent.");
    expect(approvalMessage({ ok: false, reason: "tap_not_enough" })).toBe("A tap is not enough. Type your PIN to approve.");
    expect(approvalMessage({ ok: false, reason: "server_not_set_up" })).toBe("The approval server is not set up yet. Nothing was sent.");
    expect(approvalMessage({ ok: false, reason: "zzz" })).toBe("Something went wrong. Nothing was sent.");
  });
  it("success speaks the server's sentence, never model text", () => {
    expect(approvalMessage({ ok: true, spoken: "Simulated payment, no real money moved. 5 naira to Tunde. Receipt saved." })).toBe("Simulated payment, no real money moved. 5 naira to Tunde. Receipt saved.");
  });
  it("a failed fingerprint says so and points to the PIN", () => {
    expect(approvalMessage({ ok: false, reason: "bad_passkey" })).toBe("Fingerprint did not work. You can try again or type your PIN.");
    expect(approvalMessage({ ok: false, reason: "no_pending" })).toContain("Nothing was changed");
  });
});
