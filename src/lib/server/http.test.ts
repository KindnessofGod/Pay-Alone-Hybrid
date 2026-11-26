import { describe, expect, it } from "vitest";
import { handle } from "./http";

const verify = async (t: string) => (t === "good-token" ? "u1" : Promise.reject(new Error("bad")));
const req = (headers: Record<string, string>, body: unknown = {}) => new Request("https://x/api", { method: "POST", headers, body: JSON.stringify(body) });

describe("API wrapper", () => {
  it("passes the verified user id and the body to the handler", async () => {
    const res = await handle(req({ authorization: "Bearer good-token" }, { a: 1 }), verify, async (uid, body) => ({ uid, body }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: "u1", body: { a: 1 } });
  });
  it("401 without a valid sign-in token; the handler never runs", async () => {
    let ran = false;
    for (const h of [{}, { authorization: "Bearer nope" }, { authorization: "good-token" }] as Record<string, string>[]) {
      const res = await handle(req(h), verify, async () => ((ran = true), {}));
      expect(res.status).toBe(401);
    }
    expect(ran).toBe(false);
  });
  it("400 on a body that is not JSON", async () => {
    const r = new Request("https://x/api", { method: "POST", headers: { authorization: "Bearer good-token" }, body: "pin=4826" });
    const res = await handle(r, verify, async () => ({}));
    expect(res.status).toBe(400);
  });
  it("500 hides the error details (they could contain a PIN) and logs nothing secret", async () => {
    const logs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
    try {
      const res = await handle(req({ authorization: "Bearer good-token" }, { pin: "4826" }), verify, async () => {
        throw new Error("failed with pin 4826");
      });
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("4826");
      expect(logs.join("\n")).not.toContain("4826");
    } finally {
      console.error = orig;
    }
  });
  it("answers are never cached", async () => {
    const res = await handle(req({ authorization: "Bearer good-token" }), verify, async () => ({}));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
