import { describe, expect, it } from "vitest";
import { promisesDetails, decideLivePayment, editDistance, liveInstruction, nairaToKobo, proposePaymentDeclaration, transcriptHasAmount, transcriptHasPayee } from "./livepay";

const CONTACTS = [
  { id: "c1", name: "Mama Ade" },
  { id: "c2", name: "Tunde" },
  { id: "c3", name: "Chidi Okafor" },
];
const LIMIT = "5000000"; // 50,000 naira

describe("nairaToKobo (decimal string, no floats)", () => {
  it("converts whole and decimal naira", () => {
    expect(nairaToKobo(2000)).toBe("200000");
    expect(nairaToKobo(500)).toBe("50000");
    expect(nairaToKobo(10.5)).toBe("1050");
    expect(nairaToKobo(0.07)).toBe("7");
    expect(nairaToKobo("1999.99")).toBe("199999");
  });
  it("rejects zero, negatives, 3+ decimals, NaN, exponents, junk", () => {
    for (const bad of [0, -5, 1.234, NaN, Infinity, 1e21, "abc", "", null, undefined, {}, "1e3", "0.00"]) expect(nairaToKobo(bad), String(bad)).toBeNull();
  });
});

describe("editDistance", () => {
  it("counts edits", () => {
    expect(editDistance("tundi", "tunde")).toBe(1);
    expect(editDistance("sunday", "tunde")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("transcriptHasAmount", () => {
  it("digits, words, commas", () => {
    expect(transcriptHasAmount("send 2000 naira to Tunde", "200000")).toBe(true);
    expect(transcriptHasAmount("please send two thousand naira to Tunde", "200000")).toBe(true);
    expect(transcriptHasAmount("send 2,500 naira", "250000")).toBe(true);
    expect(transcriptHasAmount("send two thousand five hundred naira", "250000")).toBe(true);
  });
  it("different, missing or conflicting amounts are not heard", () => {
    expect(transcriptHasAmount("send 3000 naira", "200000")).toBe(false);
    expect(transcriptHasAmount("send some money to Tunde", "200000")).toBe(false);
    expect(transcriptHasAmount("no 3000 not 2000", "200000")).toBe(false);
  });
});

describe("transcriptHasPayee", () => {
  it("exact name, case-insensitive, and first-name only", () => {
    expect(transcriptHasPayee("send 500 to tunde", CONTACTS[1], CONTACTS)).toBe(true);
    expect(transcriptHasPayee("pay mama 500", CONTACTS[0], CONTACTS)).toBe(true);
    expect(transcriptHasPayee("pay Chidi 500", CONTACTS[2], CONTACTS)).toBe(true);
  });
  it("misheard names that are closest to the chosen contact", () => {
    expect(transcriptHasPayee("send 500 to Tundi", CONTACTS[1], CONTACTS)).toBe(true);
    expect(transcriptHasPayee("send 500 to Sunday", CONTACTS[1], CONTACTS)).toBe(true);
    expect(transcriptHasPayee("send 500 to Chidy", CONTACTS[2], CONTACTS)).toBe(true);
  });
  it("a name that is closer to another contact is refused", () => {
    expect(transcriptHasPayee("send 500 to Tunde", CONTACTS[0], CONTACTS)).toBe(false);
    expect(transcriptHasPayee("send 500 to Mama", CONTACTS[1], CONTACTS)).toBe(false);
  });
  it("ambiguous: equally close to two contacts is refused", () => {
    const twins = [{ id: "a", name: "Tundi" }, { id: "b", name: "Tunda" }];
    expect(transcriptHasPayee("send 500 to Tunde", twins[0], twins)).toBe(false);
  });
  it("no name at all, or far-off words, is refused", () => {
    expect(transcriptHasPayee("send 500 naira please", CONTACTS[1], CONTACTS)).toBe(false);
    expect(transcriptHasPayee("send 500 to Emeka", CONTACTS[1], CONTACTS)).toBe(false);
  });
});

describe("decideLivePayment", () => {
  const ok = (args: unknown, said: string) => decideLivePayment(args, said, CONTACTS, LIMIT);
  it("valid call: builds the proposal in kobo", () => {
    expect(ok({ payee: "Tunde", amount_naira: 2000, request: "x" }, "please send two thousand naira to Tunde")).toEqual({
      ok: true,
      proposal: { amountMinor: "200000", payeeId: "c2", payeeName: "Tunde" },
    });
  });
  it("Tundi heard, Tunde chosen: accepted", () => {
    expect(ok({ payee: "Tunde", amount_naira: 500 }, "send 500 to Tundi")).toMatchObject({ ok: true, proposal: { payeeId: "c2", amountMinor: "50000" } });
  });
  it("payee not in the list: unknown_payee with the names", () => {
    expect(ok({ payee: "Sunday", amount_naira: 500 }, "send 500 to Sunday")).toEqual({ ok: false, reason: "unknown_payee", names: ["Mama Ade", "Tunde", "Chidi Okafor"] });
    expect(ok({ payee: "tunde", amount_naira: 500 }, "send 500 to tunde")).toMatchObject({ ok: false, reason: "unknown_payee" }); // exact match only
    expect(ok({ amount_naira: 500 }, "send 500")).toMatchObject({ ok: false, reason: "unknown_payee" });
  });
  it("payee not in the transcript: unknown_payee with the names", () => {
    expect(ok({ payee: "Tunde", amount_naira: 500 }, "send 500 naira to Mama Ade")).toMatchObject({ ok: false, reason: "unknown_payee", names: expect.any(Array) });
  });
  it("bad amount values: amount_not_heard", () => {
    for (const a of [0, -1, 1.234, "abc", undefined, null]) expect(ok({ payee: "Tunde", amount_naira: a }, "send 500 to Tunde"), String(a)).toMatchObject({ ok: false, reason: "amount_not_heard" });
  });
  it("amount not in the transcript: amount_not_heard", () => {
    expect(ok({ payee: "Tunde", amount_naira: 2000 }, "send some money to Tunde")).toEqual({ ok: false, reason: "amount_not_heard" });
    expect(ok({ payee: "Tunde", amount_naira: 2000 }, "send 3000 to Tunde")).toEqual({ ok: false, reason: "amount_not_heard" });
  });
  it("over the limit: over_limit", () => {
    expect(ok({ payee: "Tunde", amount_naira: 50001 }, "send 50001 to Tunde")).toEqual({ ok: false, reason: "over_limit" });
    expect(ok({ payee: "Tunde", amount_naira: 50000 }, "send 50000 to Tunde")).toMatchObject({ ok: true });
  });
  it("no transcript: not_ready", () => {
    expect(ok({ payee: "Tunde", amount_naira: 500 }, "")).toEqual({ ok: false, reason: "not_ready" });
  });
  it("args that are not an object are failed safely", () => {
    expect(ok("nope", "send 500 to Tunde")).toMatchObject({ ok: false, reason: "unknown_payee" });
    expect(ok(undefined, "send 500 to Tunde")).toMatchObject({ ok: false, reason: "unknown_payee" });
  });
});

describe("liveInstruction: greeting, read-exactly rule and language", () => {
  const en = liveInstruction(CONTACTS, {});
  it("tells the model to greet first on [app opened], with the exact wording, and shorter for a returning visit", () => {
    expect(en).toContain("[app opened]");
    expect(en).toContain("Hello, welcome to Pay Alone. What would you like to do today? You can send money, check your receipts, or ask me anything.");
    expect(en).toContain("[app opened again]");
    expect(en).toContain("Welcome back to Pay Alone. What would you like to do?");
  });
  it("tells the model to read 'Read this exactly' messages word for word and call no tool", () => {
    expect(en).toContain("Read this exactly");
    expect(en).toMatch(/word for word/i);
    expect(en).toMatch(/do not call any tool/i);
  });
  it("English stays English only", () => expect(en).toMatch(/Speak English only/));
  it("another language names the language and asks for amounts in digits", () => {
    const fr = liveInstruction(CONTACTS, {}, "fr");
    expect(fr).toMatch(/Speak French/);
    expect(fr).not.toMatch(/Speak English only/);
    expect(fr).toContain("Bonjour, bienvenue sur Pay Alone");
    expect(fr).toMatch(/amount in numbers/i);
    expect(fr).toContain("Always write the saved names exactly");
  });
});

describe("liveInstruction and tool declaration", () => {
  const pron = { Tunde: "TOON-day", "Mama Ade": "MAH-mah AH-day" };
  const t = liveInstruction(CONTACTS, pron);
  it("lists the names with pronunciations where given", () => {
    expect(t).toContain("Tunde (sounds like toon-day)");
    expect(t).toMatch(/always write the name itself/i);
    expect(t).toContain("Mama Ade (sounds like mah-mah ah-day)");
    expect(t).toContain("Chidi Okafor");
  });
  it("says naira, short, always call the tool, never claim done", () => {
    expect(t).toMatch(/naira/i);
    expect(t).toMatch(/short/i);
    expect(t).toMatch(/call propose_payment whenever/i);
    expect(t).toMatch(/do not ask for yes or no first/);
    expect(t).toMatch(/never say .*(sent|done)/i);
  });
  it("English only, never promise details without the tool, offer the closest name", () => {
    expect(t).toMatch(/English.*Nigerian accent/i);
    expect(t).toMatch(/ignore any words that are not English/i);
    expect(t).toMatch(/never say you will show .*unless you called propose_payment in the same turn/i);
    expect(t).toMatch(/Did you mean/);
  });
  it("detects the empty promise to show details", () => {
    expect(promisesDetails("Okay, I'll show you the details. Is that okay?")).toBe(true);
    expect(promisesDetails("I will show you the details now")).toBe(true);
    expect(promisesDetails("Who would you like to pay?")).toBe(false);
  });
  it("the declaration enumerates the saved names", () => {
    const d = proposePaymentDeclaration(CONTACTS);
    expect(d.name).toBe("propose_payment");
    expect(d.parameters.properties.payee.enum).toEqual(["Mama Ade", "Tunde", "Chidi Okafor"]);
    expect(d.parameters.properties.amount_naira.type).toBe("number");
    expect(d.parameters.required).toEqual(["payee", "amount_naira", "request"]);
  });
});
