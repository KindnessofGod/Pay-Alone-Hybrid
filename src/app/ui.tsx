// Presentational pieces of the screen. No logic and no data of their own: the page and Approve pass
// everything in, and /design-preview passes fixed sample props.
import type { ReactNode, Ref } from "react";
import { aiPill, sourceChip } from "@/lib/ui/status";

export function FingerprintIcon({ color = "#ffffff" }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 11v3M8 9a4 4 0 0 1 8 0v4M5 12V9a7 7 0 0 1 14 0v3M9 16c.5 2 1.5 3.5 3 5M15 15c0 2-.5 4-1.5 5.5" />
    </svg>
  );
}

export function Header({ nano, right }: { nano: string; right?: ReactNode }) {
  const p = aiPill(nano);
  return (
    <header>
      <div className="logo">
        <div className="mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </div>
        <h1>Pay alone.</h1>
      </div>
      <div className="hdr-right">
        <div className={`pill tone-${p.tone}`} role="status">
          <span className="dot" aria-hidden="true" />
          {p.label}
        </div>
        {right}
      </div>
    </header>
  );
}

export function WalletCard({ note, connected, onConnect, children, compact = false }: { note?: string; connected?: boolean; onConnect?: () => void; children?: ReactNode; compact?: boolean }) {
  return (
    <section className={compact ? "wallet chipbar" : "wallet"} aria-label="Wallet">
      {connected ? (
        <>
          <b><span aria-hidden="true">✓</span> Test wallet connected</b>
          {!compact && <small>Your weekly limit protects you</small>}
        </>
      ) : onConnect ? (
        <button type="button" className="walletbtn" onClick={onConnect}>
          Connect your test wallet
        </button>
      ) : (
        <b>Test wallet</b>
      )}
      {note && <p>{note}</p>}
      {children}
    </section>
  );
}

/** Desktop privacy card: three short promises, then the live technical status. */
export function PrivacyCard({ facts }: { facts: { label: string; value: string }[] }) {
  const rows: { icon: ReactNode; text: string }[] = [
    { icon: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3zM9 12l2 2 4-4" />, text: "AI never moves your money" },
    { icon: <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6zM12 15v2" />, text: "Your PIN is never heard by AI" },
    { icon: <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM4 4l16 16" />, text: "Names and amounts stay hidden online" },
  ];
  return (
    <section className="card privacy" aria-labelledby="privacy-h">
      <h2 id="privacy-h">Your privacy</h2>
      <ul className="promises">
        {rows.map((r) => (
          <li key={r.text}>
            <span className="ico" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{r.icon}</svg>
            </span>
            {r.text}
          </li>
        ))}
      </ul>
      <p className="techline">{facts.map((f) => `${f.label}: ${f.value}`).join(" · ")}</p>
      <p className="techline">Test money only. Test contacts are simulated.</p>
    </section>
  );
}

/** Small chip under an AI bubble. With details it opens to show what was sent and how long it took. */
export function Chip({ source, details }: { source: "on_device" | "cloud" | "rules"; details?: ReactNode }) {
  const c = sourceChip(source);
  if (!details) {
    return (
      <span className={`chipstatic tone-${c.tone}`}>
        <span aria-hidden="true">{c.icon}</span> {c.label}
      </span>
    );
  }
  return (
    <details className="chipwrap">
      <summary className={`tone-${c.tone}`}>
        <span aria-hidden="true">{c.icon}</span> {c.label}
      </summary>
      <div className="details">{details}</div>
    </details>
  );
}

export function Bubble({ who, children, chip }: { who: "you" | "app"; children: ReactNode; chip?: ReactNode }) {
  return (
    <li className={`b ${who === "you" ? "me" : "ai"}`}>
      <span className="vh">{who === "you" ? "You: " : "Pay Alone: "}</span>
      {children}
      {chip}
    </li>
  );
}

export function PinStopped() {
  return (
    <li className="b bad-bubble" role="alert">
      PIN stopped before any AI saw it
    </li>
  );
}

/** The payment card. Approve passes the server's read-back as `message`; the preview passes sample amount text. */
export function PayCard({ children, label = "Please check this payment" }: { children: ReactNode; label?: string }) {
  return (
    <section className="pay approve" aria-label="Approve payment">
      <p className="label">{label}</p>
      {children}
    </section>
  );
}

export function ReceiptCard({
  amount,
  to,
  how,
  simulated,
  onRead,
}: {
  amount: string;
  to: string;
  how?: string;
  simulated: boolean;
  onRead?: () => void;
}) {
  return (
    <section className="done" aria-label="Receipt">
      <div className="check" aria-hidden="true">✓</div>
      <p className="paid">Paid</p>
      <p className="amt">{amount}</p>
      <p className="to">to {to}</p>
      {how && <p className="sub">{how}</p>}
      <span className={`badge ${simulated ? "sim" : ""}`}>{simulated ? "SIMULATED: no real money moved" : "REAL TEST-WALLET PAYMENT"}</span>
      {onRead && (
        <button type="button" className="btn ghost" onClick={onRead}>
          <span aria-hidden="true">🔊</span> Read my receipt
        </button>
      )}
    </section>
  );
}

export function ReceiptRow({ name, sub, amount, badge, simulated }: { name: string; sub: string; amount: string; badge: string; simulated: boolean }) {
  return (
    <li className="r">
      <div>
        <b>{name}</b>
        <small>{sub}</small>
      </div>
      <div className="amtr">
        <span>{amount}</span>
        <span className={`tag ${simulated ? "sim" : ""}`}>{badge}</span>
      </div>
    </li>
  );
}

export type Tab = "talk" | "receipts" | "privacy";
const TABS: { id: Tab; label: string }[] = [
  { id: "talk", label: "Talk" },
  { id: "receipts", label: "Receipts" },
  { id: "privacy", label: "Privacy" },
];

export function Dock({
  hint,
  listening,
  micLabel,
  onMic,
  typed,
  onTyped,
  onSubmit,
  inputRef,
  tab,
  onTab,
  desk = false,
}: {
  hint: string;
  listening: boolean;
  micLabel: string;
  onMic?: () => void;
  typed: string;
  onTyped?: (v: string) => void;
  onSubmit?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  tab: Tab;
  onTab?: (t: Tab) => void;
  desk?: boolean;
}) {
  return (
    <div className="dock">
      <button type="button" className="mic" aria-pressed={listening} aria-label={micLabel} onClick={onMic}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#c3e88f" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      <p className="hint" aria-live="polite">{hint}</p>
      <div className="type">
        <input ref={inputRef} aria-label="Or type what you want to do" placeholder="Or type here" value={typed} onChange={(e) => onTyped?.(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit?.()} />
        <button type="button" onClick={() => onSubmit?.()}>Go</button>
      </div>
      {!desk && (
        <>
          <div className="tabs" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => onTab?.(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="sim-line">Test money only</p>
        </>
      )}
    </div>
  );
}
