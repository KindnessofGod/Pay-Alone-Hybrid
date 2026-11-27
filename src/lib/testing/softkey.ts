// A software WebAuthn authenticator for tests only: makes real registration and sign-in responses
// (ES256, "none" attestation, user verified) so the server checks run against real signatures.
import { createHash, createSign, generateKeyPairSync } from "crypto";

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

function cborHead(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
}
const cborInt = (n: number) => (n >= 0 ? cborHead(0, n) : cborHead(1, -1 - n));
const cborBytes = (b: Buffer) => Buffer.concat([cborHead(2, b.length), b]);
const cborText = (s: string) => Buffer.concat([cborHead(3, s.length), Buffer.from(s)]);
const cborMap = (pairs: Buffer[][]) => Buffer.concat([cborHead(5, pairs.length), ...pairs.flat()]);

export function softKey(origin: string, opts: { userVerified?: boolean } = {}) {
  const rpId = new URL(origin).hostname;
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credId = Buffer.from(b64u(sha256(String(Math.random()))).slice(0, 22), "utf8");
  const id = b64u(credId);
  const uv = opts.userVerified === false ? 0 : 0x04;
  let counter = 0;

  return {
    id,
    register(challenge: string) {
      const cose = cborMap([
        [cborInt(1), cborInt(2)],
        [cborInt(3), cborInt(-7)],
        [cborInt(-1), cborInt(1)],
        [cborInt(-2), cborBytes(Buffer.from(jwk.x!, "base64url"))],
        [cborInt(-3), cborBytes(Buffer.from(jwk.y!, "base64url"))],
      ]);
      const len = Buffer.alloc(2);
      len.writeUInt16BE(credId.length);
      const counterBuf = Buffer.alloc(4);
      const authData = Buffer.concat([sha256(rpId), Buffer.from([0x01 | uv | 0x40]), counterBuf, Buffer.alloc(16), len, credId, cose]);
      const attestationObject = cborMap([
        [cborText("fmt"), cborText("none")],
        [cborText("attStmt"), cborMap([])],
        [cborText("authData"), cborBytes(authData)],
      ]);
      const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin, crossOrigin: false }));
      return {
        id,
        rawId: id,
        type: "public-key",
        response: { attestationObject: b64u(attestationObject), clientDataJSON: b64u(clientData), transports: ["internal"] },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
    /** challenge is what the browser sends to the device: base64url of the approval challenge (approvalChallengeForDevice). */
    sign(challenge: string, o: { origin?: string } = {}) {
      const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: o.origin ?? origin, crossOrigin: false }));
      const c = Buffer.alloc(4);
      c.writeUInt32BE(++counter);
      const authData = Buffer.concat([sha256(rpId), Buffer.from([0x01 | uv]), c]);
      const signature = createSign("SHA256").update(Buffer.concat([authData, sha256(clientData)])).sign(privateKey);
      return {
        id,
        rawId: id,
        type: "public-key",
        response: { authenticatorData: b64u(authData), clientDataJSON: b64u(clientData), signature: b64u(signature) },
        clientExtensionResults: {},
      };
    },
  };
}
