// Firebase in the browser: app, App Check, Firebase AI Logic (hybrid), Remote Config.
// Config comes from NEXT_PUBLIC_* build variables, never from the repo.
"use client";
import { failAfter } from "../hybrid/timeout";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider, type AppCheck } from "firebase/app-check";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";
import { fetchAndActivate, getRemoteConfig, getValue } from "firebase/remote-config";
import type { Policy } from "../hybrid/understand";

let app: FirebaseApp | undefined;
let ai: AI | undefined;
let appCheck: AppCheck | undefined;

export function firebaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
}

export function firebaseApp(): FirebaseApp {
  if (app) return app;
  app =
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  // App Check protects the cloud path. Local development uses a debug token (printed in the console
  // and registered in the Firebase console); the hosted app uses reCAPTCHA v3.
  if (process.env.NEXT_PUBLIC_APPCHECK_DEBUG === "1") {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (siteKey) {
    const provider = process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE === "1" ? new ReCaptchaEnterpriseProvider(siteKey) : new ReCaptchaV3Provider(siteKey);
    appCheck = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  }
  return app;
}

export function firebaseAI(): AI {
  if (!ai) ai = getAI(firebaseApp(), { backend: new GoogleAIBackend() });
  return ai;
}

const POLICIES: Policy[] = ["on_device_first", "on_device_only", "cloud_only", "ai_off"];

/** Routing policy and spending limit from Remote Config, so they change without a redeploy. */
export async function remoteSettings(): Promise<{ policy: Policy; limitMinor: string }> {
  const defaults = { policy: "on_device_first" as Policy, limitMinor: "5000000" };
  try {
    const rc = getRemoteConfig(firebaseApp());
    rc.settings.minimumFetchIntervalMillis = 30_000;
    rc.defaultConfig = { routing_policy: defaults.policy, voice_limit_minor: defaults.limitMinor };
    await failAfter(fetchAndActivate(rc), 5_000, "Remote Config");
    const p = getValue(rc, "routing_policy").asString() as Policy;
    const l = getValue(rc, "voice_limit_minor").asString();
    return { policy: POLICIES.includes(p) ? p : defaults.policy, limitMinor: /^\d+$/.test(l) ? l : defaults.limitMinor };
  } catch {
    return defaults;
  }
}

/** Right after page load reCAPTCHA may still be loading, so one failed try is followed by a short wait and a retry. */
async function appCheckToken(ac: AppCheck): Promise<string> {
  for (let i = 0; i < 3; i++) {
    const t = await getToken(ac).then((r) => r.token).catch(() => "");
    if (t) return t;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return "";
}

/**
 * Calls one of our payment API routes as the signed-in (anonymous) Firebase user.
 * The server reads the user id from the verified token, never from the body.
 */
export async function api<T = Record<string, unknown>>(path: string, body: unknown, opts: { signIn?: boolean } = {}): Promise<T & { ok: boolean; reason?: string }> {
  const { connectAuthEmulator, getAuth, signInAnonymously } = await import("firebase/auth");
  const auth = getAuth(firebaseApp());
  const emu = process.env.NEXT_PUBLIC_AUTH_EMULATOR; // local tests only, e.g. http://127.0.0.1:9099
  if (emu && !auth.emulatorConfig) connectAuthEmulator(auth, emu, { disableWarnings: true });
  // signIn:false (opening the page, loading history): never create a new anonymous user just for this.
  // Wait for Firebase to restore a saved session first; with none, answer "signed_out" without a call.
  if (opts.signIn === false) await auth.authStateReady();
  const existing = auth.currentUser;
  if (!existing && opts.signIn === false) return { ok: false, reason: "signed_out" } as T & { ok: boolean; reason?: string };
  const user = existing ?? (await signInAnonymously(auth)).user;
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheck ? { "x-firebase-appcheck": await appCheckToken(appCheck) } : {}),
    },
    body: JSON.stringify(body),
  });
  try {
    return await res.json();
  } catch {
    return { ok: false, reason: `http_${res.status}` } as T & { ok: boolean; reason?: string };
  }
}

/**
 * Tells the server a step that only the browser can see (see server/clientaudit.ts). Fire and forget:
 * it never waits, never throws, and sends only small fixed fields, never what the person said.
 */
export function reportEvent(fields: Record<string, string | number | boolean>, opts: { signIn?: boolean } = {}): void {
  if (!firebaseConfigured()) return;
  void api("/api/audit", fields, opts).catch(() => undefined);
}
