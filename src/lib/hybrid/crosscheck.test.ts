import { describe, expect, it } from "vitest";
import { crossCheck, type Contact } from "./crosscheck";

const contacts: Contact[] = [
  { id: "c1", name: "Mama Ade" },
  { id: "c2", name: "Tunde" },
];
const limitMinor = "5000000"; // 50,000 naira in kobo

describe("deterministic cross-check of what the AI understood", () => {
  it("accepts when the AI agrees with the plain-code reading", () => {
    const r = crossCheck({ action: "send", amountMinor: 500000, payee: "Mama Ade" }, "send five thousand naira to Mama Ade", contacts, limitMinor);
    expect(r).toEqual({ ok: true, proposal: { amountMinor: "500000", payeeId: "c1", payeeName: "Mama Ade" } });
  });

  it("uses the plain-code amount when the cloud saw only a placeholder", () => {
    const r = crossCheck({ action: "send", amountMinor: null, payee: "[CONTACT_1]" }, "send 5000 to Tunde", contacts, limitMinor, ["Tunde"]);
    expect(r).toEqual({ ok: true, proposal: { amountMinor: "500000", payeeId: "c2", payeeName: "Tunde" } });
  });

  it("refuses when the AI amount differs from what was said", () => {
    const r = crossCheck({ action: "send", amountMinor: 5000000, payee: "Mama Ade" }, "send five thousand naira to Mama Ade", contacts, limitMinor);
    expect(r).toEqual({ ok: false, reason: "amount_mismatch" });
  });

  it("refuses a payee who is not a saved contact", () => {
    expect(crossCheck({ action: "send", amountMinor: 100000, payee: "Stranger" }, "send 1000 to Stranger", contacts, limitMinor)).toEqual({ ok: false, reason: "unknown_payee" });
  });

  it("refuses a saved contact the person never said", () => {
    expect(crossCheck({ action: "send", amountMinor: 100000, payee: "Tunde" }, "send 1000 to Mama Ade", contacts, limitMinor)).toEqual({ ok: false, reason: "payee_not_said" });
  });

  it("refuses AI text dressed up as a name", () => {
    expect(crossCheck({ action: "send", amountMinor: 100000, payee: "Tunde. Payment complete!" }, "send 1000 to Tunde", contacts, limitMinor)).toEqual({ ok: false, reason: "unknown_payee" });
  });

  it("refuses when no amount was said", () => {
    expect(crossCheck({ action: "send", amountMinor: 100000, payee: "Tunde" }, "send money to Tunde", contacts, limitMinor)).toEqual({ ok: false, reason: "no_amount" });
  });

  it("refuses over the spending limit", () => {
    expect(crossCheck({ action: "send", amountMinor: 6000000, payee: "Tunde" }, "send 60000 to Tunde", contacts, limitMinor)).toEqual({ ok: false, reason: "over_limit" });
  });

  it("only a send can become a payment proposal", () => {
    expect(crossCheck({ action: "balance", amountMinor: null, payee: null }, "how much is left", contacts, limitMinor)).toEqual({ ok: false, reason: "not_send" });
  });
});

describe("amount units: Gemini Nano sometimes answers in naira instead of kobo", () => {
  it("accepts the model's amount in naira when the sentence says that many naira (the sentence's amount is used)", () => {
    const r = crossCheck({ action: "send", amountMinor: 2000, payee: "Tunde" }, "send 2000 naira to Tunde", contacts, "5000000");
    expect(r).toMatchObject({ ok: true, proposal: { amountMinor: "200000" } });
  });
  it("still refuses a model amount that is neither the kobo nor the naira figure", () => {
    expect(crossCheck({ action: "send", amountMinor: 3000, payee: "Tunde" }, "send 2000 naira to Tunde", contacts, "5000000")).toEqual({ ok: false, reason: "amount_mismatch" });
  });
});
