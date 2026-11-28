// Pure helpers for the /demo page (device frames + money moving). No React, no network.

export interface PaidMessage {
  event: "paid";
  amountMinor: string;
  ref: string;
}

/**
 * The shop frame tells the page "paid". Accept only a same-origin message of exactly this shape; the amount is a
 * positive integer string in minor units (the shop got it from the server's own record, never from the page).
 */
export function parseDemoMessage(data: unknown, origin: string, selfOrigin: string): PaidMessage | null {
  if (origin !== selfOrigin || !data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type !== "payalone-demo" || d.event !== "paid") return null;
  if (typeof d.amountMinor !== "string" || !/^[1-9]\d{0,14}$/.test(d.amountMinor)) return null;
  if (d.ref !== undefined && typeof d.ref !== "string") return null;
  return { event: "paid", amountMinor: d.amountMinor, ref: (d.ref as string | undefined) ?? "" };
}

/** Naira from kobo with integer maths: ₦2,000 or ₦1,500.50 (kobo shown only when there are some). */
export function formatNairaMinor(minor: string): string {
  const v = BigInt(minor);
  const whole = (v / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const kobo = Number(v % 100n);
  return `₦${whole}${kobo ? `.${String(kobo).padStart(2, "0")}` : ""}`;
}

/** Add one paid message to the running total. The same ref twice counts once; a missing ref always counts. */
export function addPaid(s: { total: string; refs: string[] }, p: { amountMinor: string; ref: string }): { total: string; refs: string[] } {
  if (p.ref && s.refs.includes(p.ref)) return s;
  return { total: (BigInt(s.total) + BigInt(p.amountMinor)).toString(), refs: p.ref ? [...s.refs, p.ref] : s.refs };
}

/** Scale that fits a native-size box into the space, never enlarging past 1 and never reaching 0. */
export function fitScale(avail: { w: number; h: number }, native: { w: number; h: number }): number {
  const s = Math.min(avail.w / native.w, avail.h / native.h, 1);
  return Number.isFinite(s) && s > 0.05 ? s : 0.05;
}

/** The page tells the apps inside to mute or unmute their voice. Same origin only. */
export function parseMuteMessage(data: unknown, origin: string, selfOrigin: string): boolean | null {
  if (origin !== selfOrigin || !data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  return d.type === "payalone-demo" && d.event === "mute" && typeof d.on === "boolean" ? d.on : null;
}
