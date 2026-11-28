"use client";
// Dev-only: the whole customer home with FIXED SAMPLE data, for screenshots (/design-preview?view=... and the /demo?mock=1 frames).
// No network, no wallet, no AI. Does not exist in production builds (the pages that use it call notFound()).
import { Bubble, Chip, ListeningBubble, PayCard, PrivacyCard, ReceiptCard, RequestCard, SetupView } from "../ui";
import { ActivityCard, BoardTop, PeopleCard, Rail, SafetyTiles, Sheet, SpentCard, TabBar, VoicePanel, WalletStack } from "../dash";
import { FingerprintIcon } from "../ui";
import { DEMO_CONTACTS } from "@/lib/demo/contacts";
import { leftThisWeek, weekBars, type SummaryReceipt } from "@/lib/ui/summary";
import { nairaOf } from "@/lib/money";
import History, { type HistoryState } from "../History";
import { PayCodeView } from "../ui";
import { HybridStrip } from "../dash";
import { hybridStrip } from "@/lib/hybrid/strip";

export type PreviewState = "idle" | "listening" | "chat" | "request" | "approve" | "pin" | "paid" | "setup" | "settings" | "history" | "unconnected";

const DAY = 86_400_000;
const usd = (value: string) => ({ value, assetCode: "USD", assetScale: 2 });

function sample(now: number) {
  // SAMPLE receipts, dated relative to now so the week chart has bars.
  const r = (daysAgo: number, hour: number, name: string, value: string, simulated: boolean, method: "pin" | "passkey"): SummaryReceipt => {
    const d = new Date(now - daysAgo * DAY);
    d.setHours(hour, 14, 0, 0);
    return { id: `${name}${daysAgo}`, payeeName: name, debit: usd(value), simulated, createdAt: d.toISOString(), method };
  };
  const list = [r(0, 9, "Tunde", "370", false, "passkey"), r(1, 17, "Mama Ade", "880", true, "pin"), r(2, 12, "Chidi Okafor", "630", true, "pin")].filter((x) => Date.parse(x.createdAt) <= now);
  return list;
}

/** SAMPLE hybrid strip states for screenshots: "agree" (Gemini Live + Nano agreed), "checking", "offline" (on-device loop), "rules" (no Nano). */
export type PreviewHybrid = "agree" | "checking" | "offline" | "rules";
function sampleStrip(hy: PreviewHybrid | undefined) {
  const base = { mode: "cloud", liveActive: true, nanoUsable: true, checking: false, offer: false, lastCheck: null } as const;
  if (hy === "agree") return hybridStrip({ ...base, lastCheck: { result: "agree", source: "on_device" } });
  if (hy === "checking") return hybridStrip({ ...base, checking: true });
  if (hy === "offline") return hybridStrip({ ...base, mode: "device", liveActive: false });
  if (hy === "rules") return hybridStrip({ ...base, nanoUsable: false, lastCheck: { result: "unavailable", source: "rules" } });
  return hybridStrip(base);
}

