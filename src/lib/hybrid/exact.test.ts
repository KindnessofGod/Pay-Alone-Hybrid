import { describe, expect, it } from "vitest";
import { exactInstruction, matchesTemplate, normalizeSpoken, stillOnTrack } from "./exact";

const T = "You are paying Tunde 3,000 naira. Fees are included.";

describe("normalizeSpoken", () => {
  it("lowercases, drops punctuation, joins thousands commas", () => {
    expect(normalizeSpoken("You are paying Tunde 3,000 naira!")).toEqual(["you", "are", "paying", "tunde", "3000", "naira"]);
  });
  it("turns number words into digits", () => {
    expect(normalizeSpoken("three thousand naira")).toEqual(["3000", "naira"]);
    expect(normalizeSpoken("two thousand five hundred naira")).toEqual(["2500", "naira"]);
  });
  it("reads the naira sign and NGN as naira", () => {
    expect(normalizeSpoken("₦500")).toEqual(["naira", "500"]);
    expect(normalizeSpoken("NGN 500")).toEqual(["naira", "500"]);
  });
  it("keeps accented letters (other languages)", () => {
    expect(normalizeSpoken("Vous payez Tunde, élevé")).toEqual(["vous", "payez", "tunde", "élevé"]);
  });
});

describe("matchesTemplate", () => {
  it("accepts the same words", () => expect(matchesTemplate(T, "You are paying Tunde 3,000 naira. Fees are included.").ok).toBe(true));
  it("accepts number words for digits and tiny filler differences", () => {
    expect(matchesTemplate(T, "You are paying Tunde three thousand naira. Fees are included").ok).toBe(true);
  });
  it("rejects a different amount", () => {
    const r = matchesTemplate(T, "You are paying Tunde 5,000 naira. Fees are included.");
    expect(r.ok).toBe(false);
  });
  it("rejects a different name", () => {
    expect(matchesTemplate(T, "You are paying Chidi 3,000 naira. Fees are included.").ok).toBe(false);
  });
  it("rejects an extra number", () => {
    expect(matchesTemplate(T, "You are paying Tunde 3,000 naira. Fees are included. Then 9000.").ok).toBe(false);
  });
  it("rejects missing the amount", () => {
    expect(matchesTemplate(T, "You are paying Tunde. Fees are included.").ok).toBe(false);
  });
  it("rejects an empty or very short transcript", () => {
    expect(matchesTemplate(T, "").ok).toBe(false);
    expect(matchesTemplate(T, "Sure").ok).toBe(false);
  });
  it("rejects when the model adds a lot of its own words", () => {
    expect(matchesTemplate(T, "Okay so basically you are paying Tunde 3,000 naira and I think that is great, fees are included, enjoy your day").ok).toBe(false);
  });
  it("works for non-English text", () => {
    const fr = "Vous payez Tunde 3 000 nairas. Les frais sont inclus.";
    expect(matchesTemplate(fr, "Vous payez Tunde 3 000 nairas. Les frais sont inclus.").ok).toBe(true);
    expect(matchesTemplate(fr, "Vous payez Tunde 4 000 nairas. Les frais sont inclus.").ok).toBe(false);
  });
});

describe("stillOnTrack (checked while the model is still talking)", () => {
  it("true for a correct start", () => {
    expect(stillOnTrack(T, "You are paying").ok).toBe(true);
    expect(stillOnTrack(T, "You are paying Tunde three thousand").ok).toBe(true);
  });
  it("false the moment a wrong number or name comes", () => {
    expect(stillOnTrack(T, "You are paying Tunde 5,000 ").ok).toBe(false);
    expect(stillOnTrack(T, "You are paying Chidi ").ok).toBe(false);
  });
  it("false when the model talks about something else", () => {
    expect(stillOnTrack(T, "I am sorry I cannot do that right now").ok).toBe(false);
  });
  it("true for nothing yet", () => expect(stillOnTrack(T, "").ok).toBe(true));
});

describe("exactInstruction", () => {
  it("wraps the template word for word", () => {
    const s = exactInstruction("Hello there.");
    expect(s).toContain("Read this exactly, word for word, nothing else:");
    expect(s).toContain("Hello there.");
  });
});
