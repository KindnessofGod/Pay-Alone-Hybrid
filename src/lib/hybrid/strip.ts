// What the hybrid strip shows (voice panel and Approve sheet): which part is working where, in plain words.
// Pure, from facts the app already has. Nothing here is claimed unless it happened.
import type { DeviceCheckResult } from "./nanocheck";

export interface StripInput {
  mode: "cloud" | "device";
  liveActive: boolean;
  nanoUsable: boolean;
  lastCheck: DeviceCheckResult | null;
  checking: boolean;
  offer: boolean;
}
export interface StripRow {
  label: string;
  engine: string;
  where: string;
  lit: boolean;
}
export interface Strip {
  voice: StripRow;
  money: StripRow;
  /** One line for screen readers and the offline state, e.g. "Voice · on this device". */
  text: string;
  chip: string | null;
  offer: boolean;
}

export const NANO_CHIP = "Double-checked on this device by Gemini Nano";

export function hybridStrip(i: StripInput): Strip {
  const voice: StripRow =
    i.mode === "cloud"
      ? { label: "Voice", engine: "Gemini Live", where: "cloud", lit: i.liveActive }
      : { label: "Voice", engine: "Web Speech", where: "on this device", lit: true };
  const rules = !i.nanoUsable || i.lastCheck?.source === "rules";
  const money: StripRow = {
    label: "Money check",
    engine: rules ? "rules" : "Gemini Nano",
    where: "on this device",
    lit: i.checking || i.lastCheck?.result === "agree",
  };
  const text = i.mode === "cloud" ? `Voice · Gemini Live · cloud. Money check · ${money.engine} · on this device` : "Voice · on this device";
  return { voice, money, text, chip: i.lastCheck?.result === "agree" ? NANO_CHIP : null, offer: i.offer };
}
