// One-time wallet connection = the person's spending-cap consent, given on the wallet's own page.
// Ported in outline from the earlier prototype's wallet setup/callback routes (see DISCLOSURES.md).
// Tokens are sealed before storage and never appear in URLs, logs or answers.
import { verifyInteractionHash } from "../op/hash";
import type { Amount } from "../money";
import { OpError, type PaymentsGateway } from "../op/types";
import { makeInterval } from "../interval";
import { open, randomToken, seal } from "../secret";
import type { Store } from "../store";

/** The wallet's consent page must be finished within this time. */
export const PENDING_GRANT_TTL_MS = 15 * 60_000;

export interface PendingRecord {
  userId: string;
  continueUri: string;
  continueToken: string; // sealed
  finishNonce: string;
  clientNonce: string;
  grantEndpoint: string;
  cap: Amount;
  interval: string;
  createdAt: number;
}

export interface GrantRecord {
  accessToken: string; // sealed
  manageUrl: string;
  continueUri: string;
  continueToken: string; // sealed
  expiresAt?: number; // epoch ms, when the wallet says the access token expires
  cap: Amount;
  interval?: string;
}

export interface GrantInput extends Omit<GrantRecord, "accessToken" | "continueToken"> {
  accessToken: string;
  continueToken: string;
}

export async function saveGrant(store: Store, userId: string, g: GrantInput): Promise<void> {
  const rec: GrantRecord = { ...g, accessToken: seal(g.accessToken), continueToken: seal(g.continueToken) };
  await store.put("grants", userId, rec);
}

export async function loadGrant(store: Store, userId: string): Promise<(GrantRecord & { token: string }) | null> {
  const g = await store.get<GrantRecord>("grants", userId);
  return g ? { ...g, token: open(g.accessToken) } : null;
}

export async function startWalletConnect(a: {
  store: Store;
  wallet: PaymentsGateway;
  payerUrl: string;
  userId: string;
  origin: string;
  capMinor: number;
  now?: () => number;
}): Promise<{ ok: true; redirectUrl: string } | { ok: false; reason: "wallet_refused" | "wallet_unreachable" }> {
  const now = a.now?.() ?? Date.now();
  try {
    const payer = await a.wallet.getWallet(a.payerUrl);
    const cap: Amount = { value: String(a.capMinor), assetCode: payer.assetCode, assetScale: payer.assetScale };
    const interval = makeInterval("week", new Date(now));
    const state = randomToken(18);
    const clientNonce = randomToken(18);
    const pending = await a.wallet.requestOutgoingGrant({
      wallet: payer,
      limits: { debitAmount: cap, interval },
      finishUri: `${a.origin}/api/wallet/callback?state=${state}`,
      nonce: clientNonce,
    });
    const rec: PendingRecord = {
      userId: a.userId,
      continueUri: pending.continueUri,
      continueToken: seal(pending.continueToken),
      finishNonce: pending.finishNonce,
      clientNonce,
      grantEndpoint: pending.grantEndpoint,
      cap,
      interval,
      createdAt: now,
    };
    await a.store.put("grant_pending", state, rec);
    return { ok: true, redirectUrl: pending.redirectUrl };
  } catch (e) {
    if (e instanceof OpError) {
      // Server log only: our own fixed text plus what the wallet said. Tokens never reach an OpError.
      const d = e.detail ?? {};
      console.warn("wallet_connect_failed", e.kind, d.status ?? "-", d.code ?? "-", (d.description ?? "").slice(0, 120), e.message.slice(0, 200));
      return { ok: false, reason: e.kind === "wallet_unreachable" ? "wallet_unreachable" : "wallet_refused" };
    }
    throw e;
  }
}

/** The wallet redirects the browser here after consent. The pending record can be used once. */
export async function finishWalletConnect(a: {
  store: Store;
  wallet: PaymentsGateway;
  state: string;
  interactRef: string;
  hash: string;
  now?: () => number;
}): Promise<{ ok: boolean }> {
  const now = a.now?.() ?? Date.now();
  if (!a.state) return { ok: false };
  const p = await a.store.take<PendingRecord>("grant_pending", a.state);
  if (!p || now - p.createdAt > PENDING_GRANT_TTL_MS) return { ok: false };
  if (!a.interactRef || !a.hash || !verifyInteractionHash(a.hash, p.clientNonce, p.finishNonce, a.interactRef, p.grantEndpoint)) return { ok: false };
  try {
    const t = await a.wallet.continueGrant({ continueUri: p.continueUri, continueToken: open(p.continueToken), interactRef: a.interactRef });
    await saveGrant(a.store, p.userId, {
      accessToken: t.accessToken,
      manageUrl: t.manageUrl,
      continueUri: t.continueUri,
      continueToken: t.continueToken,
      expiresAt: t.expiresIn ? now + t.expiresIn * 1000 : undefined,
      cap: p.cap,
      interval: p.interval,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof OpError) return { ok: false };
    throw e;
  }
}
