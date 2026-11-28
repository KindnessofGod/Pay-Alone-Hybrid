// Presentational pieces of the screen. No logic and no data of their own: the page and Approve pass
// everything in, and /design-preview passes fixed sample props.
import type { ReactNode, Ref } from "react";
import { aiPill, sourceChip } from "@/lib/ui/status";

export function FingerprintIcon({ color = "#1A1400" }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 11v3M8 9a4 4 0 0 1 8 0v4M5 12V9a7 7 0 0 1 14 0v3M9 16c.5 2 1.5 3.5 3 5M15 15c0 2-.5 4-1.5 5.5" />
    </svg>
  );
}

export function Header({ nano }: { nano: string }) {
  const p = aiPill(nano);
  return (
    <header>
      <div className="logo">
        <div className="mark" aria-hidden="true">₦</div>
        <h1>Pay Alone</h1>
      </div>
      <div className={`pill tone-${p.tone}`} role="status">
        <span className="dot" aria-hidden="true" />
        {p.label}
      </div>
    </header>
  );
}

export function WalletCard({ note, connected, children }: { note?: string; connected?: boolean; children?: ReactNode }) {
  return (
    <section className="wallet" aria-label="Wallet">
      <small>{connected ? "Test wallet connected" : "Test wallet"}</small>
      <b>Weekly limit set on your wallet&apos;s consent page</b>
      {note && <p>{note}</p>}
      {children}
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
}) {
  return (
    <div className="dock">
      <button type="button" className="mic" aria-pressed={listening} aria-label={micLabel} onClick={onMic}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#1A1400" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      <p className="hint" aria-live="polite">{hint}</p>
      <div className="type">
        <input ref={inputRef} aria-label="Or type what you want to do" placeholder="Or type: send 5000 naira to Mama Ade" value={typed} onChange={(e) => onTyped?.(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit?.()} />
        <button type="button" onClick={() => onSubmit?.()}>Go</button>
      </div>
      <div className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => onTab?.(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="sim-line">Test money only. Test contacts are simulated.</p>
    </div>
  );
}
