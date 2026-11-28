import { describe, expect, it } from "vitest";
import { unsafeToSpeak } from "../hybrid/tts";
import { answerToRequest, formatPayCode, payCodeSpeech, requestPrompt, requestReceiptLine, shopStatusView } from "./requestprompt";

const amt = { value: "200000", assetCode: "NGN", assetScale: 2 };

describe("what the app says when a shop asks", () => {
  it("is our own template, with the amount in words and the reference", () => {
    expect(requestPrompt("Mama Put", amt, "31")).toBe("Mama Put is asking for 2,000 naira, reference 31. Say yes to check it, or no to decline.");
  });
  it("amounts come from the request as integer minor units, kobo included", () => {
    expect(requestPrompt("Shop", { value: "150050", assetCode: "NGN", assetScale: 2 }, "10")).toContain("1,500 naira and 50 kobo");
  });
});

describe("yes or no to a request (negation-safe)", () => {
  it.each([
    ["yes", "check"],
    ["yeah", "check"],
    ["go ahead", "check"],
    ["no", "decline"],
    ["No, don't send it", "decline"],
    ["do not pay", "decline"],
    ["decline", "decline"],
    ["yes but no", "decline"],
    ["maybe later", "unclear"],
    ["", "unclear"],
  ])("%s -> %s", (said, want) => {
    expect(answerToRequest(said)).toBe(want);
  });
  it("a spoken PIN or code is never an answer", () => {
    expect(answerToRequest("yes my pin is 4 8 2 6")).toBe("secret");
  });
});

describe("pay code on screen and in speech", () => {
  it("shows pairs", () => {
    expect(formatPayCode("472913")).toBe("47 29 13");
  });
  it("speaks pairs and says it is not the PIN", () => {
    expect(payCodeSpeech("472913")).toBe("Your pay code is 47 29 13. It is a pay code, not your PIN. A shop uses it to ask you for a payment.");
  });
  it("the spoken-PIN guard in the voice never swallows the pay code sentence", () => {
    for (let n = 100_000; n < 1_000_000; n += 997) expect(unsafeToSpeak(payCodeSpeech(String(n)))).toBe(false);
    for (const c of ["101010", "111111", "123456", "000000", "909090", "100000"]) expect(unsafeToSpeak(payCodeSpeech(c))).toBe(false);
  });
});

describe("shop page status", () => {
  it("waiting, paid, declined and expired each have words, never colour alone", () => {
    expect(shopStatusView("pending", "31", amt)).toMatchObject({ tone: "wait", headline: "Waiting for the customer…", sub: "₦2,000.00 · Reference 31" });
    const paid = shopStatusView("paid", "31", amt);
    expect(paid).toMatchObject({ tone: "good", headline: "PAID ₦2,000.00" });
    expect(paid.speech).toBe("Payment received, 2,000 naira, reference 31");
    expect(shopStatusView("declined", "31", amt)).toMatchObject({ tone: "bad", headline: "Declined" });
    expect(shopStatusView("expired", "31", amt)).toMatchObject({ tone: "bad", headline: "Expired" });
    expect(shopStatusView("pending", "31", amt).speech).toBeUndefined();
  });
});

describe("receipt line", () => {
  it("says who was paid and the reference", () => {
    expect(requestReceiptLine("Mama Put", "31")).toBe("Paid Mama Put, reference 31");
  });
});
