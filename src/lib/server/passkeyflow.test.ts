import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory";
import { approvalChallengeForDevice } from "../passkey";
import { softKey } from "../testing/softkey";
import { MAX_TRIES } from "../security/pin";
import { PASSKEY_PENDING_TTL_MS, passkeyOptions, passkeyRegister, storedPasskeys } from "./passkeyflow";
import { finishPayment, setUserPin, startPayment, type PayDeps } from "./payflow";

const ORIGIN = "https://pay-alone-hybrid.vercel.app";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
});

function deps(over: Partial<PayDeps> = {}): PayDeps {
  const store = new MemoryStore();
  let n = 0;
  const d: PayDeps = {
    store,
    baseUrl: ORIGIN,
    limitMinor: 5_000_000,
    contacts: async () => [{ id: "c1", name: "Mama Ade" }],
    quote: async (_u, _p, a) => ({ quoteId: `q${++n}`, debit: { value: a, assetCode: "NGN", assetScale: 2 }, simulated: true }),
    pay: async (_u, q) => ({ paymentId: `p-${q}`, simulated: true }),
    passkeys: (u) => storedPasskeys(store, u),
    ...over,
  };
  return d;
}

async function withPin(d = deps(), user = "u1") {
  await setUserPin(d, user, { pin: "4826" });
  return d;
}

async function enroll(d: PayDeps, user: string, key = softKey(ORIGIN)) {
  const o = await passkeyOptions(d, user, { pin: "4826" });
  if (!o.ok) throw new Error("options failed " + o.reason);
  const r = await passkeyRegister(d, user, { response: key.register(o.options.challenge) });
  return { key, r };
}

describe("adding a fingerprint", () => {
  it("refuses until a PIN exists (the PIN is the backup and comes first)", async () => {
    const d = deps();
    expect(await passkeyOptions(d, "u1", { pin: "4826" })).toMatchObject({ ok: false, reason: "no_pin_set" });
  });

  it("needs the current PIN; a wrong PIN is refused and counts toward the lockout", async () => {
    const d = await withPin();
    expect(await passkeyOptions(d, "u1", {})).toMatchObject({ ok: false, reason: "bad_pin" });
    expect(await passkeyOptions(d, "u1", { pin: "1357" })).toMatchObject({ ok: false, reason: "wrong", triesLeft: MAX_TRIES - 1 });
    for (let i = 0; i < MAX_TRIES - 1; i++) await passkeyOptions(d, "u1", { pin: "1357" });
    // locked now: even the right PIN is refused
    expect(await passkeyOptions(d, "u1", { pin: "4826" })).toMatchObject({ ok: false, reason: "locked" });
  });

  it("returns user-verification-required options with the right relying party", async () => {
    const d = await withPin();
    const o = await passkeyOptions(d, "u1", { pin: "4826" });
    if (!o.ok) throw new Error("no");
    expect(o.options.rp.id).toBe("pay-alone-hybrid.vercel.app");
    expect(o.options.authenticatorSelection?.userVerification).toBe("required");
  });

  it("register saves the key; the pending challenge works once", async () => {
    const d = await withPin();
    const o = await passkeyOptions(d, "u1", { pin: "4826" });
    if (!o.ok) throw new Error("no");
    const key = softKey(ORIGIN);
    const resp = key.register(o.options.challenge);
    expect(await passkeyRegister(d, "u1", { response: resp })).toEqual({ ok: true });
    expect((await storedPasskeys(d.store, "u1")).map((p) => p.id)).toEqual([key.id]);
    expect(await passkeyRegister(d, "u1", { response: resp })).toMatchObject({ ok: false, reason: "no_pending" });
  });

  it("register without a prior options call (no PIN proof) is refused", async () => {
    const d = await withPin();
    const key = softKey(ORIGIN);
    expect(await passkeyRegister(d, "u1", { response: key.register("whatever") })).toMatchObject({ ok: false, reason: "no_pending" });
    expect(await storedPasskeys(d.store, "u1")).toEqual([]);
  });

  it("the pending challenge expires", async () => {
    let t = 1_000_000;
    const d = await withPin(deps({ now: () => t }));
    const o = await passkeyOptions(d, "u1", { pin: "4826" });
    if (!o.ok) throw new Error("no");
    t += PASSKEY_PENDING_TTL_MS + 1;
    expect(await passkeyRegister(d, "u1", { response: softKey(ORIGIN).register(o.options.challenge) })).toMatchObject({ ok: false, reason: "no_pending" });
  });

  it("a wrong-origin registration is refused, and the challenge is spent", async () => {
    const d = await withPin();
    const o = await passkeyOptions(d, "u1", { pin: "4826" });
    if (!o.ok) throw new Error("no");
    const bad = softKey("https://evil.example", {}).register(o.options.challenge);
    expect(await passkeyRegister(d, "u1", { response: bad })).toMatchObject({ ok: false, reason: "bad_registration" });
    expect(await passkeyRegister(d, "u1", { response: softKey(ORIGIN).register(o.options.challenge) })).toMatchObject({ ok: false, reason: "no_pending" });
  });

  it("another user's pending challenge cannot be used by me", async () => {
    const d = await withPin();
    await withPin(d, "u2");
    const o = await passkeyOptions(d, "u1", { pin: "4826" });
    if (!o.ok) throw new Error("no");
    expect(await passkeyRegister(d, "u2", { response: softKey(ORIGIN).register(o.options.challenge) })).toMatchObject({ ok: false, reason: "no_pending" });
  });
});

