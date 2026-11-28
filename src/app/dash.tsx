// The customer home screen in the original Pay Alone look: dark icon rail, board of cards, lit voice panel.
// Presentational only: page.tsx passes real data in, /design-preview passes fixed SAMPLE props.
import type { Strip } from "@/lib/hybrid/strip";
import { useEffect, type ReactNode, type Ref } from "react";
import { bigAmount } from "@/lib/ui/amountview";
import { type Amount } from "@/lib/money";
import { formatPayCode } from "@/lib/ui/requestprompt";
import type { LeftView, SummaryReceipt, WeekBars } from "@/lib/ui/summary";
import { reportEvent } from "@/lib/firebase/client";
import { Avatar, Icon } from "./icons";
import { GlassOrb, type OrbMode } from "./GlassOrb";

export type Tab = "home" | "talk" | "activity" | "settings";

/** "$31.20" as a small symbol, then the figure, like the original's big serif amount. */
export function Money({ a, size = "lg" }: { a: Amount; size?: "lg" | "xl" }) {
  const text = bigAmount(a);
  const m = /^([^\d]+)(.*)$/.exec(text);
  const sym = m && m[1].trim().length <= 2 ? m[1] : "";
  const num = sym ? m![2] : text;
  return (
    <span className={`money ${size}`}>
      <span className="vh">{text}</span>
      <span aria-hidden="true">
        {sym && <sup>{sym}</sup>}
        {num}
      </span>
    </span>
  );
}

const symbolOf = (code: string) => (code === "NGN" ? "₦" : code === "USD" ? "$" : code.slice(0, 1));

export function Rail({ onTalk, onTab, onSettings, tab }: { onTalk?: () => void; onTab?: (t: Tab) => void; onSettings?: () => void; tab: Tab }) {
  return (
    <aside className="rail" aria-label="Main">
      <span className="rail-logo" aria-hidden="true"><Icon name="shield" size={22} /></span>
      <button type="button" className={`rail-btn${tab === "home" ? " on" : ""}`} aria-label="Home" onClick={() => onTab?.("home")}><Icon name="home" /></button>
      <button type="button" className="rail-btn" aria-label="Talk to Pay Alone" onClick={onTalk}><Icon name="mic" /></button>
      <button type="button" className="rail-btn" aria-label="Your payments" onClick={() => document.getElementById("payments")?.scrollIntoView?.({ behavior: "smooth", block: "start" })}><Icon name="list" /></button>
      <button type="button" className="rail-btn" aria-label="Your pay code" onClick={() => document.getElementById("code")?.scrollIntoView?.({ behavior: "smooth", block: "start" })}><Icon name="code" /></button>
      <button type="button" className="rail-btn" aria-label="Privacy and limit" onClick={() => document.getElementById("safety")?.scrollIntoView?.({ behavior: "smooth", block: "start" })}><Icon name="shield" /></button>
      <button type="button" className="rail-btn" aria-label="Voice and settings" onClick={onSettings}><Icon name="gear" /></button>
      <span className="rail-me"><Avatar name="you" size={46} self /></span>
    </aside>
  );
}

export function TabBar({ tab, onTab }: { tab: Tab; onTab?: (t: Tab) => void }) {
  const t = (id: Tab, label: string, icon: "home" | "mic" | "list" | "gear") => (
    <button type="button" className={`dock-btn${tab === id ? " on" : ""}`} aria-label={label} aria-current={tab === id ? "page" : undefined} onClick={() => (id !== tab && reportEvent({ event: "tab_switch", tab: id === "activity" ? "receipts" : id === "settings" ? "privacy" : "talk" }), onTab?.(id))}>
      <Icon name={icon} size={24} />
    </button>
  );
  return (
    <nav className="tabdock" aria-label="Sections">
      {t("home", "Home", "home")}
      {t("talk", "Talk to Pay Alone", "mic")}
      {t("activity", "Your payments", "list")}
      {t("settings", "Voice and settings", "gear")}
    </nav>
  );
}

export function BoardTop({ name, today, connected, onConnect, onSettings }: { name: string; today: string; connected: boolean; onConnect?: () => void; onSettings?: () => void }) {
  return (
    <header className="board-top">
      <div>
        <p className="hi">Hi {name || "there"},</p>
        <h1 className="welcome">Welcome back!</h1>
        <p className="sub">{today}</p>
      </div>
      <div className="top-actions">
        {connected ? (
          <span className="chip-soft" role="status"><span className="live-dot" aria-hidden="true" /> Test wallet connected</span>
        ) : onConnect ? (
          <button type="button" className="chip-soft chip-btn" onClick={onConnect}><span className="live-dot off" aria-hidden="true" /> Connect your test wallet</button>
        ) : (
          <span className="chip-soft" role="status"><span className="live-dot off" aria-hidden="true" /> Test wallet not connected</span>
        )}
        <button type="button" className="round" aria-label="Voice and settings" onClick={onSettings}><Icon name="gear" /></button>
      </div>
    </header>
  );
}

