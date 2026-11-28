import { describe, expect, it } from "vitest";
import { APP_OPENED, APP_OPENED_AGAIN, isSkip, openingTurn, passkeyFailure, readBackFor, setupNext, speakableForLive, startKey } from "./voiceflow";

const store = (init: Record<string, string> = {}) => {
  const m = { ...init };
  return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => void (m[k] = v), m };
};

describe("openingTurn (what we tell the model when the app opens)", () => {
  it("first visit sends [app opened] and remembers the visit", () => {
    const s = store();
    expect(openingTurn(s)).toBe(APP_OPENED);
    expect(Object.keys(s.m)).toHaveLength(1);
    expect(openingTurn(s)).toBe(APP_OPENED_AGAIN);
  });
  it("a visit counts only as a flag, no personal data", () => {
    const s = store();
    openingTurn(s);
    expect(Object.values(s.m)).toEqual(["1"]);
  });
  it("storage that throws behaves like a first visit", () => {
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(openingTurn(bad)).toBe(APP_OPENED);
    expect(openingTurn(undefined)).toBe(APP_OPENED);
  });
});

describe("startKey (any key or tap starts it)", () => {
  it("modifier-only keys do not start it, every other key does", () => {
    for (const k of ["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"]) expect(startKey(k)).toBe(false);
    for (const k of ["a", "Enter", " ", "Escape", "ArrowDown", "1"]) expect(startKey(k)).toBe(true);
  });
});

describe("passkeyFailure (WebAuthn error to what we do next)", () => {
  it("NotAllowedError within a fraction of a second means the browser wanted a key press first", () => {
    expect(passkeyFailure("NotAllowedError", 40)).toBe("needs_gesture");
  });
  it("NotAllowedError after the person had time is a cancel", () => {
    expect(passkeyFailure("NotAllowedError", 4000)).toBe("cancelled");
  });
  it("other errors, and no sensor, mean fall back to the PIN", () => {
    expect(passkeyFailure("InvalidStateError", 10)).toBe("cancelled");
    expect(passkeyFailure("NotSupportedError", 10)).toBe("cancelled");
    expect(passkeyFailure("AbortError", 10)).toBe("aborted");
  });
});

describe("readBackFor", () => {
  const debit = { value: "300000", assetCode: "NGN", assetScale: 2 };
  it("English uses the server's own read-back word for word", () => {
    expect(readBackFor("en", "You are paying Tunde 3,000 naira.", debit, "Tunde")).toBe("You are paying Tunde 3,000 naira.");
  });
  it("other languages are built from the quote's amount and the payee name", () => {
    const t = readBackFor("fr", "ignored", debit, "Tunde");
    expect(t).toContain("Tunde");
    expect(t.replace(/\s/g, "")).toContain("3000");
    expect(t).not.toContain("ignored");
  });
  it("a non-naira quote falls back to the server's text", () => {
    expect(readBackFor("fr", "Server text", { value: "100", assetCode: "USD", assetScale: 2 }, "Tunde")).toBe("Server text");
  });
});

describe("speakableForLive", () => {
  it("not for empty text, a PIN-like run of digits, or very long text", () => {
    expect(speakableForLive("")).toBe(false);
    expect(speakableForLive("Your PIN is 4 8 2 6")).toBe(false);
    expect(speakableForLive("x".repeat(900))).toBe(false);
  });
  it("yes for our normal sentences", () => {
    expect(speakableForLive("You are paying Tunde 5,000 naira. Fees are included.")).toBe(true);
    expect(speakableForLive("Type your 4 digit PIN on the keypad, then press Enter. I will not listen while you type.")).toBe(true);
  });
});

describe("isSkip", () => {
  it("hears skip in several languages and not other words", () => {
    for (const w of ["skip", "Skip it", "later", "passer", "omitir", "pular", "تخطي", "छोड़ें", "tsallake", "fò kọjá"]) expect(isSkip(w), w).toBe(true);
    for (const w of ["yes", "add it", "", "my skiptrace"]) expect(isSkip(w), w).toBe(false);
  });
});

describe("setupNext (first-run setup steps)", () => {
  it("walks pin, confirm, passkey, done", () => {
    let s = setupNext("pin", "pin_entered");
    expect(s).toEqual({ step: "confirm", say: "setupConfirm" });
    s = setupNext("confirm", "same");
    expect(s).toEqual({ step: "saving", say: null });
    s = setupNext("saving", "saved");
    expect(s).toEqual({ step: "passkey", say: "setupPasskey" });
    s = setupNext("passkey", "passkey_done");
    expect(s).toEqual({ step: "done", say: "setupDone" });
  });
  it("a different second PIN starts again", () => {
    expect(setupNext("confirm", "different")).toEqual({ step: "pin", say: "setupMismatch" });
  });
  it("a weak PIN starts again", () => {
    expect(setupNext("saving", "weak")).toEqual({ step: "pin", say: "setupMismatch" });
  });
  it("skipping the fingerprint still finishes", () => {
    expect(setupNext("passkey", "skip")).toEqual({ step: "done", say: "setupSkipped" });
    expect(setupNext("passkey", "passkey_failed")).toEqual({ step: "done", say: "setupSkipped" });
  });
  it("nonsense events change nothing", () => {
    expect(setupNext("done", "pin_entered")).toEqual({ step: "done", say: null });
  });
});
