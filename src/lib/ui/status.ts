// Plain-words labels for the header pill and the "how was this answered" chips. Pure, so it is tested.
export type Tone = "ok" | "wait" | "cloud" | "rules";

/** The header pill, from the Nano state the app already tracks. Unknown states never claim on-device. */
export function aiPill(nano: string): { label: string; tone: Tone } {
  if (nano === "available") return { label: "AI on this device", tone: "ok" };
  if (nano === "checking" || nano === "preparing" || nano === "warming up" || nano === "downloadable" || nano.startsWith("downloading"))
    return { label: "AI getting ready…", tone: "wait" };
  return { label: "AI online, names and amounts hidden", tone: "cloud" };
}

export function sourceChip(source: "on_device" | "cloud" | "rules"): { icon: string; label: string; tone: Tone } {
  if (source === "on_device") return { icon: "🔒", label: "Answered on this device · Gemini Nano", tone: "ok" };
  if (source === "cloud") return { icon: "☁", label: "Answered online · names and amounts hidden", tone: "cloud" };
  return { icon: "⚡", label: "Understood instantly, no AI needed", tone: "rules" };
}
