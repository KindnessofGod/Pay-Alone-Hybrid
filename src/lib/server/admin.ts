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
  return initializeApp({ credential: cert(JSON.parse(raw)), projectId }, APP_NAME);
}
