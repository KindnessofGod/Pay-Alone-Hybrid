// Cloud <-> device handoff for the voice. Gemini Live (cloud) is the default. If Live closes or the browser goes
// offline, the app keeps helping with the on-device loop (Web Speech with processLocally, Gemini Nano, browser
// voice). When the network is back it offers Live again; Live only restarts on the person's own tap (the browser
// needs a gesture for sound). Pure: no timers, no DOM. The log carries fixed words only, never content.
export const OFFLINE_SAY = "You're offline. I'll keep helping on this device.";
export const BACK_ONLINE_SAY = "Back online. Tap Live to use Gemini Live again.";

export type HandoffState = { mode: "cloud" | "device"; online: boolean; offer: boolean };
export type HandoffEvent =
  | { type: "offline" }
  | { type: "online" }
  | { type: "live_closed"; online?: boolean } // the Live socket ended by itself (error or network)
  | { type: "live_started" }
  | { type: "live_stopped" }; // the person stopped it: not a handoff
export type HandoffLog = { to: "device" | "cloud"; reason: "offline" | "live_closed" | "restored" };
export type HandoffStep = { state: HandoffState; say?: string; log?: HandoffLog };

export const initialHandoff = (): HandoffState => ({ mode: "cloud", online: true, offer: false });

export function stepHandoff(s: HandoffState, e: HandoffEvent): HandoffStep {
  switch (e.type) {
    case "offline":
      if (s.mode === "cloud") return { state: { mode: "device", online: false, offer: false }, say: OFFLINE_SAY, log: { to: "device", reason: "offline" } };
      return { state: { ...s, online: false, offer: false } };
    case "online":
      if (s.mode === "device" && !s.online) return { state: { mode: "device", online: true, offer: true }, say: BACK_ONLINE_SAY };
      return { state: { ...s, online: true } };
    case "live_closed": {
      const online = e.online ?? s.online;
      if (s.mode === "device") return { state: { ...s, online } };
      if (!online) return { state: { mode: "device", online: false, offer: false }, say: OFFLINE_SAY, log: { to: "device", reason: "offline" } };
      return { state: { mode: "device", online: true, offer: false }, log: { to: "device", reason: "live_closed" } };
    }
    case "live_started":
      if (s.mode === "device") return { state: { mode: "cloud", online: s.online, offer: false }, log: { to: "cloud", reason: "restored" } };
      return { state: s };
    case "live_stopped":
      return { state: s };
  }
}
