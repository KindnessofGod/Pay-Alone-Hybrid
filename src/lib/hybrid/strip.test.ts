import { describe, expect, it } from "vitest";
import { hybridStrip } from "./strip";

const base = { mode: "cloud" as const, liveActive: true, nanoUsable: true, lastCheck: null, checking: false, offer: false };

describe("hybridStrip (what lights up, in plain words)", () => {
  it("Live on: Voice is Gemini Live in the cloud, money check is Gemini Nano on this device", () => {
    const r = hybridStrip(base);
    expect(r.voice).toEqual({ label: "Voice", engine: "Gemini Live", where: "cloud", lit: true });
    expect(r.money).toEqual({ label: "Money check", engine: "Gemini Nano", where: "on this device", lit: false });
  });
  it("the money row lights while checking and after Nano agreed", () => {
    expect(hybridStrip({ ...base, checking: true }).money.lit).toBe(true);
    expect(hybridStrip({ ...base, lastCheck: { result: "agree", source: "on_device" } }).money.lit).toBe(true);
  });
  it("Nano unavailable on the last check: rules on this device", () => {
    const r = hybridStrip({ ...base, lastCheck: { result: "unavailable", source: "rules" } });
    expect(r.money).toMatchObject({ engine: "rules", where: "on this device" });
  });
  it("no Nano on this computer: rules, always", () => {
    expect(hybridStrip({ ...base, nanoUsable: false }).money.engine).toBe("rules");
  });
  it("offline handoff: Voice is on this device, not Gemini Live", () => {
    const r = hybridStrip({ ...base, mode: "device", liveActive: false });
    expect(r.voice).toEqual({ label: "Voice", engine: "Web Speech", where: "on this device", lit: true });
    expect(r.text).toBe("Voice · on this device");
  });
  it("Live not started yet: Voice row is dim", () => {
    expect(hybridStrip({ ...base, liveActive: false }).voice.lit).toBe(false);
  });
  it("offer to go back to Live is carried through", () => {
    expect(hybridStrip({ ...base, mode: "device", liveActive: false, offer: true }).offer).toBe(true);
  });
  it("Nano chip text only after an agree", () => {
    expect(hybridStrip({ ...base, lastCheck: { result: "agree", source: "on_device" } }).chip).toBe("Double-checked on this device by Gemini Nano");
    expect(hybridStrip({ ...base, lastCheck: { result: "unavailable", source: "rules" } }).chip).toBeNull();
    expect(hybridStrip(base).chip).toBeNull();
  });
});
