import { describe, expect, it } from "vitest";
import { bigAmount, isAmountView } from "./amountview";

describe("bigAmount", () => {
  it("uses the naira sign for NGN", () => {
    expect(bigAmount({ value: "50000", assetCode: "NGN", assetScale: 2 })).toBe("₦500.00");
  });
  it("uses $ for USD and groups thousands", () => {
    expect(bigAmount({ value: "148", assetCode: "USD", assetScale: 2 })).toBe("$1.48");
    expect(bigAmount({ value: "123456789", assetCode: "USD", assetScale: 2 })).toBe("$1,234,567.89");
  });
  it("falls back to the code for other currencies", () => {
    expect(bigAmount({ value: "1000", assetCode: "KES", assetScale: 2 })).toBe("KES 10.00");
  });
  it("handles scale 0 and large scales without floats", () => {
    expect(bigAmount({ value: "5", assetCode: "NGN", assetScale: 0 })).toBe("₦5");
    expect(bigAmount({ value: "1", assetCode: "USD", assetScale: 9 })).toBe("$0.000000001");
  });
});

describe("isAmountView", () => {
  it("accepts a real amount and rejects anything else", () => {
    expect(isAmountView({ value: "1", assetCode: "USD", assetScale: 2 })).toBe(true);
    expect(isAmountView({ value: 1, assetCode: "USD", assetScale: 2 })).toBe(false);
    expect(isAmountView(undefined)).toBe(false);
  });
});