describe("approving with the fingerprint", () => {
  async function start(d: PayDeps, user = "u1") {
    const s = await startPayment(d, user, { payeeId: "c1", amountMinor: "250000" });
    if (!s.ok) throw new Error("start");
    return s;
  }

  it("start says whether this person has a fingerprint", async () => {
    const d = await withPin();
    expect(await start(d)).toMatchObject({ hasPasskey: false });
    await enroll(d, "u1");
    expect(await start(d)).toMatchObject({ hasPasskey: true });
  });

  it("a real signature over this payment's challenge pays, records method passkey, and moves the counter", async () => {
    const d = await withPin();
    const { key } = await enroll(d, "u1");
    const s = await start(d);
    const response = key.sign(approvalChallengeForDevice(s.challenge));
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "passkey", challenge: s.challenge, response } });
    expect(f.ok).toBe(true);
    if (f.ok) expect(f.receipt.method).toBe("passkey");
    expect((await storedPasskeys(d.store, "u1"))[0].counter).toBe(1);
  });

  it("a replayed signature (counter not higher) is refused", async () => {
    const d = await withPin();
    const { key } = await enroll(d, "u1");
    const s1 = await start(d);
    const r1 = key.sign(approvalChallengeForDevice(s1.challenge));
    expect((await finishPayment(d, "u1", { requestId: s1.requestId, proof: { method: "passkey", challenge: s1.challenge, response: r1 } })).ok).toBe(true);
    const s2 = await start(d);
    const f = await finishPayment(d, "u1", { requestId: s2.requestId, proof: { method: "passkey", challenge: s2.challenge, response: r1 } });
    expect(f).toMatchObject({ ok: false, reason: "bad_passkey" });
  });

  it("a signature over a different payment's challenge is refused and gives a fresh challenge", async () => {
    const d = await withPin();
    const { key } = await enroll(d, "u1");
    const a = await start(d);
    const b = await start(d);
    const f = await finishPayment(d, "u1", { requestId: a.requestId, proof: { method: "passkey", challenge: a.challenge, response: key.sign(approvalChallengeForDevice(b.challenge)) } });
    expect(f).toMatchObject({ ok: false, reason: "bad_passkey" });
    expect((f as { challenge?: string }).challenge).toBeTruthy();
  });

  it("a passkey enrolled by another user is refused", async () => {
    const d = await withPin();
    await withPin(d, "u2");
    const { key: theirs } = await enroll(d, "u2");
    const s = await start(d, "u1");
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "passkey", challenge: s.challenge, response: theirs.sign(approvalChallengeForDevice(s.challenge)) } });
    expect(f).toMatchObject({ ok: false, reason: "bad_passkey" });
  });

  it("a passkey does not bypass anything when the person has none: the PIN still works", async () => {
    const d = await withPin();
    const s = await start(d);
    const f = await finishPayment(d, "u1", { requestId: s.requestId, proof: { method: "pin", challenge: s.challenge, pin: "4826" } });
    expect(f.ok).toBe(true);
    if (f.ok) expect(f.receipt.method).toBe("pin");
  });
});

describe("fingerprint audit", () => {
  it("records passkey_options and passkey_register outcomes, never the PIN or the credential", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const d = await withPin();
    await passkeyOptions(d, "u1", { pin: "9999" }); // wrong
    await enroll(d, "u1");
    await passkeyRegister(d, "u1", { response: {} }); // nothing pending
    const rows = (await d.store.list<{ event: string; outcome: string; reason?: string }>("audit")).map((r) => `${r.event}:${r.outcome}:${r.reason ?? ""}`);
    expect(rows).toEqual(expect.arrayContaining(["passkey_options:fail:wrong", "passkey_options:ok:", "passkey_register:ok:", "passkey_register:fail:no_pending"]));
    expect(JSON.stringify(await d.store.list("audit"))).not.toMatch(/4826|9999|challenge|credential/i);
    vi.restoreAllMocks();
  });
});
