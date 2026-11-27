// Fixed sentences for approval results. Success speaks the server's own template sentence.
type Result = { ok: true; spoken: string } | { ok: false; reason: string; triesLeft?: number };

const FIXED: Record<string, string> = {
  locked: "Too many wrong tries. Payments are locked for 15 minutes. Nothing was sent.",
  tap_not_enough: "A tap is not enough. Type your PIN to approve.",
  server_not_set_up: "The approval server is not set up yet. Nothing was sent.",
  no_pin_set: "You have not set a PIN yet. Please set one first.",
  not_found: "That payment has expired or was cancelled. Nothing was sent. Please start again.",
  bad_challenge: "That approval has expired. Nothing was sent. Please start again.",
  bad_passkey: "Fingerprint did not work. You can try again or type your PIN.",
  bad_registration: "I could not save your fingerprint. Nothing was changed. You can still use your PIN.",
  no_pending: "That fingerprint set-up expired. Nothing was changed. You can still use your PIN.",
  too_many: "You already have the most fingerprints saved. Nothing was changed.",
  bad_pin: "A PIN has 4 to 6 digits.",
  unreachable: "I could not reach the approval server. Nothing was sent. Please try again.",
  wallet_not_connected: "First, connect your wallet once and set a weekly spending limit.",
  over_cap: "That is more than the weekly limit you set in your wallet. Nothing was sent.",
  quote_failed: "The wallet could not price this payment. Nothing was sent. Please try again.",
  payment_failed: "The wallet could not send it. Nothing was sent. Please try again.",
  signed_out: "You are signed out. Please reload the page. Nothing was sent.",
};

export function approvalMessage(r: Result): string {
  if (r.ok) return r.spoken;
  if (r.reason === "wrong") return `That PIN is not right. You have ${r.triesLeft} tries left. Type it again, or say no to cancel.`;
  return FIXED[r.reason] ?? "Something went wrong. Nothing was sent.";
}
