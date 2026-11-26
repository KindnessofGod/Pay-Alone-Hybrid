import { describe, expect, it } from "vitest";
import { speechMode } from "./speechpolicy";

describe("speech for the payment flow (red-team #4)", () => {
  it("uses the microphone when recognition runs on this computer", () => {
    expect(speechMode("local", false)).toEqual({ mic: true, local: true });
  });
  it("without on-device recognition, the default is typing or keypad, not cloud speech", () => {
    expect(speechMode("server", false)).toEqual({ mic: false, local: false });
    expect(speechMode("none", false)).toEqual({ mic: false, local: false });
  });
  it("cloud speech only after an explicit opt-in", () => {
    expect(speechMode("server", true)).toEqual({ mic: true, local: false });
  });
  it("never uses cloud speech while a PIN is being entered, even with opt-in", () => {
    expect(speechMode("server", true, "pin")).toEqual({ mic: false, local: false });
    expect(speechMode("local", true, "pin")).toEqual({ mic: false, local: false });
  });
});
