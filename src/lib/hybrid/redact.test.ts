import { describe, expect, it } from "vitest";
import { redactForCloud } from "./redact";

const contacts = ["Mama Ade", "Tunde", "Chidi Okafor"];

describe("redaction before the cloud path", () => {
  it("replaces the amount and the person with placeholders", () => {
    const r = redactForCloud("send five thousand naira to Mama Ade", contacts);
    expect(r.text).toBe("send [AMOUNT] naira to [CONTACT_1]");
    expect(r.contacts).toEqual(["Mama Ade"]);
  });

  it("handles digits, 5k and mixed case", () => {
    expect(redactForCloud("Pay TUNDE 5k", contacts).text).toBe("Pay [CONTACT_1] [AMOUNT]");
    expect(redactForCloud("send 2,500 to tunde", contacts).text).toBe("send [AMOUNT] to [CONTACT_1]");
  });

  it("numbers contacts in the order they appear", () => {
    const r = redactForCloud("send Chidi Okafor 100 not Tunde", contacts);
    expect(r.text).toBe("send [CONTACT_1] [AMOUNT] not [CONTACT_2]");
    expect(r.contacts).toEqual(["Chidi Okafor", "Tunde"]);
  });

  it.each([
    ["send 5000 to Stranger", "send [AMOUNT] to [PERSON]"],
    ["Bola wants 5000", "[PERSON] wants [AMOUNT]"],
    ["How much is left", "How much is left"],
    ["abeg send 2k give Bola Ahmed", "abeg send [AMOUNT] give [PERSON]"],
    ["send 300 naira to my brother Emeka now", "send [AMOUNT] naira to my brother [PERSON] now"],
  ])("hides names that are not saved too: %s", (said, want) => {
    expect(redactForCloud(said, contacts).text).toBe(want);
  });

  it("hides part of a saved name too", () => {
    const out = redactForCloud("send chidi 5000", contacts).text;
    expect(out.toLowerCase()).not.toContain("chidi");
    expect(out).toBe("send [CONTACT_1] [AMOUNT]");
  });

  it.each([
    "send ５０００ to Tunde",
    "send 5000 naira to Mama Ade, my account is 0123456789",
    "call me on 08031234567 and send two thousand to Tunde",
    "send one hundred and fifty naira to Chidi Okafor",
  ])("never lets a digit or a saved name through: %s", (said) => {
    const out = redactForCloud(said, contacts).text;
    expect(out.replace(/\[CONTACT_\d+\]/g, "")).not.toMatch(/\p{Nd}/u);
    for (const c of contacts) expect(out.toLowerCase()).not.toContain(c.toLowerCase());
    expect(out).not.toMatch(/\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million)\b/i);
  });
});