export function WalletStack({ name, payCode, left, connected, onConnect, onSayCode, onSayLeft, onTalk, talkLabel, talkBusy, note, children }: {
  name: string;
  payCode: string | null;
  left: LeftView;
  connected: boolean;
  onConnect?: () => void;
  onSayCode?: () => void;
  onSayLeft?: () => void;
  onTalk?: () => void;
  talkLabel: string;
  talkBusy?: boolean;
  note?: string;
  children?: ReactNode;
}) {
  const cur = left.kind === "left" ? left.limit.assetCode : "USD";
  return (
    <div className="wallet-stack" aria-label="Your wallet">
      <div className="stack-top">
        <div className="stack-row">
          <span>{name || "Your wallet"}</span>
          <span className="op-mark">Open Payments</span>
        </div>
        <div className="stack-row strong">
          <span>Pay code&nbsp;&nbsp;{payCode ? formatPayCode(payCode) : "…"}</span>
          <button type="button" className="qr-chip" onClick={onSayCode} disabled={!payCode} aria-label="Say my pay code aloud"><Icon name="speaker" size={16} /> Say</button>
          <span className="cur-mark">{cur}</span>
        </div>
      </div>
      <div className="stack-body">
        <span className="notch" aria-hidden="true" />
        <div className="frame" aria-live="polite">
          <span className="coin" aria-hidden="true">{symbolOf(cur)}</span>
          {left.kind === "left" ? (
            <>
              <Money a={left.left} size="xl" />
              <span className="frame-label">Left to spend this week, of {bigAmount(left.limit)}</span>
              <span className="frame-bar" role="img" aria-label={`${left.leftPct} percent of this week's limit is left`}>
                <span style={{ width: `${left.leftPct}%` }} />
              </span>
            </>
          ) : (
            <>
              <span className="money md">Connect your test wallet</span>
              <span className="frame-label">{note || "Set your weekly limit once, on your wallet's own page."}</span>
              {onConnect && !connected && (
                <button type="button" className="connect-btn" onClick={onConnect}>Connect your test wallet</button>
              )}
            </>
          )}
        </div>
        {children}
        <div className="pill-row">
          <button type="button" className="pill ghost" onClick={onSayLeft}><Icon name="speaker" size={20} /> Say it aloud</button>
          <button type="button" className="pill solid" onClick={onTalk} disabled={talkBusy}><Icon name="mic" size={20} /> {talkLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function SpentCard({ week, limitPct }: { week: WeekBars; limitPct: number | null }) {
  const max = week.days.some((d) => d.heightPct > 0);
  return (
    <div className="card chart-card">
      <div className="card-top">
        <span className="chip-coin" aria-hidden="true">{symbolOf(week.total.assetCode)}</span>
        <b>Spent this week</b>
        {limitPct !== null && <span className="pct">{limitPct}%</span>}
      </div>
      <Money a={week.total} size="lg" />
      <span className="muted">{week.paid === 0 ? "No payments yet" : `${week.paid} paid`} · from your saved receipts</span>
      <div className="bars" role="img" aria-label={max ? "Spending by day this week" : "No spending yet this week"}>
        {week.days.map((d) => (
          <span key={d.label} className={`bar${d.today ? " today" : ""}`}>
            <span className="bar-col"><span className="bar-fill" style={{ height: `${Math.max(d.heightPct, 4)}%` }} /></span>
            <span className="bar-d">{d.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function PeopleCard({ contacts, onSend }: { contacts: readonly { id: string; name: string }[]; onSend?: () => void }) {
  return (
    <div className="card" id="people">
      <div className="card-head2"><b>People you pay</b><span className="muted tiny">Test contacts · simulated</span></div>
      <div className="people">
        {contacts.slice(0, 3).map((c) => (
          <div key={c.id} className="person">
            <Avatar name={c.name} size={56} />
            <b>{c.name}</b>
            <span>Saved contact</span>
          </div>
        ))}
        <button type="button" className="person add" onClick={onSend} aria-label="Send money by voice">
          <span className="add-btn" aria-hidden="true">+</span>
          <b>Send</b>
          <span>By voice</span>
        </button>
      </div>
    </div>
  );
}

export function ActivityCard({ receipts, onAll }: { receipts: SummaryReceipt[] | null; onAll?: () => void }) {
  return (
    <div className="card" id="payments">
      <div className="card-head2">
        <b>Recent activity</b>
        <button type="button" className="link" onClick={onAll}>History</button>
      </div>
      {receipts === null ? (
        <p className="muted">Your receipts show here after you start.</p>
      ) : receipts.length === 0 ? (
        <p className="muted">No payments yet.</p>
      ) : (
        <ol className="activity" aria-label="Receipts, newest first">
          {receipts.slice(0, 3).map((r) => (
            <li key={r.id}>
              <Avatar name={r.payeeName} size={44} />
              <span className="act-text">
                <b>{r.payeeName}</b>
                <span>
                  {new Date(r.createdAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} · {r.method === "passkey" ? "fingerprint" : "PIN"}{" "}
                  <span className={`tag ${r.simulated ? "sim" : ""}`}>{r.simulated ? "SIMULATED" : "REAL"}</span>
                </span>
              </span>
              <span className="act-amt"><span className="vh">paid </span>−{bigAmount(r.debit)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function SafetyTiles({ fingerprint, limit, payCode, onSayCode }: { fingerprint: boolean | null; limit: Amount | null; payCode: string | null; onSayCode?: () => void }) {
  return (
    <section className="row-3" id="safety" aria-label="Safety">
      <div className="safe">
        <span className="safe-ic"><Icon name="finger" /></span>
        <span>
          <b>{fingerprint === null ? "Fingerprint" : fingerprint ? "Fingerprint on" : "Fingerprint not set up"}</b>
          <span>{fingerprint === null ? "Shown after you start" : fingerprint ? "Approve each payment with your finger" : "You can add it when you pay"}</span>
        </span>
      </div>
      <div className="safe">
        <span className="safe-ic"><Icon name="shield" /></span>
        <span>
          <b>{limit ? "Limit set by your wallet" : "No limit yet"}</b>
          <span>{limit ? `${bigAmount(limit)} a week; it refuses more` : "Connect your test wallet to set one"}</span>
        </span>
      </div>
      <button type="button" className="safe safe-btn" id="code" onClick={onSayCode} disabled={!payCode}>
        <span className="safe-ic"><Icon name="code" /></span>
        <span>
          <b>Your pay code</b>
          <span>{payCode ? `${formatPayCode(payCode)} · a shop types it to ask you` : "Loading…"}</span>
        </span>
      </button>
    </section>
  );
}

/** The lit voice panel: orb, conversation, status, and the big lime mic. `children` is the conversation list. */
/** Which part of the app works where: two small rows that light up while they work. Facts only (src/lib/hybrid/strip.ts). */
export function HybridStrip({ strip, onRestore }: { strip: Strip; onRestore?: () => void }) {
  const row = (r: Strip["voice"]) => (
    <li className={r.lit ? "on" : ""}>
      <span className="hy-dot" aria-hidden="true" />
      <span className="hy-l">{r.label}</span>
      <span className="hy-e">{r.engine} · {r.where}</span>
    </li>
  );
  return (
    <div className="hy" role="group" aria-label="How this is working">
      <ul>
        {row(strip.voice)}
        {strip.voice.where === "cloud" ? row(strip.money) : null}
      </ul>
      {strip.offer && onRestore && (
        <button type="button" className="hy-back" onClick={onRestore}>Back online. Use Gemini Live</button>
      )}
    </div>
  );
}

export function VoicePanel({ mode, statusLabel, ai, strip, onRestore, children, hint, micLabel, micOn, onMic, typed, onTyped, onSubmit, inputRef, className = "" }: {
  mode: OrbMode;
  statusLabel: string;
  ai: { label: string; tone: string };
  strip?: Strip;
  onRestore?: () => void;
  children?: ReactNode;
  hint: string;
  micLabel: string;
  micOn: boolean;
  onMic?: () => void;
  typed: string;
  onTyped?: (v: string) => void;
  onSubmit?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  return (
    <aside className={`voice-panel ${className}`} aria-label="Talk to Pay Alone">
      <header className="vp-top">
        <span>
          <b>Pay Alone</b>
          <span className={`vp-status ${mode}`} role="status">{statusLabel}</span>
        </span>
      </header>
      <div className="vp-stage">
        <span className="vp-arc a1" />
        <span className="vp-arc a2" />
        <GlassOrb mode={mode} size="min(15rem, 50vw)" />
      </div>
      <div className="vp-talk-wrap">{children}</div>
      <div className="vp-dock">
        <span className="vp-tip" aria-live="polite">{hint}</span>
        <button type="button" className={`vp-mic ${mode}`} aria-pressed={micOn} aria-label={micLabel} onClick={onMic}>
          <span className="rp" /><span className="rp r2" /><span className="rp r3" />
          <span className="vp-mic-core"><Icon name="mic" size={30} /></span>
        </button>
        <div className="vp-type">
          <input ref={inputRef} aria-label="Or type what you want to do" placeholder="Or type here" value={typed} onChange={(e) => onTyped?.(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit?.()} />
          <button type="button" onClick={() => onSubmit?.()}>Go</button>
        </div>
        {strip ? <HybridStrip strip={strip} onRestore={onRestore} /> : null}
        <p className={`vp-ai tone-${ai.tone}`}>{ai.label}</p>
      </div>
    </aside>
  );
}


/**
 * A sheet over the board (the original's .sheet). On a wide screen it leaves the voice panel visible beside it.
 * `bare` is for the payment, request and setup cards, which bring their own buttons and their own Escape key.
 */
export function Sheet({ label, title, onClose, bare = false, children }: { label: string; title?: string; onClose?: () => void; bare?: boolean; children: ReactNode }) {
  useEffect(() => {
    if (bare || !onClose) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [bare, onClose]);
  return (
    <div className={`sheet-back${bare ? " bare" : ""}`} onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        {title && (
          <div className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="round" aria-label="Close" onClick={onClose}><Icon name="cross" size={18} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
