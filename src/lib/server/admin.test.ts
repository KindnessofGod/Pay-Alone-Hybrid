import { describe, expect, it } from "vitest";
import { parseServiceAccount } from "./admin";

const sa = { type: "service_account", project_id: "pay-alone-hybrid", client_email: "x@pay-alone-hybrid.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n" };
const json = JSON.stringify(sa, null, 2);

describe("service account from the Vercel variable, however it was pasted", () => {
  it("plain JSON, pretty or one line", () => {
    expect(parseServiceAccount(json)).toEqual(sa);
    expect(parseServiceAccount(JSON.stringify(sa))).toEqual(sa);
  });
  it("with spaces or quotes around it", () => {
    expect(parseServiceAccount(`  ${json}\n`)).toEqual(sa);
    expect(parseServiceAccount(`'${JSON.stringify(sa)}'`)).toEqual(sa);
    expect(parseServiceAccount(JSON.stringify(JSON.stringify(sa)))).toEqual(sa);
  });
  it("base64 of the file", () => {
    expect(parseServiceAccount(Buffer.from(json).toString("base64"))).toEqual(sa);
  });
  it("private key line breaks turned into real line breaks", () => {
    const broken = JSON.stringify(sa).replace(/\\n/g, "\n");
    expect(parseServiceAccount(broken)).toEqual(sa);
  });
  it("a bad value gives a hint without any of the content", () => {
    try {
      parseServiceAccount("C:\\Users\\me\\Downloads\\pay-alone-hybrid-firebase-adminsdk.json");
      throw new Error("should fail");
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toMatch(/FIREBASE_SERVICE_ACCOUNT/);
      expect(m).not.toMatch(/Users|Downloads|adminsdk/);
    }
  });
});
