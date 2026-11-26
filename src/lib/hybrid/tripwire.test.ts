import { describe, expect, it } from "vitest";
import { spokenSecret } from "./tripwire";

describe("spoken-PIN tripwire (runs before any AI or network call)", () => {
  it.each([
    "my pin is 1234",
    "My PIN is one two three four",
    "the pin na 4 5 6 7",
    "password 908172",
    "my code is 2 2 4 4",
    "otp is 556677",
    "cvv 123",
    "pin: zero nine eight seven",
    "my pin is twelve thirty four",
    "pay Ada one two three four",
    "my pin is ４５６７",
  ])("trips on a spoken secret: %s", (said) => {
    expect(spokenSecret(said).tripped).toBe(true);
  });

  it("trips on a card number said out loud, even with no keyword", () => {
    expect(spokenSecret("5399 8312 3456 7890").tripped).toBe(true);
    expect(spokenSecret("four five three nine eight three one two three four five six seven eight nine zero").tripped).toBe(true);
  });

  it("trips on four or more single digits said one by one with no money word", () => {
    expect(spokenSecret("one two three four").tripped).toBe(true);
  });

  it.each([
    "send 5000 naira to Mama Ade",
    "send five thousand naira to Mama Ade",
    "pay Tunde 1234 naira",
    "abeg send 2k give Chidi",
    "how much is left",
    "what is my pin for", // a question about PINs, no digits
    "send one thousand two hundred naira to Ade",
    "Send 2500 naira to Ada, it's for the code class",
    "send 5k to Ada for the pin badge",
  ])("does not trip on a normal request: %s", (said) => {
    expect(spokenSecret(said).tripped).toBe(false);
  });

  it("says which kind of secret it was, so the app can warn in plain words", () => {
    expect(spokenSecret("my pin is 1234").kind).toBe("pin");
    expect(spokenSecret("5399 8312 3456 7890").kind).toBe("card");
  });
});
