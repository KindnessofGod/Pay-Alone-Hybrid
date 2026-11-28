// Presentational pieces of the shop page. No data and no logic of their own: page.tsx passes everything in,
// and /design-preview passes fixed sample props.
import type { ReactNode } from "react";
import type { ShopTone } from "@/lib/ui/requestprompt";

export function ShopShell({ children }: { children: ReactNode }) {
  return (
    <div className="shop">
      <header>
        <div className="logo">
          <div className="mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 9l1.5-5h13L20 9M4 9h16M4 9v11h16V9M9 20v-6h6v6" /></svg>
          </div>
          <h1>Pay alone.</h1>
        </div>
        <span className="pill tone-rules">Shop</span>
      </header>
      <main>{children}</main>
    </div>
  );
}

export function ShopForm(p: {
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
      <h2>Ask a customer to pay</h2>
      <label htmlFor="shop-name">Shop name</label>
      <input id="shop-name" className="field" autoComplete="organization" maxLength={40} value={p.shopName} onChange={(e) => p.onShopName?.(e.target.value)} placeholder="Mama Put" />
      <label htmlFor="shop-code">Customer&apos;s pay code</label>
      <input id="shop-code" className="field big" inputMode="numeric" autoComplete="off" maxLength={9} value={p.code} onChange={(e) => p.onCode?.(e.target.value)} placeholder="47 29 13" />
      <label htmlFor="shop-amount">Amount (₦)</label>
      <input id="shop-amount" className="field big" inputMode="decimal" autoComplete="off" value={p.amount} onChange={(e) => p.onAmount?.(e.target.value)} placeholder="2,000" />
      <label htmlFor="shop-note">What for (optional)</label>
      <input id="shop-note" className="field" maxLength={60} value={p.note} onChange={(e) => p.onNote?.(e.target.value)} placeholder="Rice and stew" />
      {p.error && <p className="shoperr" role="alert">{p.error}</p>}
      <button type="submit" className="btn primary" disabled={p.busy}>{p.busy ? "Sending…" : "Ask for payment"}</button>
      <p className="note">
        <b>Test shop wallet.</b> In this demo every shop is paid into the app&apos;s one shared test receiving wallet, whatever the shop name. Test money only. Open this page on a different device or browser from the customer&apos;s.
      </p>
    </form>
  );
}

export function ShopStatus({ tone, headline, sub, shop, onNew }: { tone: ShopTone; headline: string; sub: string; shop: string; onNew?: () => void }) {
  return (
    <section className={`card shopstatus s-${tone}`} aria-label="Payment status">
      <p className="label">{shop}</p>
      <div role="status" aria-live="assertive">
        <p className="headline">
          <span className="sicon" aria-hidden="true">{tone === "good" ? "✓" : tone === "bad" ? "✕" : "…"}</span> {headline}
        </p>
        <p className="sub">{sub}</p>
      </div>
      {tone !== "wait" && (
        <button type="button" className="btn ghost" onClick={onNew}>New request</button>
      )}
    </section>
  );
}
