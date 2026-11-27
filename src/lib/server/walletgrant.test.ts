import { beforeAll, describe, expect, it, vi } from "vitest";
import { open } from "../secret";
import { interactionHash } from "../op/hash";
import type { GrantLimits, PaymentsGateway, WalletInfo } from "../op/types";
import { OpError } from "../op/types";
import { MemoryStore } from "../store/memory";
import { finishWalletConnect, startWalletConnect, type GrantRecord, type PendingRecord } from "./walletgrant";

const payer: WalletInfo = { id: "https://w.test/payer", assetCode: "USD", assetScale: 2, authServer: "https://auth.w.test", resourceServer: "https://w.test/rs" };
const NOW = Date.parse("2026-11-27T10:00:00.123Z");

function gw() {
  const seen: { limits?: GrantLimits; finishUri?: string; nonce?: string; cont?: unknown } = {};
  const g = {
    simulated: false,
    getWallet: async () => payer,
    requestOutgoingGrant: async (a: { limits: GrantLimits; finishUri: string; nonce: string }) => {
      Object.assign(seen, a);
      return { redirectUrl: "https://w.test/consent", continueUri: "https://auth.w.test/continue/1", continueToken: "RAW-CONT-1", finishNonce: "server-nonce", grantEndpoint: payer.authServer };
    },
    continueGrant: async (a: unknown) => {
      seen.cont = a;
      return { accessToken: "RAW-ACC-2", manageUrl: "https://auth.w.test/token/9", expiresIn: 600, continueUri: "https://auth.w.test/continue/2", continueToken: "RAW-CONT-2" };
    },
  } as unknown as PaymentsGateway;
  return { g, seen };
}

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
});

const start = (store: MemoryStore, g: PaymentsGateway, capMinor = 5000) =>
  startWalletConnect({ store, wallet: g, payerUrl: "https://w.test/payer", userId: "u1", origin: "https://pay-alone-hybrid.vercel.app", capMinor, now: () => NOW });

describe("wallet connection = spending-cap consent", () => {
  it("asks the wallet for a weekly cap and stores the pending grant sealed", async () => {
    const store = new MemoryStore();
    const { g, seen } = gw();
    const r = await start(store, g);
    expect(r).toEqual({ ok: true, redirectUrl: "https://w.test/consent" });
    expect(seen.limits).toEqual({ debitAmount: { value: "5000", assetCode: "USD", assetScale: 2 }, interval: "R/2026-11-27T10:00:00Z/P1W" });
    const m = /^https:\/\/pay-alone-hybrid\.vercel\.app\/api\/wallet\/callback\?state=([\w-]+)$/.exec(seen.finishUri ?? "");
    expect(m).not.toBeNull();
    const p = await store.get<PendingRecord>("grant_pending", m![1]);
    expect(p).toMatchObject({ userId: "u1", continueUri: "https://auth.w.test/continue/1", finishNonce: "server-nonce", grantEndpoint: payer.authServer, createdAt: NOW });
    expect(open(p!.continueToken)).toBe("RAW-CONT-1");
    expect(JSON.stringify(store.dump())).not.toContain("RAW-CONT-1");
  });

  it("reports failure when the wallet refuses", async () => {
    const { g } = gw();
    (g as unknown as { requestOutgoingGrant: unknown }).requestOutgoingGrant = async () => { throw new OpError("grant_rejected", "no"); };
    expect(await start(new MemoryStore(), g)).toEqual({ ok: false, reason: "wallet_refused" });
  });

  it("logs why the wallet failed (kind, status, short message) so it can be fixed, never a token", async () => {
    const { g } = gw();
    (g as unknown as { getWallet: unknown }).getWallet = async () => { throw new OpError("wallet_unreachable", "Could not reach the wallet (Private key is not in a recognised form).", { status: 401, code: "invalid_client" }); };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await start(new MemoryStore(), g)).toEqual({ ok: false, reason: "wallet_unreachable" });
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    warn.mockRestore();
    expect(logged).toContain("wallet_connect_failed");
    expect(logged).toContain("wallet_unreachable");
    expect(logged).toContain("401");
    expect(logged).toContain("Private key is not in a recognised form");
  });

  async function begun() {
    const store = new MemoryStore();
    const { g, seen } = gw();
    await start(store, g);
    const state = /state=([\w-]+)/.exec(seen.finishUri!)![1];
    const nonce = seen.nonce!;
    const hash = interactionHash(nonce, "server-nonce", "ref-1", payer.authServer);
    return { store, g, seen, state, hash };
  }

  it("callback with a good hash stores the grant sealed under the user and forgets the pending record", async () => {
    const { store, g, seen, state, hash } = await begun();
    const r = await finishWalletConnect({ store, wallet: g, state, interactRef: "ref-1", hash, now: () => NOW });
    expect(r).toEqual({ ok: true });
    expect(seen.cont).toEqual({ continueUri: "https://auth.w.test/continue/1", continueToken: "RAW-CONT-1", interactRef: "ref-1" });
    const rec = await store.get<GrantRecord>("grants", "u1");
    expect(open(rec!.accessToken)).toBe("RAW-ACC-2");
    expect(open(rec!.continueToken)).toBe("RAW-CONT-2");
    expect(rec).toMatchObject({ manageUrl: "https://auth.w.test/token/9", continueUri: "https://auth.w.test/continue/2", expiresAt: NOW + 600_000, cap: { value: "5000", assetCode: "USD", assetScale: 2 }, interval: "R/2026-11-27T10:00:00Z/P1W" });
    const dump = JSON.stringify(store.dump());
    for (const raw of ["RAW-ACC-2", "RAW-CONT-2", "RAW-CONT-1"]) expect(dump).not.toContain(raw);
    expect(await store.get("grant_pending", state)).toBeNull();
  });

  it("a wrong hash, an unknown state, a missing ref, or a replay all fail", async () => {
    const { store, g, state, hash } = await begun();
    expect(await finishWalletConnect({ store, wallet: g, state: "nope", interactRef: "ref-1", hash, now: () => NOW })).toEqual({ ok: false });
    expect(await finishWalletConnect({ store, wallet: g, state, interactRef: "", hash, now: () => NOW })).toEqual({ ok: false });
    // that failed try took the pending record, so the real callback is now a replay
    expect(await finishWalletConnect({ store, wallet: g, state, interactRef: "ref-1", hash, now: () => NOW })).toEqual({ ok: false });
    const b = await begun();
    expect(await finishWalletConnect({ store: b.store, wallet: b.g, state: b.state, interactRef: "ref-1", hash: "AAAA", now: () => NOW })).toEqual({ ok: false });
    expect(await b.store.get("grants", "u1")).toBeNull();
  });

  it("a pending record older than 15 minutes is refused", async () => {
    const { store, g, state, hash } = await begun();
    expect(await finishWalletConnect({ store, wallet: g, state, interactRef: "ref-1", hash, now: () => NOW + 15 * 60_000 + 1 })).toEqual({ ok: false });
    expect(await store.get("grants", "u1")).toBeNull();
  });
});

