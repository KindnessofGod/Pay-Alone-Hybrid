import { describe, expect, it } from "vitest";
import { aiPill, sourceChip } from "./status";

describe("aiPill", () => {
  it("says the AI is on this device when Nano is ready", () => {
    expect(aiPill("available")).toEqual({ label: "AI on this device", tone: "ok" });
  });
  it("says getting ready while checking, preparing, downloading or warming up", () => {
    for (const s of ["checking", "preparing", "downloading 40%", "downloading", "downloadable", "warming up"]) {
      expect(aiPill(s)).toEqual({ label: "AI getting ready…", tone: "wait" });
    }
  });
  it("says online with names and amounts hidden when Nano is unavailable", () => {
    expect(aiPill("unavailable")).toEqual({ label: "AI online, names and amounts hidden", tone: "cloud" });
  });
  it("treats an unknown state as unavailable, never as on-device", () => {
    expect(aiPill("something odd").tone).toBe("cloud");
  });
});

describe("sourceChip", () => {
  it("labels each route honestly", () => {
    expect(sourceChip("on_device").label).toBe("Answered on this device · Gemini Nano");
    expect(sourceChip("cloud").label).toBe("Answered online · names and amounts hidden");
    expect(sourceChip("rules").label).toBe("Understood instantly, no AI needed");
  });
  it("has an icon and tone per route", () => {
    expect(sourceChip("on_device")).toMatchObject({ icon: "🔒", tone: "ok" });
    expect(sourceChip("cloud")).toMatchObject({ icon: "☁", tone: "cloud" });
    expect(sourceChip("rules")).toMatchObject({ icon: "⚡", tone: "rules" });
  });
});
