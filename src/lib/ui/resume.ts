// Connecting the wallet sends the person to the wallet's page and back. This remembers which payment
// they were making (payee id and amount only, never a PIN) so they can carry on with one press.
// The amount is only a request: the read-back and the receipt still come from the server's quote.
export const RESUME_TTL_MS = 15 * 60_000;
const KEY = "payalone.resume";

type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
export interface Resume {
  payeeId: string;
  amountMinor: string;
}

export function saveResume(s: Storage, r: Resume, now = Date.now()): void {
  try {
    s.setItem(KEY, JSON.stringify({ payeeId: r.payeeId, amountMinor: r.amountMinor, at: now }));
  } catch {
    /* storage blocked: the person just types the payment again */
  }
}

export function takeResume(s: Storage, now = Date.now()): Resume | null {
  try {
    const raw = s.getItem(KEY);
    s.removeItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { payeeId?: unknown; amountMinor?: unknown; at?: unknown };
    if (typeof v.payeeId !== "string" || typeof v.amountMinor !== "string" || !/^\d{1,15}$/.test(v.amountMinor) || typeof v.at !== "number") return null;
    if (now - v.at > RESUME_TTL_MS) return null;
    return { payeeId: v.payeeId, amountMinor: v.amountMinor };
  } catch {
    return null;
  }
}
