// Presentational pieces of the /demo page. No data or logic of their own: page.tsx passes everything in, and
// /design-preview passes fixed sample props (the animation can be frozen at a moment with `freezeMs`).
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type { DemoStage } from "@/lib/ui/demoflow";
import "./demo.css";

export function DemoTopBar({ muted, onMute }: { muted: boolean; onMute?: () => void }) {
  return (
    <header className="dm-top">
      <div className="dm-brand">
        <span className="mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </span>
        <h1 style={{ fontSize: "inherit", fontWeight: 700 }}>Pay Alone</h1>
        <span className="dm-dot" aria-hidden="true">·</span>
        <span>Judge demo</span>
        <span className="dm-dot" aria-hidden="true">·</span>
        <span className="dm-test">Test money only</span>
      </div>
      <div className="dm-actions">
        <button type="button" aria-pressed={muted} onClick={onMute}>{muted ? "🔇 Voice is muted" : "🔊 Mute voice"}</button>
        <Link href="/">← Back to the main app</Link>
      </div>
      <p className="dm-explain">One screen, two people: the shop asks, the customer approves with a PIN or fingerprint, and you watch the money move. Nothing is paid until the customer approves.</p>
    </header>
  );
}

export function DemoWallet({ title, big, lines, address, fine, bump = false, tag = "Test money" }: { title: string; big: string; lines?: string[]; address: string; fine: string; bump?: boolean; tag?: string }) {
  return (
    <section className={`dm-wallet${bump ? " dm-bump" : ""}`} aria-label={title}>
      <p className="dm-wl"><span>{title}</span><span className="dm-tag">{tag}</span></p>
      <p className="dm-big" aria-live="polite">{big}</p>
      {lines?.map((l) => (
        <p key={l} className="dm-line">{l}</p>
      ))}
      <p className="dm-addr">{address}</p>
      <p className="dm-fine">{fine}</p>
    </section>
  );
}

export function DemoHalf({ side, title, persona, children }: { side: "customer" | "shop"; title: string; persona: string; children: ReactNode }) {
  return (
    <section className={`dm-half dm-${side}`} aria-label={side === "customer" ? "Customer side" : "Shop side"}>
      <div className="dm-who">
        <span className="dm-role">{side === "customer" ? "Customer" : "Shop"}</span>
      </div>
      <h2>{title}</h2>
      <p className="dm-persona">{persona}</p>
      {children}
    </section>
  );
}

/**
 * The page: customer, the lane between them, and the shop. On a wide screen the customer is on the left and the shop
 * on the right; on a phone the shop is on top and the customer below. The token travels only while stage is "moving".
 */
export function DemoStageView({ stage, token, screenReader, customer, shop, freezeMs }: { stage: DemoStage; token?: string; screenReader?: string; customer: ReactNode; shop: ReactNode; freezeMs?: number }) {
  const frozen: CSSProperties | undefined = freezeMs === undefined ? undefined : { animationPlayState: "paused", animationDelay: `-${freezeMs}ms` };
  const token_ = stage === "moving" && token && (
    <div className="dm-token" style={frozen}>
      <span>{token.replace(/ →$/, "")}</span>
      <span className="dm-arrow">→</span>
    </div>
  );
  return (
    <div className="dm-stage" data-stage={stage}>
      {/* Wide screens: a band above both cards, so the token never covers a card. */}
      <div className="dm-band" aria-hidden="true">
        <span className="dm-bandlabel">Money moves from the customer to the shop</span>
        {token_}
      </div>
      {customer}
      <div className="dm-lane" aria-hidden="true">
        <div className="dm-laneline" />
        <span className="dm-lanelabel">money</span>
        {token_}
      </div>
      {shop}
      <p className="vh" role="status" aria-live="polite">{screenReader ?? ""}</p>
    </div>
  );
}

export function DemoShopForm(p: {
  shopName: string;
  code: string;
  amount: string;
  note: string;
  error?: string;
  busy?: boolean;
  onShopName?: (v: string) => void;
  onCode?: (v: string) => void;
  onAmount?: (v: string) => void;
  onNote?: (v: string) => void;
  onAsk?: () => void;
}) {
  return (
    <form
      className="card shopform"
      onSubmit={(e) => {
        e.preventDefault();
        p.onAsk?.();
      }}
    >
      <h2>Ask the customer to pay</h2>
      <label htmlFor="dm-shop-name">Shop name</label>
      <input id="dm-shop-name" className="field" autoComplete="organization" maxLength={40} value={p.shopName} onChange={(e) => p.onShopName?.(e.target.value)} placeholder="Mama Put" />
      <label htmlFor="dm-shop-code">Customer&apos;s pay code (filled in for this demo)</label>
      <input id="dm-shop-code" className="field big" inputMode="numeric" autoComplete="off" maxLength={9} value={p.code} onChange={(e) => p.onCode?.(e.target.value)} placeholder="47 29 13" />
      <label htmlFor="dm-shop-amount">Amount (₦)</label>
      <input id="dm-shop-amount" className="field big" inputMode="decimal" autoComplete="off" value={p.amount} onChange={(e) => p.onAmount?.(e.target.value)} placeholder="2,000" />
      <label htmlFor="dm-shop-note">What for (optional)</label>
      <input id="dm-shop-note" className="field" maxLength={60} value={p.note} onChange={(e) => p.onNote?.(e.target.value)} placeholder="Rice and stew" />
      {p.error && <p className="shoperr" role="alert">{p.error}</p>}
      <button type="submit" className="btn primary" disabled={p.busy}>{p.busy ? "Sending…" : "Ask for payment"}</button>
    </form>
  );
}

export function WaitingForRequest() {
  return <p className="dm-idle">No payment request yet. When the shop asks, it appears here and the customer hears it.</p>;
}
