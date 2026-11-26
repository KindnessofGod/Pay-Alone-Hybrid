// The real API routes, signed in through the Auth emulator, storing in the Firestore emulator.
import { beforeAll, describe, expect, it } from "vitest";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { POST as setPin } from "@/app/api/pin/route";
import { POST as start } from "@/app/api/pay/start/route";
import { POST as finish } from "@/app/api/pay/finish/route";
import { POST as cancel } from "@/app/api/pay/cancel/route";
import { FirestoreStore } from "@/lib/store/firestore";

const app = initializeApp({ projectId: "pay-alone-hybrid", apiKey: "emulator-only" }, "api-test");
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

let token = "";
const call = async (route: (r: Request) => Promise<Response>, body: unknown, t = token) => {
  const res = await route(new Request("https://pay-alone-hybrid.vercel.app/api", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
  token = await (await signInAnonymously(auth)).user.getIdToken();
});

describe("payment API (emulators)", () => {
  it("refuses a caller who is not signed in", async () => {
    expect((await call(start, { payeeId: "c1", amountMinor: "500" }, "forged")).status).toBe(401);
  });

  it("set PIN, start, wrong PIN, right PIN: pays once and the server stores the receipt", async () => {
    expect((await call(setPin, { pin: "4826" })).body).toEqual({ ok: true });
    const s = (await call(start, { payeeId: "c2", amountMinor: "250000" })).body;
    expect(s).toMatchObject({ ok: true, payeeName: "Tunde", simulated: true });
    expect(s.readBack).toContain("2,500 naira");

    const wrong = (await call(finish, { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "9173" } })).body;
    expect(wrong).toMatchObject({ ok: false, reason: "wrong", triesLeft: 4 });

    const ok = (await call(finish, { requestId: s.requestId, proof: { method: "pin", challenge: wrong.challenge, pin: "4826" } })).body;
    expect(ok.ok).toBe(true);
    expect(ok.spoken).toMatch(/^Simulated payment, no real money moved\./);
    expect(await new FirestoreStore().get("receipts", ok.receipt.id)).toEqual(ok.receipt);

    const again = (await call(finish, { requestId: s.requestId, proof: { method: "pin", challenge: wrong.challenge, pin: "4826" } })).body;
    expect(again.ok).toBe(false);
  });

  it("cancel stops a pending payment", async () => {
    const s = (await call(start, { payeeId: "c1", amountMinor: "500" })).body;
    await call(cancel, { requestId: s.requestId });
    const f = (await call(finish, { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } })).body;
    expect(f).toMatchObject({ ok: false, reason: "not_found" });
  });
});
