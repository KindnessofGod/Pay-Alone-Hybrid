// Presentational pieces of the shop page, in the look of the original seller screen. No data and no logic of their own:
// page.tsx passes everything in, and /design-preview passes fixed sample props.
import Link from "next/link";
import type { ReactNode } from "react";
import type { ShopTone } from "@/lib/ui/requestprompt";
import { formatPayCode } from "@/lib/ui/requestprompt";
import { digitsOf } from "@/lib/ui/recents";
import { Icon } from "../icons";

export function ShopShell({ children }: { children: ReactNode }) {
  return (
    <div className="shop">
      <header className="appbar">
        <div className="appbar-inner">
          <Link href="/" className="appbar-back" aria-label="Back to the customer app">
            <Icon name="back" size={22} />
          </Link>
          <span className="brand">
            <span className="brand-mark" aria-hidden="true"><Icon name="shield" size={20} /></span>
            Pay Alone
          </span>
          <span className="role-pill">Seller</span>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

/** Six big boxes for the customer's pay code. One real input sits on top (transparent), so typing, paste and screen readers work as usual. */
function CodeBoxes({ value, onChange }: { value: string; onChange?: (digits: string) => void }) {
  const d = digitsOf(value).slice(0, 6);
  return (
    <div className="digits">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`dbox${d[i] ? "" : " empty"}${i === Math.min(d.length, 5) ? " cur" : ""}`} aria-hidden="true">{d[i] ?? "0"}</span>
      ))}
      <input id="shop-code" inputMode="numeric" autoComplete="off" maxLength={9} value={d} aria-label="Customer pay code, 6 digits" onChange={(e) => onChange?.(digitsOf(e.target.value).slice(0, 6))} />
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
  hideNote?: boolean;
  recents?: string[];
  onShopName?: (v: string) => void;
  onCode?: (v: string) => void;
  onAmount?: (v: string) => void;
  onNote?: (v: string) => void;
  onAsk?: () => void;
}) {
  return (
    <form
      className="shopform"
      onSubmit={(e) => {
        e.preventDefault();
        p.onAsk?.();
      }}
    >
      <label className="vh" htmlFor="shop-name">Shop name</label>
      <input id="shop-name" className="shopname" autoComplete="organization" maxLength={40} value={p.shopName} onChange={(e) => p.onShopName?.(e.target.value)} placeholder="Your shop name" />
      {!p.hideNote && (
        <p className="shopsub">Test shop wallet: in this demo every shop is paid into one shared test receiving wallet. Test money only. Open this page on a different device or browser from the customer&apos;s.</p>
      )}
      <section className="askcard" aria-labelledby="ask-h">
        <h2 id="ask-h"><span className="card-icon" aria-hidden="true"><Icon name="shop" size={22} /></span> Ask a customer to pay</h2>
        <label htmlFor="shop-code">Customer pay code</label>
        <CodeBoxes value={p.code} onChange={p.onCode} />
        {p.recents && p.recents.length > 0 && (
          <>
            <p className="fieldlabel" id="recent-h">Recent customers</p>
            <div className="recent" role="group" aria-labelledby="recent-h">
              {p.recents.map((c) => (
                <button key={c} type="button" className="rchip" onClick={() => p.onCode?.(c)}>{formatPayCode(c)}</button>
              ))}
            </div>
          </>
        )}
        <label htmlFor="shop-amount">Amount</label>
        <div className="money-input">
          <span aria-hidden="true">₦</span>
          <input id="shop-amount" inputMode="decimal" autoComplete="off" value={p.amount} onChange={(e) => p.onAmount?.(e.target.value)} placeholder="2,000" aria-label="Amount in naira" />
        </div>
        {!p.hideNote && (
          <>
            <label htmlFor="shop-note">What for (optional)</label>
            <input id="shop-note" className="field" maxLength={60} value={p.note} onChange={(e) => p.onNote?.(e.target.value)} placeholder="Rice and stew" />
          </>
        )}
        {p.error && <p className="shoperr" role="alert">{p.error}</p>}
        <button type="submit" className="btn seller" disabled={p.busy}>{p.busy ? "Sending…" : "Ask for payment"}</button>
      </section>
    </form>
  );
}

export function ShopStatus({ tone, headline, sub, shop, onNew }: { tone: ShopTone; headline: string; sub: string; shop: string; onNew?: () => void }) {
  return (
    <section className={`shopstatus s-${tone}`} aria-label="Payment status">
      <p className="label">{shop}</p>
      <span className="sicon" aria-hidden="true"><Icon name={tone === "good" ? "check" : tone === "bad" ? "cross" : "clock"} size={34} /></span>
      <div role="status" aria-live="assertive">
        <p className="headline">{headline}</p>
        <p className="sub">{sub}</p>
      </div>
      {tone !== "wait" && (
        <button type="button" className="btn ghost" onClick={onNew}>New request</button>
      )}
    </section>
  );
}
