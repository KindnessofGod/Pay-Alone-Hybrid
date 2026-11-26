import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK, type JWTVerifyGetKey } from "jose";
import { verifyAppCheckToken, verifyFirebaseIdToken } from "./tokens";

const PROJECT = "pay-alone-hybrid";
const NUMBER = "631173080075";
let priv: CryptoKey;
let keys: JWTVerifyGetKey;
let otherPriv: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  priv = kp.privateKey;
  const jwk: JWK = { ...(await exportJWK(kp.publicKey)), alg: "RS256", use: "sig", kid: "k1" };
  keys = createLocalJWKSet({ keys: [jwk] });
  otherPriv = (await generateKeyPair("RS256")).privateKey;
});
afterEach(() => { delete process.env.FIREBASE_AUTH_EMULATOR_HOST; });

const now = () => Math.floor(Date.now() / 1000);
function idToken(o: { iss?: string; aud?: string; sub?: string; exp?: number; key?: CryptoKey } = {}) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(o.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(o.aud ?? PROJECT)
    .setSubject(o.sub ?? "user-1")
    .setIssuedAt(now() - 10)
    .setExpirationTime(o.exp ?? now() + 600)
    .sign(o.key ?? priv);
}
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unsigned = (p: Record<string, unknown>) => `${b64({ alg: "none", typ: "JWT" })}.${b64(p)}.`;
const goodClaims = () => ({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "emu-user", iat: now() - 5, exp: now() + 600 });

describe("verifyFirebaseIdToken", () => {
  it("returns the uid for a valid token", async () => {
    expect(await verifyFirebaseIdToken(await idToken(), { keys })).toBe("user-1");
  });
  it("rejects wrong issuer, audience, expiry, key and empty sub", async () => {
    for (const t of [
      await idToken({ iss: "https://securetoken.google.com/other" }),
      await idToken({ aud: "other" }),
      await idToken({ exp: now() - 600 }),
      await idToken({ key: otherPriv }),
      await idToken({ sub: "" }),
      await idToken({ sub: "x".repeat(129) }),
    ]) await expect(verifyFirebaseIdToken(t, { keys })).rejects.toThrow();
  });
  it("rejects alg none without the emulator env", async () => {
    await expect(verifyFirebaseIdToken(unsigned(goodClaims()), { keys })).rejects.toThrow();
  });
  it("accepts alg none with the emulator env and right claims", async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    expect(await verifyFirebaseIdToken(unsigned(goodClaims()), { keys })).toBe("emu-user");
  });
  it("with the emulator env still checks claims of unsigned tokens", async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    for (const p of [{ ...goodClaims(), aud: "x" }, { ...goodClaims(), iss: "x" }, { ...goodClaims(), sub: "" }, { ...goodClaims(), exp: now() - 600 }])
      await expect(verifyFirebaseIdToken(unsigned(p), { keys })).rejects.toThrow();
  });
});

function acToken(o: { iss?: string; aud?: string[]; exp?: number } = {}) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(o.iss ?? `https://firebaseappcheck.googleapis.com/${NUMBER}`)
    .setAudience(o.aud ?? [`projects/${NUMBER}`, `projects/${PROJECT}`])
    .setSubject("1:631173080075:web:abc")
    .setIssuedAt(now() - 10)
    .setExpirationTime(o.exp ?? now() + 600)
    .sign(priv);
}

describe("verifyAppCheckToken", () => {
  it("accepts a valid token", async () => {
    await expect(verifyAppCheckToken(await acToken(), keys)).resolves.toBeUndefined();
  });
  it("rejects wrong audience, issuer and expired", async () => {
    for (const t of [await acToken({ aud: ["projects/1"] }), await acToken({ iss: "https://firebaseappcheck.googleapis.com/1" }), await acToken({ exp: now() - 600 })])
      await expect(verifyAppCheckToken(t, keys)).rejects.toThrow();
  });
});