export function PreviewDash({ state = "idle", tab = "home", hy }: { state?: PreviewState; tab?: "home" | "talk"; hy?: PreviewHybrid }) {
  const strip = sampleStrip(hy);
  const now = Date.now();
  const receipts = sample(now);
  const wallet = state === "unconnected" ? null : { connected: true, cap: usd("5000"), interval: `R/${new Date(now - 2 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z")}/P1W` };
  const left = leftThisWeek(wallet, state === "unconnected" ? [] : receipts, now);
  const week = weekBars(state === "unconnected" ? [] : receipts, now, "USD");
  const pct = left.kind === "left" ? Number((BigInt(left.spent.value) * BigInt(100)) / BigInt(left.limit.value)) : null;
  const today = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const quoteDebit = usd("148");
  const histState: HistoryState = { data: { receipts: receipts.map((x) => ({ ...x, method: x.method ?? "pin" })), events: [] }, note: "", busy: false, load: async () => undefined };
  const listening = state === "listening" || state === "chat";
  const sheetTab = state === "settings" ? "settings" : state === "history" ? "activity" : tab;
  return (
    <div className="dash" data-tab={tab}>
      <Rail tab="home" />
      <main className="board" id="top">
        <BoardTop name="" today={today} connected={state !== "unconnected"} onConnect={() => undefined} />
        <section className="row-1">
          <WalletStack name="" payCode="472913" left={left} connected={state !== "unconnected"} onConnect={() => undefined} talkLabel="Talk" />
          <SpentCard week={week} limitPct={pct} />
        </section>
        <section className="row-2">
          <PeopleCard contacts={DEMO_CONTACTS} />
          <ActivityCard receipts={state === "unconnected" ? [] : receipts} />
        </section>
        <SafetyTiles fingerprint={state === "unconnected" ? false : true} limit={wallet?.cap ?? null} payCode="472913" />
      </main>
      <VoicePanel
        mode={listening ? "listening" : "idle"}
        statusLabel={listening ? "Listening" : "Ready"}
        ai={hy === "offline" ? { label: "Offline · AI on this device", tone: "ok" } : { label: "Voice online (Gemini Live) · money checked on this device", tone: "cloud" }}
        strip={strip}
        hint={listening ? "Listening. Press Space to pause" : "Tap to talk"}
        micLabel="Press to talk"
        micOn={listening}
        typed=""
      >
        {state === "idle" || state === "unconnected" || state === "settings" || state === "history" ? (
          <section className="welcome-chat" aria-label="Welcome">
            <ol className="chat"><li className="b ai">Hello. Ask me what is left to spend, who you paid, or tell me who to send money to.</li></ol>
            <ul className="examples" aria-label="Try one of these">
              {["Send 500 naira to Tunde", "What can you do?", "How do you keep my PIN safe?"].map((ex) => (
                <li key={ex}><button type="button" className="example">{ex}</button></li>
              ))}
            </ul>
          </section>
        ) : null}
        {state === "listening" && (
          <ol className="chat" aria-label="Listening">
            <ListeningBubble words="Send five hundred naira to Tu" />
          </ol>
        )}
        {(state === "chat" || state === "approve" || state === "pin") && (
          <ol className="chat" aria-label="Live conversation">
            <Bubble who="app" chip={hy === "offline" ? <Chip source="on_device" /> : <span className="chipstatic tone-cloud"><span aria-hidden="true">🎙</span> Gemini Live (Google, online)</span>}>Hello. What would you like to do?</Bubble>
            <Bubble who="you">Send two thousand naira to Tunde</Bubble>
            <Bubble who="app" chip={<Chip source="rules" />}>Please check the card, then approve with your fingerprint.</Bubble>
          </ol>
        )}
        {state === "request" && (
          <ol className="chat" aria-label="Conversation">
            <Bubble who="app" chip={<Chip source="rules" />}>Mama Put asks you to pay ₦2,000. Say yes to check it, or no to decline.</Bubble>
          </ol>
        )}
      </VoicePanel>
      <TabBar tab={sheetTab} />
      {state === "request" && (
        <Sheet label="Payment request from a shop" bare>
          <RequestCard shopName="Mama Put" amount="₦2,000.00" reference="31" note="Rice and stew" />
        </Sheet>
      )}
      {state === "approve" && (
        <Sheet label="Approve payment" bare>
          <PayCard>
            <p className="amt">$1.48</p>
            <p className="note">about ₦{nairaOf(quoteDebit)}</p>
            <p className="to">to Tunde</p>
            <div className="meta"><span>Fees included</span><span>From the wallet&apos;s quote</span></div>
            <div className="hy-wrap">
              {strip.chip && <p className="hy-chip"><span aria-hidden="true">✓</span> {strip.chip}</p>}
              <HybridStrip strip={strip} />
            </div>
            <div className="stack">
              <button type="button" className="btn primary"><FingerprintIcon /> Approve with fingerprint</button>
              <button type="button" className="btn ghost">Use my PIN instead</button>
              <button type="button" className="btn quiet">Cancel</button>
            </div>
          </PayCard>
        </Sheet>
      )}
      {state === "pin" && (
        <Sheet label="Approve payment" bare>
          <PayCard>
            <p className="amt">$1.48</p>
            <p className="to">to Tunde</p>
            <div className="meta"><span>Fees included</span><span>From the wallet&apos;s quote</span></div>
            <label className="pinlabel" htmlFor="pin-prev">Type your PIN to approve</label>
            <input id="pin-prev" className="pin" type="password" defaultValue="482" readOnly />
            <p className="note">3 digits typed</p>
            <div className="pad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((k) => <button type="button" key={k}>{k === "back" ? "⌫" : k === "clear" ? "C" : k}</button>)}</div>
            <button type="button" className="btn primary">Approve with PIN</button>
          </PayCard>
        </Sheet>
      )}
      {state === "paid" && (
        <Sheet label="Receipt" bare>
          <ReceiptCard amount="$1.48" to="Tunde" how="Approved with fingerprint · saved by the server" simulated={false} onRead={() => undefined} />
        </Sheet>
      )}
      {state === "setup" && (
        <Sheet label="First-time setup" bare>
          <SetupView step="passkey" pin="" count="" message="Now let's add your fingerprint or Windows Hello, so you can approve without typing." />
        </Sheet>
      )}
      {state === "history" && (
        <Sheet label="Your payments" title="Your payments" onClose={() => undefined}>
          <div className="hist"><History h={histState} speak={async () => undefined} /></div>
        </Sheet>
      )}
      {state === "settings" && (
        <Sheet label="Voice and settings" title="Voice and settings" onClose={() => undefined}>
          <div className="settings">
            <PayCodeView code="472913" />
            <PrivacyCard facts={[{ label: "Gemini Nano", value: "available" }, { label: "Speech", value: "on this computer" }, { label: "Voice", value: "natural (on this computer)" }, { label: "Policy", value: "on_device_first" }]} />
          </div>
        </Sheet>
      )}
    </div>
  );
}
