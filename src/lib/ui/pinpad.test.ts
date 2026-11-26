import { describe, expect, it } from "vitest";
import { pinAnnouncement, pinPress } from "./pinpad";

describe("PIN pad", () => {
  it("takes digits up to six, with backspace and clear", () => {
    let p = "";
    for (const k of ["4", "8", "2", "6", "1", "3", "9"]) p = pinPress(p, k);
    expect(p).toBe("482613");
    expect(pinPress(p, "back")).toBe("48261");
    expect(pinPress(p, "clear")).toBe("");
    expect(pinPress("12", "x")).toBe("12");
  });
  it("tells a screen reader how many digits, never which digits", () => {
    expect(pinAnnouncement("4826")).toBe("four digits typed");
    expect(pinAnnouncement("4")).toBe("one digit typed");
    expect(pinAnnouncement("")).toBe("no digits typed");
    for (const pin of ["4826", "1", "999999"]) expect(pinAnnouncement(pin)).not.toMatch(/\d/);
  });
});
