import { describe, expect, it } from "vitest";
import { yesNo } from "./confirm";

describe("negation-safe yes/no (red-team #2)", () => {
  it.each([
    "No, that is not right",
    "No, don't send it",
    "No. Do not send it.",
    "stop, wrong person, okay?",
    "cancel it okay",
    "not correct",
    "no",
    "nope",
    "wrong amount",
    "rara", // Yoruba
    "mba", // Igbo
    "a'a", // Hausa
    "I no want am",
    "yes no",
    "yes but not to Tunde",
  ])("'%s' is NOT a yes", (said) => {
    expect(yesNo(said)).not.toBe("yes");
  });

  it.each(["No, don't send it", "stop", "cancel", "not correct", "No. Do not send it."])("'%s' is a no", (said) => {
    expect(yesNo(said)).toBe("no");
  });

  it.each(["yes", "Yes.", "yes please", "okay", "correct", "that's right", "send it"])("'%s' is a yes (short, closed list)", (said) => {
    expect(yesNo(said)).toBe("yes");
  });

  it("a long sentence that happens to contain a yes word is unclear, not yes", () => {
    expect(yesNo("my brother said it was right to call you yesterday about the money")).toBe("unclear");
  });
});
