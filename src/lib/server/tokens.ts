// Verifies Firebase ID tokens and App Check tokens with `jose` directly.
// Replaces firebase-admin/auth and firebase-admin/app-check, whose jwks-rsa dependency crashes on Vercel.
// Revocation is not checked; tokens live up to 1 hour.
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

const ID_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const APPCHECK_JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks";
const TOLERANCE_S = 30;

let idJwks: JWTVerifyGetKey | undefined;
let appCheckJwks: JWTVerifyGetKey | undefined;
const remoteIdKeys = () => (idJwks ??= createRemoteJWKSet(new URL(ID_JWKS_URL)));
const remoteAppCheckKeys = () => (appCheckJwks ??= createRemoteJWKSet(new URL(APPCHECK_JWKS_URL)));

const projectId = () => process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "pay-alone-hybrid";
const projectNumber = () => process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.split(":")[1] || "631173080075";

function uidFrom(payload: JWTPayload): string {
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0 || sub.length > 128) throw new Error("bad token subject");
  return sub;
}

function checkUnsignedClaims(p: JWTPayload, pid: string) {
  const nowS = Math.floor(Date.now() / 1000);
  if (p.iss !== `https://securetoken.google.com/${pid}`) throw new Error("bad issuer");
  if (p.aud !== pid) throw new Error("bad audience");
  if (typeof p.exp !== "number" || p.exp + TOLERANCE_S < nowS) throw new Error("token expired");
  if (typeof p.iat === "number" && p.iat - TOLERANCE_S > nowS) throw new Error("token issued in the future");
}

function isAlgNone(token: string): boolean {
  try {
    const header = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8"));
    return header?.alg === "none";
  } catch {
    return false;
  }
}

export async function verifyFirebaseIdToken(token: string, opts: { keys?: JWTVerifyGetKey } = {}): Promise<string> {
  const pid = projectId();
  // The Auth emulator issues unsigned tokens. Only ever accepted when the emulator env var is set.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && isAlgNone(token)) {
    const payload = decodeJwt(token);
    checkUnsignedClaims(payload, pid);
    return uidFrom(payload);
  }
  const { payload } = await jwtVerify(token, opts.keys ?? remoteIdKeys(), {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${pid}`,
    audience: pid,
    clockTolerance: TOLERANCE_S,
  });
  return uidFrom(payload);
}

export async function verifyAppCheckToken(token: string, keys?: JWTVerifyGetKey): Promise<void> {
  const num = projectNumber();
  await jwtVerify(token, keys ?? remoteAppCheckKeys(), {
    algorithms: ["RS256"],
    issuer: `https://firebaseappcheck.googleapis.com/${num}`,
    audience: `projects/${num}`,
    clockTolerance: TOLERANCE_S,
  });
}
