import { describe, expect, it } from "vitest";
import { appOrigin } from "./origin";

const D = "https://usepayalone.tech";
describe("appOrigin", () => {
  it("passes an allowed origin through", () => {
    expect(appOrigin("https://pay-alone-hybrid.vercel.app/api/x?y=1", {})).toBe("https://pay-alone-hybrid.vercel.app");
    expect(appOrigin("http://localhost:3000/a", {})).toBe("http://localhost:3000");
  });
  it("falls back to the first entry for an unknown host or bad url", () => {
    expect(appOrigin("https://evil.example/api/x", {})).toBe(D);
    expect(appOrigin("not a url", {})).toBe(D);
  });
  it("APP_ORIGINS overrides the default list", () => {
    const env = { APP_ORIGINS: "https://a.example, https://b.example/" };
    expect(appOrigin("https://b.example/x", env)).toBe("https://b.example");
    expect(appOrigin("https://usepayalone.tech/x", env)).toBe("https://a.example");
  });
  it("ignores trailing slashes and paths in the list", () => {
    expect(appOrigin("https://a.example/z", { APP_ORIGINS: "https://a.example/some/path/" })).toBe("https://a.example");
  });
});
