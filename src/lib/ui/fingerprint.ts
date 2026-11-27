// Browser side of the fingerprint: small helpers around WebAuthn. No decisions here; the server
// checks the signature (passkey.ts) and decides.
export const FINGERPRINT_PROMPT = "To approve, touch your fingerprint sensor, or type your PIN.";
export const FINGERPRINT_FAILED = "Fingerprint did not work. You can try again or type your PIN.";
export const FINGERPRINT_OFFER = "Want to approve with your fingerprint next time?";

/** Same bytes as approvalChallengeForDevice on the server (UTF-8, base64url), without needing Node's Buffer. */
export function textToBase64url(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What to ask the device to sign for one payment. rpId is left out so the browser uses this site's own name. */
export function fingerprintRequest(approvalChallenge: string) {
  return { challenge: textToBase64url(approvalChallenge), userVerification: "required" as const, timeout: 60_000, rpId: undefined as string | undefined };
}

export function fingerprintAvailable(w: { PublicKeyCredential?: unknown } = typeof window === "undefined" ? {} : window): boolean {
  return typeof w.PublicKeyCredential !== "undefined";
}
