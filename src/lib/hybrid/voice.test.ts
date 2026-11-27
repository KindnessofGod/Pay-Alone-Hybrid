import { describe, expect, it } from "vitest";
import { pickVoice } from "./voice";

const v = (name: string, lang = "en-US", localService = true) => ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;

describe("pickVoice: the most natural English voice the browser has", () => {
  it("prefers a Natural (neural) voice", () => {
    expect(pickVoice([v("Microsoft David - English (United States)"), v("Microsoft Aria Online (Natural) - English (United States)", "en-US", false), v("Google US English", "en-US", false)])?.name).toContain("Natural");
  });
  it("then a Google voice over the old Windows voices", () => {
    expect(pickVoice([v("Microsoft David - English (United States)"), v("Microsoft Zira - English (United States)"), v("Google UK English Female", "en-GB", false)])?.name).toBe("Google UK English Female");
  });
  it("then any English voice, and nothing when there is no English voice", () => {
    expect(pickVoice([v("Microsoft Zira - English (United States)"), v("Hortense", "fr-FR")])?.name).toContain("Zira");
    expect(pickVoice([v("Hortense", "fr-FR")])).toBeUndefined();
    expect(pickVoice([])).toBeUndefined();
  });
});
