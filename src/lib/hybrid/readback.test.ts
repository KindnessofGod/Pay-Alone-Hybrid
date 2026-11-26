import { describe, expect, it } from "vitest";
import { quoteReadBack, readBack } from "./readback";

describe("read-back is a fixed template, never model text", () => {
  it("says the amount and the saved contact name", () => {
    expect(readBack({ amountMinor: "500000", payeeId: "c1", payeeName: "Mama Ade" })).toBe(
      "You want to send 5,000 naira to Mama Ade. To approve, use your fingerprint or type your PIN. Say no to cancel.",
    );
  });

  it("keeps kobo and never claims money has moved", () => {
    const t = readBack({ amountMinor: "12345", payeeId: "c2", payeeName: "Tunde" });
    expect(t).toContain("123 naira and 45 kobo");
    expect(t).not.toMatch(/has been|was sent|paid|done|complete|success/i);
  });
});

describe("read-back from the quote", () => {
  it("speaks what the quote will take from the payer, in the quote's currency", () => {
    const t = quoteReadBack("Mama Ade", { value: "520000", assetCode: "NGN", assetScale: 2 });
    expect(t).toBe("You want to send money to Mama Ade. It will take 5,200 naira from your wallet, fees included. To approve, use your fingerprint or type your PIN. Say no to cancel.");
  });
  it("never claims money has moved", () => {
    expect(quoteReadBack("Tunde", { value: "1000", assetCode: "USD", assetScale: 2 })).not.toMatch(/has been|was sent|paid|done|complete|success/i);
  });
});
