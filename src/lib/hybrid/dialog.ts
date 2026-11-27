// The conversation, as a pure state machine. Given what the person said (already understood by
// understand.ts) it decides what to say next and whether to listen again, hand over to approval, or stop.
//
// Safety, by construction:
//  - Every spoken line is a fixed template here. The only variable parts are names from our own
//    contacts list (validated). The person's own words are never spoken back; amounts are never spoken
//    here at all (the read-back with the amount comes from the server quote).
//  - This code never approves or pays. "approve" only hands { payeeId, amountMinor } to the approval
//    card, where the server quotes, reads back and checks the PIN.
//  - A negation anywhere ("no, don't send it") cancels, using the same negation-safe yesNo().
import { amountFromSpeech, numberWordsToDigits } from "../money";
import { yesNo } from "./confirm";
import { validContactName } from "./contacts";
import type { Contact } from "./crosscheck";
import type { Understood } from "./understand";

export type Asked = "none" | "payee" | "amount" | "more";

export interface DialogState {
  payeeId?: string;
  amountMinor?: string;
  asked: Asked;
  /** Turns in a row that were not understood. */
  misses: number;
  /** Turns in a row where nothing was heard. */
  silent: number;
}

export interface DialogContext {
  contacts: Contact[];
  /** What the person said. Used only to read names and amounts; never spoken back. */
  said: string;
  limitMinor: string;
}

export interface DialogOut {
  state: DialogState;
  say: string;
  then: "listen" | "approve" | "idle";
  approve?: { payeeId: string; amountMinor: string };
}

export const initialDialog = (): DialogState => ({ asked: "none", misses: 0, silent: 0 });

const STOP_SECRET = "Stop. Never say your PIN or card number out loud. I have deleted what you said.";
const CANCELLED = "Okay, cancelled. Nothing was sent.";
const GOODBYE = "Okay. Goodbye.";
const SOON = "That part is coming soon. Is there anything else I can do for you?";
const GREETING = "Hello! I can send money for you. Who would you like to pay, and how much?";
const TYPING = "I am having trouble understanding. Please type what you want in the box, or press the button and try again.";

// Same wording as the screen's rejection messages.
export const REASONS: Record<string, string> = {
  unknown_payee: "I don't know that person. I can only send to people saved in your list.",
  payee_not_said: "Please say the full name of the person.",
  no_amount: "Please say how much to send.",
  amount_mismatch: "I heard two different amounts, so I stopped. Please say it again.",
  over_limit: "That is more than your spending limit.",
};

// ---- reading names and amounts (plain rules) ----

/** A bare amount: digits or simple English number words up to millions; naira, whole or kobo. Null if none or ambiguous. */
export function parseBareAmount(said: string): string | null {
  const t = said.normalize("NFKC").toLowerCase();
  if (/\$|dollar|usd|cent\b|cents\b/.test(t)) return null; // naira only
  const digitRuns = new Set(
    (numberWordsToDigits(t).replace(/,/g, "").match(/\d+(\.\d+)?/g) ?? []).map((n) => Number(n)),
  );
  if (digitRuns.size !== 1) return null; // none, or two different numbers ("5000 or 6000")
  const r = amountFromSpeech(t, "NGN", 2);
  if (!r || !/^\d+$/.test(r.minor) || BigInt(r.minor) <= BigInt(0)) return null;
  return r.minor;
}

const tokens = (s: string) => s.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{M}]+/u).filter((w) => w.length >= 3);

/** One saved contact the person named, by full or partial name ("mama"). Null if none or more than one. */
export function matchPayee(said: string, contacts: Contact[]): Contact | null {
  const said3 = new Set(tokens(said));
  const hits = contacts.filter((c) => tokens(c.name).some((w) => said3.has(w)));
  return hits.length === 1 ? hits[0] : null;
}

// ---- lines ----

const nameList = (cs: Contact[]) => {
  const n = cs.map((c) => c.name);
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} or ${n[n.length - 1]}`;
};
const askPayee = (cs: Contact[]) => `Who would you like to pay? You can say ${nameList(cs)}.`;
const askAmount = (name: string) => `How much would you like to send to ${name}?`;

function question(s: DialogState, cs: Contact[]): { say: string; asked: Asked } {
  const payee = cs.find((c) => c.id === s.payeeId);
  if (payee && !s.amountMinor) return { say: askAmount(payee.name), asked: "amount" };
  if (s.amountMinor && !payee) return { say: askPayee(cs), asked: "payee" };
  return { say: "Who would you like to pay, and how much?", asked: "none" };
}

const HELP = (cs: Contact[]) =>
  `I can send money to people in your list. Say who to pay and how much, for example, send five thousand naira to ${cs[0]?.name ?? "someone"}. I will read it back, and you approve it with your PIN, typed on the keys. You can say cancel at any time. Who would you like to pay?`;

const NOT_UNDERSTOOD = (cs: Contact[], n: number) =>
  n === 1
    ? `Sorry, I didn't catch that. You can say, for example, send five thousand naira to ${cs[0]?.name ?? "someone"}.`
    : `Let's try once more. Say who to pay and how much, like, pay ${cs[1]?.name ?? cs[0]?.name ?? "someone"} two thousand naira.`;

