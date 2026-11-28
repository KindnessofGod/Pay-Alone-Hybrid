// Honest numbers for the customer home screen. Open Payments has no balance endpoint, so "left to spend this week"
// is the wallet grant's limit minus this account's own finished payments (our server receipts) in the current period.
// Integer minor units only; no floats; the wallet's own currency, never converted.
import { sameAsset, speakPlain, type Amount } from "../money";

export interface SummaryReceipt {
  id: string;
  payeeName: string;
  debit: Amount;
  simulated: boolean;
  createdAt: string;
  method?: "pin" | "passkey";
  ref?: string;
}

/** What the server knows about the connected wallet: the weekly limit from the grant and its repeat interval. */
export interface WalletView {
  connected: boolean;
  cap: Amount | null;
  interval?: string;
}

export type LeftView = { kind: "connect" } | { kind: "checking" } | { kind: "left"; left: Amount; limit: Amount; spent: Amount; leftPct: number };

const DAY = 86_400_000;

/** Start of the current repetition of an interval such as R/2026-11-22T10:00:00Z/P1W, or null when it cannot be read. */
export function periodStartMs(interval: string | undefined, now: number): number | null {
  const m = interval ? /^R\d*\/([^/]+)\/P(\d+)([DW])$/.exec(interval) : null;
  if (!m) return null;
  const start = Date.parse(m[1]);
  const len = Number(m[2]) * (m[3] === "W" ? 7 : 1) * DAY;
  if (Number.isNaN(start) || len <= 0 || now < start) return null;
  return start + Math.floor((now - start) / len) * len;
}

/** Monday 00:00 (local time) of the week that contains `now`. */
export function mondayStartMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** receipts null = not loaded yet: say "checking" rather than showing a full limit that may be wrong. */
export function leftThisWeek(w: WalletView | null, receipts: SummaryReceipt[] | null, now: number): LeftView {
  if (!w || !w.connected || !w.cap) return { kind: "connect" };
  if (receipts === null) return { kind: "checking" };
  const from = periodStartMs(w.interval, now) ?? mondayStartMs(now);
  let spent = BigInt(0);
  for (const r of receipts) {
    const at = Date.parse(r.createdAt);
    if (Number.isNaN(at) || at < from || at > now || !sameAsset(r.debit, w.cap)) continue;
    spent += BigInt(r.debit.value);
  }
  const limit = BigInt(w.cap.value);
  const leftRaw = limit - spent;
  const left = leftRaw > BigInt(0) ? leftRaw : BigInt(0);
  const leftPct = limit > BigInt(0) ? Number((left * BigInt(100)) / limit) : 0;
  return { kind: "left", left: { ...w.cap, value: left.toString() }, limit: w.cap, spent: { ...w.cap, value: spent.toString() }, leftPct };
}

/** The sentence "Say it aloud" speaks: our template, built from the same numbers as the card. */
export function leftSentence(v: LeftView): string {
  if (v.kind === "connect") return "Connect your test wallet to see what is left to spend this week.";
  if (v.kind === "checking") return "I am still checking what is left to spend this week. Please try again in a moment.";
  return `You have ${speakPlain(v.left)} left to spend this week, of ${speakPlain(v.limit)}.`;
}

export interface BarDay {
  label: string;
  value: string; // minor units
  heightPct: number; // 0 to 100, share of the biggest day
  today: boolean;
}
export interface WeekBars {
  days: BarDay[];
  total: Amount;
  paid: number;
}

const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** This calendar week (Monday first) from the person's real receipts, in one currency. */
export function weekBars(receipts: SummaryReceipt[], now: number, assetCode: string, assetScale = 2): WeekBars {
  const from = mondayStartMs(now);
  const values = LABELS.map(() => BigInt(0));
  let paid = 0;
  for (const r of receipts) {
    const at = new Date(r.createdAt);
    if (Number.isNaN(at.getTime()) || at.getTime() < from || at.getTime() > now) continue;
    if (r.debit.assetCode !== assetCode || r.debit.assetScale !== assetScale) continue;
    values[(at.getDay() + 6) % 7] += BigInt(r.debit.value);
    paid++;
  }
  const max = values.reduce((a, b) => (b > a ? b : a), BigInt(0));
  const todayIdx = (new Date(now).getDay() + 6) % 7;
  const total = values.reduce((a, b) => a + b, BigInt(0));
  return {
    days: LABELS.map((label, i) => ({ label, value: values[i].toString(), heightPct: max > BigInt(0) ? Number((values[i] * BigInt(100)) / max) : 0, today: i === todayIdx })),
    total: { value: total.toString(), assetCode, assetScale },
    paid,
  };
}
