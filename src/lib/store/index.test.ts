import { describe, expect, it } from "vitest";
import { storeKind } from "./index";

describe("which store the server uses", () => {
  it("Firestore when a service account or the emulator is set", () => {
    expect(storeKind({ FIREBASE_SERVICE_ACCOUNT: "{}" })).toBe("firestore");
    expect(storeKind({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085" })).toBe("firestore");
  });
  it("a local file on a developer machine", () => {
    expect(storeKind({})).toBe("file");
  });
  it("refuses to run on Vercel without Firestore, instead of losing PINs and receipts", () => {
    expect(storeKind({ VERCEL: "1" })).toBe("none");
  });
});
