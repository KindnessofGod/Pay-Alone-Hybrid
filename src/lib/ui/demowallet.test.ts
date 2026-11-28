import { describe, expect, it } from "vitest";
import { customerWalletLines, shopWalletLines } from "./demowallet";

const ngn = (value: string, count: number) => ({ assetCode: "NGN", assetScale: 2, value, count });

const cap = { value: "5000", assetCode: "USD", assetScale: 2 };
describe("shop wallet lines", () => {
  it("counts payments, singular and plural", () => {
    expect(shopWalletLines([ngn("200000", 1)], null, false).received).toBe("Received on this page: ₦2,000.00 (1 payment)");
    expect(shopWalletLines([ngn("350000", 2)], null, false).received).toBe("Received on this page: ₦3,500.00 (2 payments)");
  });
  it("with nothing paid, says nothing yet instead of showing a balance", () => {
    expect(shopWalletLines([], null, false).received).toBe("Received on this page: nothing yet (0 payments)");
  });
  it("shows the test wallet address, or says plainly there is none", () => {
    expect(shopWalletLines([], "https://ilp.interledger-test.dev/shop", false).address).toBe("Test shop wallet: https://ilp.interledger-test.dev/shop");
    expect(shopWalletLines([], null, true).address).toMatch(/simulated/i);
  });
  it("has a big figure for the card", () => {
    expect(shopWalletLines([ngn("200000", 1)], null, false).big).toBe("₦2,000.00 received");
    expect(shopWalletLines([], null, false).big).toBe("Nothing received yet");
    expect(customerWalletLines([ngn("200000", 1)], cap, null, false).big).toBe("₦2,000.00 sent this week");
    expect(customerWalletLines([], cap, null, false).big).toBe("Nothing sent yet");
  });
  it("never says balance", () => {
    expect(JSON.stringify(shopWalletLines([ngn("1", 1)], "x", false))).not.toMatch(/balance/i);
  });
});

describe("customer wallet lines", () => {
  it("same currency as the limit: $X of $50 limit", () => {
    expect(customerWalletLines([{ assetCode: "USD", assetScale: 2, value: "150", count: 1 }], cap, null, false).sent).toBe("Sent this week: $1.50 of $50.00 limit");
  });
  it("another currency: shows what was sent and the limit separately, never mixing them", () => {
    const l = customerWalletLines([ngn("200000", 1)], cap, null, false);
    expect(l.sent).toBe("Sent this week: ₦2,000.00");
    expect(l.limit).toBe("Weekly limit on the wallet: $50.00");
  });
  it("nothing sent yet", () => {
    const l = customerWalletLines([], cap, null, false);
    expect(l.sent).toBe("Sent this week: nothing yet");
    expect(l.limit).toBe("Weekly limit on the wallet: $50.00");
  });
  it("labels the address and the simulated case", () => {
    expect(customerWalletLines([], cap, "https://ilp.interledger-test.dev/payer", false).address).toBe("Test customer wallet: https://ilp.interledger-test.dev/payer");
    expect(customerWalletLines([], cap, null, true).address).toMatch(/simulated/i);
  });
});
