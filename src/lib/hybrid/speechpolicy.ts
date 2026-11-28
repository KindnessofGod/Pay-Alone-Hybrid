// Which speech input is allowed (red-team #4). Chrome's default recognition sends audio to Google,
// which would hear a PIN before our tripwire runs. So:
//   - on-device recognition: microphone on;
//   - otherwise: typing or keypad, unless the person explicitly turned on online speech;
//   - while a PIN is being entered: never a microphone. The PIN is typed on the keypad.
export type SpeechStatus = "local" | "installable" | "downloading" | "server" | "none";
export type Step = "request" | "pin";

export function speechMode(status: SpeechStatus, cloudOptIn: boolean, step: Step = "request"): { mic: boolean; local: boolean } {
  if (step === "pin") return { mic: false, local: false };
  if (status === "local") return { mic: true, local: true };
  if (status !== "none" && cloudOptIn) return { mic: true, local: false };
  return { mic: false, local: false };
}
