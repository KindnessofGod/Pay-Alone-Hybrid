// Is Gemini Nano usable in this browser right now? Uses Chrome's Prompt API directly, only to decide
// the route; the actual prompting goes through Firebase AI Logic.
"use client";

type Availability = "unavailable" | "downloadable" | "downloading" | "available";
declare const LanguageModel: { availability(opts?: object): Promise<Availability> } | undefined;

export async function nanoAvailability(): Promise<Availability> {
  try {
    if (typeof LanguageModel === "undefined") return "unavailable";
    return await LanguageModel.availability({ expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] });
  } catch {
    return "unavailable";
  }
}
