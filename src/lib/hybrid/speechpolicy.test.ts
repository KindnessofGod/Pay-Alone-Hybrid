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
  it("online speech opt-in also works while the on-device pack is still downloading", () => {
    expect(speechMode("installable", true)).toEqual({ mic: true, local: false });
    expect(speechMode("downloading", true)).toEqual({ mic: true, local: false });
    expect(speechMode("installable", false)).toEqual({ mic: false, local: false });
    expect(speechMode("downloading", false)).toEqual({ mic: false, local: false });
  });
  it("on-device wins over the opt-in the moment the pack is ready, and a PIN is never spoken", () => {
    expect(speechMode("local", true)).toEqual({ mic: true, local: true });
    expect(speechMode("downloading", true, "pin")).toEqual({ mic: false, local: false });
  });
  it("no recognition at all means no mic, even with opt-in", () => {
    expect(speechMode("none", true)).toEqual({ mic: false, local: false });
  });
});