const CANCEL_WORDS = /\b(cancel|stop|never ?mind|forget it)\b/i;
const HELP_WORDS = /\b(help|what can you do|how does this work|what do i say)\b/i;
const GREETING_RE = /^\s*(hello|hi|hey|howdy|good (morning|afternoon|evening))( there| pay alone)?[\s.,!?]*$/i;
const NAME_PHRASE = /\b(?:to|for)\s+(\p{L}{2,})/iu;

function clear(s: DialogState): DialogState {
  return { ...s, payeeId: undefined, amountMinor: undefined, asked: "none" };
}

export function next(state: DialogState, u: Understood, input: DialogContext): DialogOut {
  const contacts = input.contacts.filter((c) => validContactName(c.name));
  const said = input.said;
  const s: DialogState = { ...state, silent: 0 };
  const out = (st: DialogState, say: string, then: DialogOut["then"], approve?: DialogOut["approve"]): DialogOut => ({ state: st, say, then, ...(approve ? { approve } : {}) });
  const fresh = (): DialogState => ({ ...clear(s), misses: 0 });

  if (u.kind === "secret_spoken") return out(fresh(), STOP_SECRET, "listen");

  const answer = yesNo(said);
  if (s.asked === "more") {
    if (answer === "no") return out(fresh(), GOODBYE, "idle");
    if (answer === "yes") return out(fresh(), "Okay. Who would you like to pay, and how much?", "listen");
  }
  const pending = Boolean(s.payeeId || s.amountMinor);
  if (CANCEL_WORDS.test(said) || (u.kind === "intent" && u.action === "cancel")) return out(fresh(), CANCELLED, "idle");
  if (HELP_WORDS.test(said) || (u.kind === "intent" && u.action === "help")) return out({ ...s, misses: 0 }, HELP(contacts), "listen");
  if (!pending && u.kind === "unclear" && GREETING_RE.test(said)) return out({ ...s, asked: "none", misses: 0 }, GREETING, "listen");
  if (answer === "no") return out(fresh(), CANCELLED, "idle");

  if (u.kind === "proposal") return out(fresh(), "", "approve", { payeeId: u.proposal.payeeId, amountMinor: u.proposal.amountMinor });

  if (u.kind === "intent") {
    if (u.action === "balance" || u.action === "history") return out({ ...s, asked: "more", misses: 0 }, SOON, "listen");
    if (u.action === "repeat") {
      const q = question(s, contacts);
      return out({ ...s, asked: q.asked }, q.say, "listen");
    }
  }

  // Slot filling: read a saved name and an amount out of this answer, with plain rules, and combine them
  // with what was already given. A name or amount the person gave earlier is kept.
  const reason = u.kind === "rejected" ? u.reason : null;
  const dPayee = matchPayee(said, contacts);
  const dAmount = reason === "amount_mismatch" ? null : parseBareAmount(said);
  const payeeId = dPayee?.id ?? s.payeeId;
  let amountMinor = dAmount ?? s.amountMinor;
  if (reason === "amount_mismatch" || reason === "over_limit") amountMinor = undefined;
  const unknownName = reason === "unknown_payee" && !dPayee && (() => {
    const w = said.match(NAME_PHRASE)?.[1];
    return Boolean(w) && numberWordsToDigits(w as string) === w;
  })();

  const learned = Boolean(dPayee) || dAmount !== null;
  const base: DialogState = { ...s, payeeId, amountMinor, misses: 0 };
  const tooBig = amountMinor !== undefined && BigInt(amountMinor) > BigInt(input.limitMinor);

  if (tooBig || reason === "over_limit" || reason === "amount_mismatch") {
    const st = { ...base, amountMinor: undefined };
    const q = question(st, contacts);
    return out({ ...st, asked: q.asked }, `${tooBig || reason === "over_limit" ? REASONS.over_limit : REASONS.amount_mismatch} ${q.say}`, "listen");
  }
  if (payeeId && amountMinor) return out(fresh(), "", "approve", { payeeId, amountMinor });

  if (learned || unknownName) {
    const q = question(base, contacts);
    const lead = unknownName ? `${REASONS.unknown_payee} ` : "";
    return out({ ...base, asked: q.asked }, `${lead}${q.say}`, "listen");
  }

  // Not understood.
  const misses = s.misses + 1;
  if (misses >= 3) return out({ ...s, misses: 0 }, TYPING, "idle");
  const q = question(s, contacts);
  const open = s.payeeId || s.amountMinor || s.asked === "payee" || s.asked === "amount";
  const say = open ? `${misses === 1 ? "Sorry, I didn't catch that." : "I still didn't get that."} ${q.say}` : NOT_UNDERSTOOD(contacts, misses);
  return out({ ...s, misses, asked: open ? q.asked : "none" }, say, "listen");
}

/** Nothing was heard. The first time, ask again; the second time, wait for the button. */
export function silence(state: DialogState): DialogOut {
  const silent = state.silent + 1;
  if (silent >= 2) return { state: { ...state, silent: 0 }, say: "I'll wait. Press the button when you're ready.", then: "idle" };
  return { state: { ...state, silent }, say: "I didn't hear anything. Please say it again, or type it in the box.", then: "listen" };
}

/** The approval card closed: after a receipt, or after a cancel or a stop. */
export function afterPayment(state: DialogState, outcome: "paid" | "stopped"): DialogOut {
  return {
    state: { ...clear(state), asked: "more", misses: 0, silent: 0 },
    say: outcome === "paid" ? "Done. Is there anything else?" : "Okay. Is there anything else?",
    then: "listen",
  };
}
