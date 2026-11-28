import { describe, expect, it } from "vitest";
import { addRecent, parseRecents } from "./recents";
import { leftThisWeek, leftSentence, periodStartMs, weekBars, type SummaryReceipt } from "./summary";

const usd = (value: string) => ({ value, assetCode: "USD", assetScale: 2 });
const cap = usd("5000");
// The wallet grant's week started on Sun 22 Nov 2026 10:00 UTC and repeats every 7 days.
const INTERVAL = "R/2026-11-22T10:00:00Z/P1W";
const NOW = Date.parse("2026-11-27T12:00:00Z"); // Fri, 5 days into that period

const rc = (iso: string, value: string, over: Partial<SummaryReceipt> = {}): SummaryReceipt => ({ id: iso, payeeName: "Tunde", debit: usd(value), simulated: false, createdAt: iso, ...over });

describe("periodStartMs", () => {
  it("finds the start of the current repetition of the grant interval", () => {
    expect(new Date(periodStartMs(INTERVAL, NOW)!).toISOString()).toBe("2026-11-22T10:00:00.000Z");
    expect(new Date(periodStartMs(INTERVAL, Date.parse("2026-12-01T00:00:00Z"))!).toISOString()).toBe("2026-11-29T10:00:00.000Z");
  });
  it("is null when the interval is missing or not understood", () => {
    expect(periodStartMs(undefined, NOW)).toBeNull();
    expect(periodStartMs("garbage", NOW)).toBeNull();
  });
});

describe("leftThisWeek (Open Payments has no balance: limit minus our own finished payments)", () => {
  it("asks to connect when no wallet is connected or the limit is unknown", () => {
    expect(leftThisWeek(null, [], NOW).kind).toBe("connect");
    expect(leftThisWeek({ connected: false, cap: null }, [], NOW).kind).toBe("connect");
    expect(leftThisWeek({ connected: true, cap: null }, [], NOW).kind).toBe("connect");
  });
  it("says checking (not a full limit) while the receipts have not loaded", () => {
    expect(leftThisWeek({ connected: true, cap, interval: INTERVAL }, null, NOW).kind).toBe("checking");
    expect(leftThisWeek(null, null, NOW).kind).toBe("connect");
  });
  it("subtracts this account's receipts inside the grant's current week", () => {
    const v = leftThisWeek({ connected: true, cap, interval: INTERVAL }, [rc("2026-11-23T09:00:00Z", "1250"), rc("2026-11-26T09:00:00Z", "630")], NOW);
    expect(v).toMatchObject({ kind: "left", left: usd("3120"), limit: cap, spent: usd("1880"), leftPct: 62 });
  });
  it("ignores receipts from before the current week and receipts in another currency", () => {
    const v = leftThisWeek({ connected: true, cap, interval: INTERVAL }, [rc("2026-11-21T09:00:00Z", "4000"), rc("2026-11-25T09:00:00Z", "700", { debit: { value: "700", assetCode: "NGN", assetScale: 2 } })], NOW);
    expect(v).toMatchObject({ kind: "left", left: cap, spent: usd("0"), leftPct: 100 });
  });
  it("never goes below zero", () => {
    const v = leftThisWeek({ connected: true, cap, interval: INTERVAL }, [rc("2026-11-24T09:00:00Z", "6000")], NOW);
    expect(v).toMatchObject({ kind: "left", left: usd("0"), leftPct: 0 });
  });
  it("counts from Monday when the interval cannot be read", () => {
    const v = leftThisWeek({ connected: true, cap }, [rc(new Date(2026, 10, 23, 9).toISOString(), "1000"), rc(new Date(2026, 10, 20, 9).toISOString(), "2000")], new Date(2026, 10, 27, 12).getTime());
    expect(v).toMatchObject({ kind: "left", spent: usd("1000"), left: usd("4000") });
  });
});

describe("leftSentence (spoken, dollars not naira)", () => {
  it("says the left amount and the limit", () => {
    const v = leftThisWeek({ connected: true, cap, interval: INTERVAL }, [rc("2026-11-23T09:00:00Z", "1880")], NOW);
    expect(leftSentence(v)).toBe("You have 31 dollars and 20 cents left to spend this week, of 50 dollars.");
  });
  it("tells the person to connect when there is no number", () => {
    expect(leftSentence(leftThisWeek(null, [], NOW))).toMatch(/connect your test wallet/i);
  });
});

describe("weekBars (Mon to Sun, real receipts, integer minor units)", () => {
  // Wed 25 Nov 2026 local
  const now = new Date(2026, 10, 25, 15).getTime();
  const at = (d: number, h = 9) => new Date(2026, 10, d, h).toISOString();
  it("sums receipts per day this week and marks today", () => {
    const w = weekBars([rc(at(23), "500"), rc(at(23, 18), "250"), rc(at(25), "1000"), rc(at(16), "9999")], now, "USD");
    expect(w.days.map((d) => d.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(w.days.map((d) => d.value)).toEqual(["750", "0", "1000", "0", "0", "0", "0"]);
    expect(w.days.find((d) => d.today)?.label).toBe("Wed");
    expect(w.total).toEqual(usd("1750"));
    expect(w.paid).toBe(3);
    expect(w.days[2].heightPct).toBe(100);
    expect(w.days[0].heightPct).toBe(75);
    expect(w.days[1].heightPct).toBe(0);
  });
  it("is all zeros with no receipts", () => {
    const w = weekBars([], now, "USD");
    expect(w.total).toEqual(usd("0"));
    expect(w.days.every((d) => d.heightPct === 0)).toBe(true);
  });
  it("only counts receipts in the chosen currency", () => {
    const w = weekBars([rc(at(24), "300"), rc(at(24), "900", { debit: { value: "900", assetCode: "NGN", assetScale: 2 } })], now, "USD");
    expect(w.total).toEqual(usd("300"));
    expect(w.paid).toBe(1);
  });
});

describe("recent customers on the shop page (codes only)", () => {
  it("puts the newest first, keeps six digits only, no repeats, at most 5", () => {
    let l: string[] = [];
    for (const c of ["111111", "222222", "333333", "444444", "555555", "666666"]) l = addRecent(l, c);
    expect(l).toEqual(["666666", "555555", "444444", "333333", "222222"]);
    expect(addRecent(l, "44 44 44")).toEqual(["444444", "666666", "555555", "333333", "222222"]);
    expect(addRecent(l, "12345")).toEqual(l);
  });
  it("reads saved text safely", () => {
    expect(parseRecents('["123456","bad",7]')).toEqual(["123456"]);
    expect(parseRecents("nope")).toEqual([]);
    expect(parseRecents(null)).toEqual([]);
  });
});
