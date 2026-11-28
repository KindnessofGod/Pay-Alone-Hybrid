// Small rules for the voice-first flow, kept as plain functions so they are tested: the opening turn, which keys
// start the app, what a WebAuthn error means, the read-back in another language, and the first-run setup steps.
import { amountSpoken, stringsFor, type LangCode, type Strings } from "../hybrid/languages";
import { unsafeToSpeak } from "../hybrid/tts";
import type { Amount } from "../money";

export const APP_OPENED = "[app opened]";
export const APP_OPENED_AGAIN = "[app opened again]";
export const VISITED_KEY = "payalone_visited";

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/** First visit: "[app opened]" (long greeting). Later visits: "[app opened again]" (short). Remembers a flag only. */
export function openingTurn(s?: Store): string {
  let seen = false;
  try {
    seen = s?.getItem(VISITED_KEY) === "1";
  } catch {
    seen = false;
  }
  try {
    s?.setItem(VISITED_KEY, "1");
  } catch {
    /* not remembered: the long greeting plays again, which is harmless */
  }
  return seen ? APP_OPENED_AGAIN : APP_OPENED;
}

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab", "AltGraph", "OS"]);
/** Any key except a lone modifier (or Tab, which moves focus for screen-reader users) starts the app. */
export const startKey = (key: string): boolean => !MODIFIERS.has(key);

/**
 * navigator.credentials.get() answers NotAllowedError both when the person cancels and when the browser wants a
 * fresh key press first. The second one comes back almost at once, so a very quick NotAllowedError means "ask for a key".
 */
export function passkeyFailure(errorName: string, elapsedMs: number): "needs_gesture" | "cancelled" | "aborted" {
  if (errorName === "AbortError") return "aborted";
  if (errorName === "NotAllowedError" && elapsedMs < 400) return "needs_gesture";
  return "cancelled";
}

/** English keeps the server's own read-back. Other languages are built from the quote's amount (never the request) and the payee. */
export function readBackFor(lang: LangCode, serverReadBack: string, debit: Amount, payeeName: string): string {
  if (lang === "en" || debit.assetCode !== "NGN" || debit.assetScale !== 2) return serverReadBack;
  return stringsFor(lang).readBack({ amount: amountSpoken(debit.value, lang), name: payeeName });
}

/** Live may read this: not empty, not long, and nothing that looks like a PIN or card number (same guard as our own voice). */
export function speakableForLive(text: string): boolean {
  return text.trim().length > 0 && text.length <= 600 && !unsafeToSpeak(text);
}

const SKIP = /^(skip(ped)?( it)?|later|not now|passer|plus tard|omitir|saltar|pular|depois|تخطي|لاحقا|لاحقاً|छोड़ें|छोड़|बाद में|tsallake|daga baya|fò kọjá|fo koja|lẹ́yìn|leyin)$/i;
export const isSkip = (said: string): boolean => SKIP.test(said.normalize("NFKC").trim().replace(/[.,!?]+$/g, ""));

export type SetupStep = "pin" | "confirm" | "saving" | "passkey" | "done";
export type SetupEvent = "pin_entered" | "same" | "different" | "saved" | "weak" | "passkey_done" | "passkey_failed" | "skip";
export function setupNext(step: SetupStep, ev: SetupEvent): { step: SetupStep; say: keyof Strings | null } {
  if (step === "pin" && ev === "pin_entered") return { step: "confirm", say: "setupConfirm" };
  if (step === "confirm" && ev === "same") return { step: "saving", say: null };
  if (step === "confirm" && ev === "different") return { step: "pin", say: "setupMismatch" };
  if (step === "saving" && ev === "saved") return { step: "passkey", say: "setupPasskey" };
  if (step === "saving" && ev === "weak") return { step: "pin", say: "setupMismatch" };
  if (step === "passkey" && ev === "passkey_done") return { step: "done", say: "setupDone" };
  if (step === "passkey" && (ev === "skip" || ev === "passkey_failed")) return { step: "done", say: "setupSkipped" };
  return { step, say: null };
}
