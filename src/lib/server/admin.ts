// The one Firebase Admin app on the server. Credentials: FIREBASE_SERVICE_ACCOUNT holds the service
// account JSON (set in Vercel, never in git). Under the emulators no credentials are needed.
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";

const APP_NAME = "pay-alone-server";

export function adminApp(): App {
  if (getApps().some((a) => a.name === APP_NAME)) return getApp(APP_NAME);
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "pay-alone-hybrid";
  if (process.env.FIRESTORE_EMULATOR_HOST) return initializeApp({ projectId }, APP_NAME);
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set.");
  return initializeApp({ credential: cert(parseServiceAccount(raw) as Parameters<typeof cert>[0]), projectId }, APP_NAME);
}

/** Line breaks inside JSON strings become \n escapes (a pasted key sometimes has real ones). */
function escapeBreaksInStrings(t: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of t) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      else if (ch === "\n") {
        out += "\\n";
        continue;
      } else if (ch === "\r") continue;
    } else if (ch === '"') inStr = true;
    out += ch;
  }
  return out;
}

/**
 * Reads the service account however it was pasted into Vercel: JSON (pretty or one line), with
 * quotes or spaces around it, as a JSON string, or base64. On failure the error describes the shape
 * of the value only, never its content.
 */
export function parseServiceAccount(raw: string): Record<string, unknown> {
  let t = raw.trim();
  if (/^(['"`]).*\1$/s.test(t) && !t.startsWith('"{')) t = t.slice(1, -1).trim();
  if (!t.startsWith("{") && !t.startsWith('"') && /^[A-Za-z0-9+/=\s]+$/.test(t)) t = Buffer.from(t, "base64").toString("utf8").trim();
  for (let i = 0; i < 3; i++) {
    let v: unknown;
    try {
      v = JSON.parse(escapeBreaksInStrings(t));
    } catch {
      break;
    }
    if (typeof v === "string") {
      t = v.trim();
      continue;
    }
    if (v && typeof v === "object" && "private_key" in v && "client_email" in v) return v as Record<string, unknown>;
    break;
  }
  throw new Error(
    `FIREBASE_SERVICE_ACCOUNT is not the service account JSON (length ${raw.length}, starts with ${JSON.stringify(raw.trim().slice(0, 1))}). Paste the whole .json file content.`,
  );
}
