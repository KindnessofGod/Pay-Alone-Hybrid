// Open conversation: the AI answers in its own words, but it can only TALK. Money stays locked down.
//
//   1. Spoken-secret tripwire on what the person said, BEFORE any model or network call.
//   2. Gemini Nano on the device (ONLY_ON_DEVICE) gets the recent history and the persona.
//      If it is unavailable, fails or times out, Gemini in the cloud (ONLY_IN_CLOUD) gets the history
//      and the sentence REDACTED (saved names, amounts and numbers hidden; redact.ts).
//   3. Whatever a model says goes through safeReply(): markdown and emojis removed, cut short, and
//      REJECTED (replaced by a fixed line) if it claims money moved, asks for or mentions a PIN or card,
//      holds a long number, states a balance or contains a link.
//   4. A rate guard stops a stuck loop from calling the cloud again and again.
// Chat text never starts a payment: payments only come from understand() + the server approval.
import { redactForCloud } from "./redact";
import { spokenSecret } from "./tripwire";
import { LONG_NUMBER, SPELLED_RUN, splitSentences, unsafeToSpeak } from "./tts";
import { decideRoute, reason as errorReason, type Policy } from "./understand";
import type { Contact } from "./crosscheck";

export interface ChatTurn {
  who: "you" | "app";
  text: string;
}
export interface ChatEngines {
  /** Plain text out. Throws if the on-device model is unavailable. */
  onDevice: (prompt: string) => Promise<string>;
  cloud: (prompt: string) => Promise<string>;
}
export interface RateGuard {
  take(): boolean;
}
export interface ChatContext {
  contacts: Contact[];
  policy: Policy;
  deviceAvailable: boolean;
  rate?: RateGuard;
}
export type ChatResult =
  | { kind: "secret_spoken" }
  | { kind: "reply"; text: string; source: "on_device" | "cloud"; guarded: boolean; sentToCloud?: string; skipped?: string[] }
  | { kind: "none"; skipped: string[] };

export const PERSONA =
  "You are Pay Alone, a warm, patient voice assistant for blind, elderly and non-reading people in Nigeria. " +
  "Speak in short, simple sentences (at most 2-3 sentences, under 50 words), one question at a time, no lists, no markdown, no emojis. " +
  "You can chat, explain how Pay Alone works, explain fees and safety, and help the person decide what to do. " +
  "You cannot see balances or history. You never send, approve or confirm money, never say a payment happened, never ask for or repeat a PIN or card number. " +
  "If the person wants to pay someone, tell them to say who and how much, for example 'send 5000 naira to Tunde'.";

export const SAFE_FALLBACK = "Sorry, I can't help with that. You can say who to pay and how much, or ask me how Pay Alone works.";
export const RECENT_TURNS = 6;
const MAX_CHARS = 300;
const MAX_SENTENCES = 3;

// ---- output guard ----

const MONEY = /\b(naira|money|payments?|transfers?|funds|cash|kobo|amount)\b|₦|\d/i;
const SENT_WORDS = /\b(sent|paid|transferred|approved)\b/i; // a model never has a reason to say these
const DONE_WORDS = /\b(done|completed?|successful(ly)?|went through|has gone|is on its way)\b/i;
const SECRET_WORD = /\b(pins?|passwords?|passcodes?|pass codes?|otp|one[- ]time (code|password)|cvv|cvc|card numbers?|card details|security code|secret code|verification code)\b/i;
const NUMBER_WORD = "(?:naira|₦|\\d|thousand|hundred|million|kobo)";
const BALANCE = [
  /\byour (account )?balance\s+(is|are|stands|of|at)\b/i,
  new RegExp(`\\bbalance\\b[^.!?]*\\b(is|are|stands|of|at)\\b[^.!?]*${NUMBER_WORD}`, "i"),
  new RegExp(`\\byou (have|got|own)\\b[^.!?]*${NUMBER_WORD}`, "i"),
  new RegExp(`\\b(left|remaining) (in|on) your\\b`, "i"),
];
const URL_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ng|org|net|io|dev|app|co|me|gov|edu)\b/i;
const SPOKEN_DIGIT_RUN = SPELLED_RUN;

/** "type your PIN on the keypad" is the one allowed mention of a PIN. */
function okPinSentence(s: string): boolean {
  const hits = s.match(new RegExp(SECRET_WORD.source, "gi")) ?? [];
  if (!hits.every((h) => /^pins?$/i.test(h))) return false;
  return /\b(type|typed|typing|enter|key in|press)\b/i.test(s) && /\b(keypad|key pad|keys|keyboard|buttons)\b/i.test(s) && !/\b(say|tell|speak|share|give|read|repeat|send|text|whatsapp|call)\b/i.test(s);
}

