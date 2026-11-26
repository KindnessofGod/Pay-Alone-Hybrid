import { describe, expect, it } from "vitest";
import { registrationOptions } from "./passkey";

describe("passkey registration", () => {
  it("allows Windows Hello on the laptop and a phone nearby (no fingerprint reader needed)", async () => {
    const { options } = await registrationOptions({ baseUrl: "https://pay-alone-hybrid.vercel.app", userId: "u1", userName: "u1", existing: [] });
    expect(options.authenticatorSelection?.authenticatorAttachment).toBeUndefined();
    expect(options.authenticatorSelection?.userVerification).toBe("required");
    expect(options.rp.id).toBe("pay-alone-hybrid.vercel.app");
  });
});
