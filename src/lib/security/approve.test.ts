import { beforeAll, describe, expect, it } from "vitest";
import { issueChallenge, type ApprovalChallenge } from "../approval";
import { approvePayment, memoryChallenges } from "./approve";
import { setPin, type PinStore } from "./pin";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
});

function memPins(): PinStore {
  const m = new Map<string, unknown>();
  return { get: async <T,>(id: string) => (m.get(id) as T) ?? null, put: async (id, rec) => void m.set(id, rec) };
}

const subject = { requestId: "r1", quoteId: "q1", debitValue: "205000", assetCode: "NGN", assetScale: 2 };
const base = { userId: "u1", subject, baseUrl: "https://pay-alone-hybrid.vercel.app", passkeys: [] };

async function setup() {
  const pins = memPins();
  await setPin(pins, "u1", "4826");
  const challenges = memoryChallenges();
  const issued: ApprovalChallenge = issueChallenge(subject);
  await challenges.put("u1", subject, issued);
  return { pins, challenges, issued };
}

describe("approvePayment (server side)", () => {
  it("approves with the right PIN for this exact payment", async () => {
    const { pins, challenges, issued } = await setup();
    const r = await approvePayment({ ...base, pins, challenges, proof: { method: "pin", challenge: issued.challenge, pin: "4826" } });
    expect(r).toEqual({ ok: true, method: "pin" });
  });

  it("refuses a tap on its own: a button press is never approval", async () => {
    const { pins, challenges, issued } = await setup();
    const r = await approvePayment({ ...base, pins, challenges, proof: { method: "confirm-button", challenge: issued.challenge } });
    expect(r).toMatchObject({ ok: false, reason: "tap_not_enough" });
  });

  it("refuses a wrong PIN and counts the try", async () => {
    const { pins, challenges, issued } = await setup();
    const r = await approvePayment({ ...base, pins, challenges, proof: { method: "pin", challenge: issued.challenge, pin: "9173" } });
    expect(r).toMatchObject({ ok: false, reason: "wrong", triesLeft: 4 });
  });

  it("a challenge works once: the same approval cannot be replayed", async () => {
    const { pins, challenges, issued } = await setup();
    const proof = { method: "pin", challenge: issued.challenge, pin: "4826" };
    expect((await approvePayment({ ...base, pins, challenges, proof })).ok).toBe(true);
    expect(await approvePayment({ ...base, pins, challenges, proof })).toMatchObject({ ok: false, reason: "bad_challenge" });
  });

  it("a wrong PIN also uses up the challenge, so each guess needs a new quote", async () => {
    const { pins, challenges, issued } = await setup();
    await approvePayment({ ...base, pins, challenges, proof: { method: "pin", challenge: issued.challenge, pin: "9173" } });
    const r = await approvePayment({ ...base, pins, challenges, proof: { method: "pin", challenge: issued.challenge, pin: "4826" } });
    expect(r).toMatchObject({ ok: false, reason: "bad_challenge" });
  });

  it("refuses an approval made for a different amount or quote", async () => {
    const { pins, challenges, issued } = await setup();
    const r = await approvePayment({ ...base, subject: { ...subject, debitValue: "999999" }, pins, challenges, proof: { method: "pin", challenge: issued.challenge, pin: "4826" } });
    expect(r).toMatchObject({ ok: false, reason: "bad_challenge" });
  });

  it("refuses when no PIN was ever set (there is no default PIN)", async () => {
    const pins = memPins();
    const challenges = memoryChallenges();
    const issued = issueChallenge(subject);
    await challenges.put("u1", subject, issued);
    const r = await approvePayment({ ...base, pins, challenges, proof: { method: "pin", challenge: issued.challenge, pin: "4826" } });
    expect(r).toMatchObject({ ok: false, reason: "no_pin_set" });
  });

  it("refuses a passkey answer that does not verify", async () => {
    const { pins, challenges, issued } = await setup();
    const r = await approvePayment({ ...base, pins, challenges, proof: { method: "passkey", challenge: issued.challenge, response: { id: "made-up" } } });
    expect(r).toMatchObject({ ok: false, reason: "bad_passkey" });
  });

  it("refuses junk proofs", async () => {
    const { pins, challenges, issued } = await setup();
    for (const proof of [undefined, null, "4826", { method: "pin", challenge: issued.challenge }, { method: "pin", challenge: issued.challenge, pin: 4826 }]) {
      const r = await approvePayment({ ...base, pins, challenges, proof });
      expect(r.ok).toBe(false);
    }
  });

  it("never puts the PIN in its answer", async () => {
    const { pins, challenges, issued } = await setup();
    for (const pin of ["4826", "9173"]) {
      const c = issueChallenge(subject);
      await challenges.put("u1", subject, c);
      const r = await approvePayment({ ...base, pins, challenges, proof: { method: "pin", challenge: c.challenge, pin } });
      expect(JSON.stringify(r)).not.toContain(pin);
    }
    void issued;
  });
});
