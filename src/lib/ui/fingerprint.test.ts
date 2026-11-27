import { describe, expect, it } from "vitest";
import { approvalChallengeForDevice } from "../passkey";
import { fingerprintAvailable, fingerprintRequest, textToBase64url } from "./fingerprint";

describe("fingerprint helpers (browser side)", () => {
  it("encodes the challenge exactly as the server expects it", () => {
    for (const c of ["abc", "a.b_c-d", "héllo ✓ 12345"]) expect(textToBase64url(c)).toBe(approvalChallengeForDevice(c));
  });
  it("asks the device to verify the person, with the server challenge", () => {
    const r = fingerprintRequest("chal.123");
    expect(r.challenge).toBe(approvalChallengeForDevice("chal.123"));
    expect(r.userVerification).toBe("required");
    expect(r.rpId).toBeUndefined();
  });
  it("is available only when the browser has WebAuthn", () => {
    expect(fingerprintAvailable({})).toBe(false);
    expect(fingerprintAvailable({ PublicKeyCredential: function () {} })).toBe(true);
  });
});
