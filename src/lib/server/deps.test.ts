import { afterEach, describe, expect, it } from "vitest";
import { appCheckGate } from "./deps";

const prev = process.env.APPCHECK_ENFORCE;
afterEach(() => {
  if (prev === undefined) delete process.env.APPCHECK_ENFORCE;
  else process.env.APPCHECK_ENFORCE = prev;
});

describe("appCheckGate fails closed", () => {
  it("enforces when unset, 1, or anything but 0", async () => {
    for (const v of [undefined, "1", "", "true"]) {
      if (v === undefined) delete process.env.APPCHECK_ENFORCE;
      else process.env.APPCHECK_ENFORCE = v;
      const g = appCheckGate();
      expect(g).toBeDefined();
      await expect(g!(null as never)).rejects.toThrow();
    }
  });
  it("is off only when explicitly 0", () => {
    process.env.APPCHECK_ENFORCE = "0";
    expect(appCheckGate()).toBeUndefined();
  });
});