function unsafe(raw: string, cleaned: string): boolean {
  if (URL_RE.test(raw) || URL_RE.test(cleaned)) return true;
  const digits = cleaned.replace(/(?<=\d)[,.\s-](?=\d)/g, "");
  if (/\d{4,}/.test(digits) || LONG_NUMBER.test(cleaned) || SPOKEN_DIGIT_RUN.test(cleaned) || unsafeToSpeak(cleaned)) return true;
  if (BALANCE.some((r) => r.test(cleaned))) return true;
  for (const s of splitSentences(cleaned)) {
    if (SENT_WORDS.test(s) || (DONE_WORDS.test(s) && MONEY.test(s))) return true;
    if (SECRET_WORD.test(s) && !okPinSentence(s)) return true;
  }
  return false;
}

function clean(raw: string): string {
  const lines = raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, "")
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(#{1,6}|>|[-*•]|\d+[.)])\s+/, "").replace(/[*_`~#>]/g, "").trim())
    .filter(Boolean)
    .map((l) => (/[.!?]$/.test(l) ? l : `${l}.`));
  return lines.join(" ").replace(/\s+/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

function cut(text: string): string {
  let out = splitSentences(text).slice(0, MAX_SENTENCES).join(" ");
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS - 1);
    out = out.slice(0, Math.max(out.lastIndexOf(" "), 1)).trim();
    if (!/[.!?]$/.test(out)) out += ".";
  }
  return out;
}

/** Makes model text safe to show and speak, or replaces it with a fixed line. */
export function safeReply(raw: string): { text: string; guarded: boolean } {
  const cleaned = clean(String(raw ?? ""));
  if (!cleaned || unsafe(String(raw), cleaned)) return { text: SAFE_FALLBACK, guarded: true };
  const text = cut(cleaned);
  if (!text || unsafe(text, text)) return { text: SAFE_FALLBACK, guarded: true };
  return { text, guarded: false };
}

// ---- rate guard ----

export function createRateGuard(max: number, windowMs: number, now: () => number = Date.now): RateGuard {
  let stamps: number[] = [];
  return {
    take() {
      const t = now();
      stamps = stamps.filter((s) => t - s < windowMs);
      if (stamps.length >= max) return false;
      stamps.push(t);
      return true;
    },
  };
}
/** At most 10 online chat calls a minute. */
export const cloudChatRate: RateGuard = createRateGuard(10, 60_000);

// ---- the reply ----

/** Recent turns, minus anything that looks like a spoken secret or was deleted. */
function recent(history: ChatTurn[]): ChatTurn[] {
  return history
    .filter((t) => t.text && t.text !== "(deleted)" && !spokenSecret(t.text).tripped && !unsafeToSpeak(t.text))
    .slice(-RECENT_TURNS)
    .map((t) => ({ who: t.who, text: t.text.slice(0, MAX_CHARS) }));
}

const line = (who: ChatTurn["who"], text: string) => `${who === "you" ? "person" : "assistant"}: ${text}`;

export async function chatReply(history: ChatTurn[], said: string, ctx: ChatContext, engines: ChatEngines): Promise<ChatResult> {
  if (spokenSecret(said).tripped) return { kind: "secret_spoken" };

  const turns = recent(history);
  const skipped: string[] = [];
  let route = decideRoute(ctx.policy, ctx.deviceAvailable);
  if ((ctx.policy === "on_device_first" || ctx.policy === "on_device_only") && !ctx.deviceAvailable) skipped.push("on-device: Gemini Nano not available on this computer");
  const done = (text: string, source: "on_device" | "cloud", sentToCloud?: string): ChatResult => ({
    kind: "reply",
    source,
    ...safeReply(text),
    ...(sentToCloud !== undefined ? { sentToCloud } : {}),
    ...(skipped.length ? { skipped } : {}),
  });

  if (route === "on_device") {
    const prompt = `${PERSONA}\n\n${[...turns, { who: "you" as const, text: said }].map((t) => line(t.who, t.text)).join("\n")}\nassistant:`;
    try {
      const out = await engines.onDevice(prompt);
      if (clean(String(out ?? ""))) return done(out, "on_device");
      skipped.push("on-device: empty answer");
    } catch (e) {
      skipped.push(`on-device: ${errorReason(e, said)}`);
    }
    route = ctx.policy === "on_device_only" ? "none" : "cloud";
  }
  if (route === "cloud") {
    if (!(ctx.rate ?? cloudChatRate).take()) {
      skipped.push("online: too many online chat calls this minute");
    } else {
      const names = ctx.contacts.map((c) => c.name);
      const body = [...turns, { who: "you" as const, text: said }].map((t) => line(t.who, redactForCloud(t.text, names).text)).join("\n");
      try {
        const out = await engines.cloud(`${PERSONA}\n\n${body}\nassistant:`);
        if (clean(String(out ?? ""))) return done(out, "cloud", body);
        skipped.push("online: empty answer");
      } catch (e) {
        skipped.push(`online: ${errorReason(e, said)}`);
      }
    }
  }
  return { kind: "none", skipped };
}
