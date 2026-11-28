// /demo through the real routes, Auth emulator and Firestore emulator, on the SIMULATED rail (MOCK_OP):
// one user asks themselves in demo mode, pays with a verified PIN, the status turns paid, the summaries update.
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
import { POST as summary } from "@/app/api/demo/summary/route";
import { POST as history } from "@/app/api/history/route";

async function user(name: string) {
  const app = initializeApp({ projectId: "pay-alone-hybrid", apiKey: "emulator-only" }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  return (await signInAnonymously(auth)).user.getIdToken();
}
const call = async (route: (r: Request) => Promise<Response>, token: string, body: unknown = {}, referer?: string) => {
  const res = await route(new Request("https://pay-alone-hybrid.vercel.app/api", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(referer ? { referer } : {}) }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const DEMO_PAGE = "https://pay-alone-hybrid.vercel.app/demo";

let me = "";
let code = "";
beforeAll(async () => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
  me = await user("demo-me");
  await call(setPin, me, { pin: "4826" });
  code = (await call(payCode, me)).body.code;
});

describe("demo mode (emulators)", () => {
  it("refuses a self-request normally, and the demo flag outside the /demo page", async () => {
    expect((await call(ask, me, { code, amountMinor: "100", shopName: "Mama Put" })).body).toMatchObject({ ok: false, reason: "self_request" });
    expect((await call(ask, me, { code, amountMinor: "100", shopName: "Mama Put", demo: true })).body).toMatchObject({ ok: false, reason: "demo_not_allowed" });
    expect((await call(ask, me, { code, amountMinor: "100", shopName: "Mama Put", demo: true }, "https://pay-alone-hybrid.vercel.app/shop")).body).toMatchObject({ ok: false, reason: "demo_not_allowed" });
  });

  it("demo ask -> customer sees it -> verified PIN pays -> status paid -> summaries updated", async () => {
    const before = (await call(summary, me)).body;
    expect(before.ok).toBe(true);
    expect(before.shop.received).toEqual([]);
    expect(before.simulated).toBe(true);

    const a = (await call(ask, me, { code, amountMinor: "200000", shopName: "Mama Put", note: "Rice", demo: true }, DEMO_PAGE)).body;
    expect(a.ok).toBe(true);
    const id = a.request.id as string;
    expect((await call(status, me, { id })).body).toMatchObject({ ok: true, status: "pending", ref: a.request.ref });
    const list = (await call(pending, me)).body.requests;
    expect(list.map((r: { id: string }) => r.id)).toContain(id);

    const s = (await call(start, me, { shopRequestId: id, amountMinor: "1" })).body;
    expect(s).toMatchObject({ ok: true, simulated: true });
    expect(s.debit.value).toBe("200000");
    const bad = (await call(finish, me, { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "1111" } })).body;
    expect(bad.ok).toBe(false);
    expect((await call(status, me, { id })).body.status).toBe("pending");
    const f = (await call(finish, me, { requestId: s.requestId, proof: { method: "pin", challenge: bad.challenge, pin: "4826" } })).body;
    expect(f.ok).toBe(true);

    expect((await call(status, me, { id })).body).toMatchObject({ status: "paid", amountMinor: "200000" });
    const after = (await call(summary, me)).body;
    expect(after.shop.received).toEqual([{ assetCode: "NGN", assetScale: 2, value: "200000", count: 1 }]);
    expect(after.customer.sentThisWeek).toEqual([{ assetCode: "NGN", assetScale: 2, value: "200000", count: 1 }]);
    const events = (await call(history, me)).body.events.map((e: { event: string }) => e.event);
    expect(events).toEqual(expect.arrayContaining(["request_paid", "demo_paid"]));
  });

  it("another user cannot read this demo request's status or the summaries", async () => {
    const other = await user("demo-other");
    const a = (await call(ask, me, { code, amountMinor: "100", shopName: "Mama Put", demo: true }, DEMO_PAGE)).body;
    expect((await call(status, other, { id: a.request.id })).body).toMatchObject({ ok: false, reason: "not_found" });
    expect((await call(summary, other)).body.shop.received).toEqual([]);
  });
});