describe("wallet connection audit", () => {
  const rows = async (store: MemoryStore) => (await store.list<{ event: string; outcome: string; userId: string }>("audit")).map((r) => `${r.event}:${r.outcome}`);

  it("records wallet_connect ok, refused and unreachable, and wallet_callback connected", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { store, g, state, hash } = await (async () => {
      const store = new MemoryStore();
      const { g, seen } = gw();
      await start(store, g);
      const state = /state=([\w-]+)/.exec(seen.finishUri!)![1];
      return { store, g, state, hash: interactionHash(seen.nonce!, "server-nonce", "ref-1", payer.authServer) };
    })();
    await finishWalletConnect({ store, wallet: g, state, interactRef: "ref-1", hash, now: () => NOW });
    expect(await rows(store)).toEqual(expect.arrayContaining(["wallet_connect:ok", "wallet_callback:connected"]));

    for (const [kind, want] of [["grant_rejected", "refused"], ["wallet_unreachable", "unreachable"]] as const) {
      const s2 = new MemoryStore();
      const { g: g2 } = gw();
      (g2 as unknown as { requestOutgoingGrant: unknown }).requestOutgoingGrant = async () => { throw new OpError(kind, "x"); };
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await start(s2, g2);
      expect(await rows(s2)).toEqual([`wallet_connect:${want}`]);
    }
    vi.restoreAllMocks();
  });

  it("a failed callback is recorded for the person when the state is known, and printed only when it is not; tokens never appear", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const store = new MemoryStore();
    const { g, seen } = gw();
    await start(store, g);
    const state = /state=([\w-]+)/.exec(seen.finishUri!)![1];
    await finishWalletConnect({ store, wallet: g, state: "nope", interactRef: "ref-1", hash: "x", now: () => NOW });
    expect(await rows(store)).toEqual(["wallet_connect:ok"]); // unknown state: no person to attach it to
    await finishWalletConnect({ store, wallet: g, state, interactRef: "ref-1", hash: "AAAA", now: () => NOW });
    expect(await rows(store)).toEqual(expect.arrayContaining(["wallet_callback:failed"]));
    expect(info.mock.calls.map((c) => c.join(" "))).toContain("audit wallet_callback failed");
    expect(JSON.stringify(await store.list("audit")) + info.mock.calls.join()).not.toMatch(/RAW-|continue|token/i);
    vi.restoreAllMocks();
  });
});
