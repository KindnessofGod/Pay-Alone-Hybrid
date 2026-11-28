import { describe, expect, it } from "vitest";
import { amountSpoken, DEFAULT_LANG, LANGS, langByCode, LANG_STORAGE_KEY, readLang, STRINGS, type LangCode, writeLang } from "./languages";

const codes = LANGS.map((l) => l.code);
const store = (init: Record<string, string> = {}) => {
  const m = { ...init };
  return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => void (m[k] = v), m };
};

describe("language list", () => {
  it("English is the default and first", () => {
    expect(DEFAULT_LANG).toBe("en");
    expect(codes[0]).toBe("en");
  });
  it("offers the required languages", () => {
    for (const c of ["en", "fr", "es", "pt", "ar", "hi"]) expect(codes).toContain(c);
  });
  it("every language has a label, an English name, a BCP-47 code and a locale", () => {
    for (const l of LANGS) {
      expect(l.label.length).toBeGreaterThan(1);
      expect(l.name.length).toBeGreaterThan(1);
      expect(l.bcp47).toMatch(/^[a-z]{2,3}(-[A-Z]{2})?$/);
      expect(l.locale.length).toBeGreaterThan(1);
    }
  });
  it("codes are unique", () => expect(new Set(codes).size).toBe(codes.length));
});

describe("every template exists for every language", () => {
  const en = STRINGS.en;
  const keys = Object.keys(en) as (keyof typeof en)[];
  for (const code of ["en", "fr", "es", "pt", "ar", "hi", "yo", "ha"] as LangCode[])
    it(`${code}`, () => {
      const t = STRINGS[code];
      expect(t, `table for ${code}`).toBeTruthy();
      expect(Object.keys(t).sort()).toEqual(Object.keys(en).sort());
      for (const k of keys) expect(typeof t[k], `${code}.${String(k)}`).toBe(typeof en[k]);
    });
  it("each offered language has a table", () => {
    for (const c of codes) expect(STRINGS[c]).toBeTruthy();
  });
  it("text templates are not empty and function templates use their inputs", () => {
    for (const c of codes) {
      const t = STRINGS[c];
      for (const k of keys) {
        const v = t[k] as unknown;
        if (typeof v === "string") expect(v.trim().length, `${c}.${String(k)}`).toBeGreaterThan(5);
      }
      const rb = t.readBack({ amount: "AMT", name: "NAME" });
      expect(rb).toContain("AMT");
      expect(rb).toContain("NAME");
      const rc = t.receipt({ amount: "AMT", name: "NAME" });
      expect(rc).toContain("AMT");
      expect(rc).toContain("NAME");
      const rq = t.requestPrompt({ shop: "SHOP", amount: "AMT", ref: "REF" });
      for (const x of ["SHOP", "AMT", "REF"]) expect(rq).toContain(x);
      for (const n of [0, 1, 2, 3, 4, 5, 6]) expect(t.digits(n).length).toBeGreaterThan(0);
    }
  });
  it("digits(n) says the count in digits", () => {
    expect(STRINGS.en.digits(2)).toBe("2 digits");
    expect(STRINGS.en.digits(1)).toBe("1 digit");
  });
});

describe("English templates keep the wording the product promises", () => {
  it("greetings and approval prompts", () => {
    expect(STRINGS.en.greetFirst).toBe("Hello, welcome to Pay Alone. What would you like to do today? You can send money, check your receipts, or ask me anything.");
    expect(STRINGS.en.approveFingerprint).toBe("To approve, use your fingerprint or Windows Hello now. Or say cancel.");
    expect(STRINGS.en.pressKeyFingerprint).toBe("Press any key to approve with your fingerprint.");
    expect(STRINGS.en.typePin).toBe("Type your 4 digit PIN on the keypad, then press Enter. I will not listen while you type.");
  });
});

describe("amountSpoken (integer minor units, no floats)", () => {
  it("English", () => {
    expect(amountSpoken("300000", "en")).toBe("3,000 naira");
    expect(amountSpoken("100", "en")).toBe("1 naira");
    expect(amountSpoken("150", "en")).toBe("1.50 naira");
    expect(amountSpoken("502000", "en")).toBe("5,020 naira");
  });
  it("French groups with its own separator and keeps digits", () => {
    const s = amountSpoken("300000", "fr");
    expect(s.replace(/\s/g, "")).toContain("3000");
    expect(s).toContain("naira");
  });
  it("Arabic uses Latin digits so our matcher can compare", () => {
    expect(amountSpoken("300000", "ar")).toMatch(/3[,٬.\s]?000/);
  });
  it("very large and zero-kobo values stay exact", () => {
    expect(amountSpoken("123456789012300", "en")).toBe("1,234,567,890,123 naira");
  });
});

describe("remembering the language", () => {
  it("defaults to English and ignores junk", () => {
    expect(readLang(store())).toBe("en");
    expect(readLang(store({ [LANG_STORAGE_KEY]: "klingon" }))).toBe("en");
    expect(readLang(undefined)).toBe("en");
  });
  it("round-trips", () => {
    const s = store();
    writeLang(s, "fr");
    expect(readLang(s)).toBe("fr");
  });
  it("storage that throws does not break", () => {
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(readLang(bad)).toBe("en");
    expect(() => writeLang(bad, "fr")).not.toThrow();
  });
  it("langByCode falls back to English", () => expect(langByCode("zz").code).toBe("en"));
});
