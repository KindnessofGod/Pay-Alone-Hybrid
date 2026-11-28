// The whole "shop asks, customer approves" flow through the real API routes, the Auth emulator and the
// Firestore emulator, on the SIMULATED rail (MOCK_OP). No real money, no real wallet.
import { beforeAll, describe, expect, it } from "vitest";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { POST as setPin } from "@/app/api/pin/route";
import { POST as start } from "@/app/api/pay/start/route";
import { POST as finish } from "@/app/api/pay/finish/route";
import { POST as payCode } from "@/app/api/paycode/route";
import { POST as ask } from "@/app/api/shop/ask/route";
import { POST as status } from "@/app/api/shop/status/route";
import { POST as pending } from "@/app/api/requests/pending/route";
import { POST as decline } from "@/app/api/requests/decline/route";
import { POST as history } from "@/app/api/history/route";
import { FirestoreStore } from "@/lib/store/firestore";

async function user(name: string) {
  const app = initializeApp({ projectId: "pay-alone-hybrid", apiKey: "emulator-only" }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  return (await signInAnonymously(auth)).user.getIdToken();
}
const call = async (route: (r: Request) => Promise<Response>, token: string, body: unknown = {}) => {
  const res = await route(new Request("https://pay-alone-hybrid.vercel.app/api", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};

let buyer = "";
let shop = "";
let code = "";

beforeAll(async () => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
  buyer = await user("buyer");
  shop = await user("shop");
  await call(setPin, buyer, { pin: "4826" });
  code = (await call(payCode, buyer)).body.code;
});

describe("seller flow (emulators)", () => {
  it("gives a stable 6-digit pay code, stored in Firestore", async () => {
    expect(code).toMatch(/^\d{6}$/);
    expect((await call(payCode, buyer)).body.code).toBe(code);
    expect(await new FirestoreStore().get("paycodes", code)).toMatchObject({ userId: expect.any(String) });
  });

  it("refuses callers who are not signed in", async () => {
    expect((await call(ask, "forged", { code, amountMinor: "100", shopName: "X" })).status).toBe(401);
    expect((await call(pending, "forged")).status).toBe(401);
  });

  it("shop asks, customer sees it, approves, shop sees PAID; receipt has the reference", async () => {
    expect((await call(ask, buyer, { code, amountMinor: "100", shopName: "Me" })).body).toMatchObject({ ok: false, reason: "self_request" });
    expect((await call(ask, shop, { code: "000000", amountMinor: "100", shopName: "Mama Put" })).body).toMatchObject({ ok: false, reason: "unknown_code" });

    const a = (await call(ask, shop, { code, amountMinor: "200000", shopName: "Mama Put", note: "Rice" })).body;
    expect(a.ok).toBe(true);
    const id = a.request.id as string;
    expect((await call(status, shop, { id })).body).toMatchObject({ ok: true, status: "pending", ref: a.request.ref });
    expect((await call(status, buyer, { id })).body).toMatchObject({ ok: false, reason: "not_found" });

    const list = (await call(pending, buyer)).body.requests;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, shopName: "Mama Put", amountMinor: "200000", ref: a.request.ref });
    expect((await call(pending, shop)).body.requests).toEqual([]);

    // The browser's own payeeId and amount are ignored: the server uses the request.
    const s = (await call(start, buyer, { shopRequestId: id, payeeId: "c1", amountMinor: "1" })).body;
    expect(s).toMatchObject({ ok: true, payeeName: "Mama Put", simulated: true });
    expect(s.debit.value).toBe("200000");
    expect((await call(start, shop, { shopRequestId: id })).body).toMatchObject({ ok: false });

    expect((await call(status, shop, { id })).body.status).toBe("pending"); // starting is not paying
    const f = (await call(finish, buyer, { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } })).body;
    expect(f.ok).toBe(true);
    expect(f.spoken).toContain(`Paid Mama Put, reference ${a.request.ref}`);
    expect(f.receipt).toMatchObject({ ref: a.request.ref, shopRequestId: id });

    expect((await call(status, shop, { id })).body).toMatchObject({ status: "paid", amountMinor: "200000" });
    expect((await call(pending, buyer)).body.requests).toEqual([]);
    const h = (await call(history, buyer)).body;
    expect(h.receipts[0]).toMatchObject({ payeeName: "Mama Put", ref: a.request.ref });
    expect(h.events.map((e: { event: string }) => e.event)).toEqual(expect.arrayContaining(["request_shown", "request_paid"]));
  });

  it("decline marks declined and it can no longer be paid", async () => {
    const a = (await call(ask, shop, { code, amountMinor: "5000", shopName: "Mama Put" })).body;
    expect((await call(decline, shop, { id: a.request.id })).body).toMatchObject({ ok: false });
    expect((await call(decline, buyer, { id: a.request.id })).body).toEqual({ ok: true });
    expect((await call(status, shop, { id: a.request.id })).body.status).toBe("declined");
    expect((await call(start, buyer, { shopRequestId: a.request.id })).body).toMatchObject({ ok: false, reason: "request_closed" });
  });
});
