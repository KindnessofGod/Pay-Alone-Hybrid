"use client";
// Screenshot-only page with FIXED SAMPLE DATA. It never calls the wallet, Firebase or an AI.
// It does not exist in production builds.
import { notFound } from "next/navigation";
import { Bubble, Chip, Dock, FingerprintIcon, Header, PayCard, PinStopped, PrivacyCard, ReceiptCard, ReceiptRow, WalletCard } from "../ui";

function Frame({ title, nano, children, hint, listening = false }: { title: string; nano: string; children: React.ReactNode; hint: string; listening?: boolean }) {
  return (
    <section aria-label={title} style={{ border: "1px solid var(--line)", borderRadius: 24, overflow: "hidden", maxWidth: 480, margin: "0 auto 40px" }}>
      <div className="app" style={{ minHeight: 0 }}>
        <Header nano={nano} />
        {children}
        <Dock hint={hint} listening={listening} micLabel="Press to speak" typed="" tab="talk" />
      </div>
    </section>
  );
}

const FACTS = [
  { label: "Gemini Nano", value: "available" },
  { label: "Speech", value: "on this computer" },
  { label: "Voice", value: "natural (on this computer)" },
  { label: "Policy", value: "on_device_first" },
];

function Receipts() {
  return (
    <div className="card hist">
      <section className="chat history" aria-labelledby="history-h">
        <h2 id="history-h" className="h3">Recent receipts</h2>
        <div className="row2">
          <button type="button" className="btn ghost small">Refresh</button>
          <button type="button" className="btn ghost small">🔊 Read my last receipt</button>
        </div>
        <ul className="list" aria-label="Receipts, newest first">
          <ReceiptRow name="Tunde" sub="Today, 9:32 PM · fingerprint" amount="₦500.00" badge="REAL" simulated={false} />
          <ReceiptRow name="Mama Ade" sub="Today, 5:14 PM · PIN" amount="₦1,200.00" badge="SIMULATED" simulated />
        </ul>
      </section>
    </div>
  );
}

function EmptyReceipts() {
  return (
    <div className="card hist">
      <section className="chat history" aria-labelledby="history-h">
        <h2 id="history-h" className="h3">Recent receipts</h2>
        <div className="row2"><button type="button" className="btn ghost small">Show my receipts and activity</button></div>
      </section>
    </div>
  );
}

/** A whole wide-layout screen. Real page uses the same classes at >= 1024px. */
function Desk({ title, nano, empty, turns, side, hint, connected = true }: { title: string; nano: string; empty?: boolean; turns?: React.ReactNode; side: React.ReactNode; hint: string; connected?: boolean }) {
  return (
    <section aria-label={title} className="desk-frame">
      <div className="app desk">
        <Header nano={nano} right={<WalletCard compact connected={connected} onConnect={() => undefined} />} />
        <div className="grid">
          <section className={`convo${empty ? " empty" : ""}`} aria-label="Conversation">
            <div className="scroll">
              {empty ? (
                <section className="welcome" aria-label="Welcome">
                  <p className="serif big">Say who you want to pay.</p>
                  <p className="note">Or ask me anything.</p>
                  <ul className="examples" aria-label="Try one of these">
                    {["Send 500 naira to Tunde", "What can you do?", "How do you keep my PIN safe?"].map((ex) => (
                      <li key={ex}><button type="button" className="example">{ex}</button></li>
                    ))}
                  </ul>
                </section>
              ) : (
                <div className="chat">{turns}</div>
              )}
            </div>
            <Dock desk hint={hint} listening={false} micLabel="Press to speak" typed="" tab="talk" />
          </section>
          <aside className="side" aria-label="Payment, receipts and privacy">{side}</aside>
        </div>
      </div>
    </section>
  );
}

export default function DesignPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <>
      <div className="banner" role="note">Design preview, sample data</div>
      <p className="preview-h">Wide layout (1024px and up). Open this page in a wide window to judge it.</p>
      <p className="preview-h" id="desk-1">D1. Wide: start screen</p>
      <Desk title="Wide start screen" nano="available" empty hint="Tap to start talking" connected={false} side={<><EmptyReceipts /><PrivacyCard facts={FACTS} /></>} />

      <p className="preview-h" id="desk-2">D2. Wide: conversation with a payment awaiting approval</p>
      <Desk
        title="Wide payment"
        nano="available"
        hint={'Approve on the card, or say "no" to cancel'}
        turns={<ol className="chat" aria-label="Conversation">
          <Bubble who="app" chip={<Chip source="on_device" details={<p>Model time: 640 ms</p>} />}>Good afternoon. I&apos;m listening. You can ask me anything, or say who you want to pay.</Bubble>
          <Bubble who="you">Send 500 naira to Tunde</Bubble>
          <Bubble who="app" chip={<Chip source="on_device" />}>Please check the card on the right, then approve with your fingerprint or PIN.</Bubble>
        </ol>}
        side={<>
          <PayCard>
            <p className="amt">₦500.00</p>
            <p className="to">to Tunde</p>
            <div className="meta"><span>Fees included</span><span>From the wallet&apos;s quote</span></div>
            <div className="stack">
              <button type="button" className="btn primary"><FingerprintIcon /> Approve with fingerprint</button>
              <button type="button" className="btn ghost">Use my PIN instead</button>
              <button type="button" className="btn quiet">Cancel</button>
            </div>
          </PayCard>
          <Receipts />
          <PrivacyCard facts={FACTS} />
        </>}
      />

      <p className="preview-h" id="desk-3">D3. Wide: paid receipt and receipts list</p>
      <Desk
        title="Wide paid"
        nano="available"
        hint="Tap and speak"
        turns={<ol className="chat" aria-label="Conversation">
          <Bubble who="you">Send 500 naira to Tunde</Bubble>
          <Bubble who="app" chip={<Chip source="on_device" />}>Done. 500 naira sent to Tunde.</Bubble>
        </ol>}
        side={<>
          <ReceiptCard amount="₦500.00" to="Tunde" how="Approved with fingerprint · 9:32 PM · saved by the server" simulated={false} onRead={() => undefined} />
          <Receipts />
          <PrivacyCard facts={FACTS} />
        </>}
      />

      <p className="preview-h">1. Start screen</p>
      <Frame title="Start screen" nano="checking" hint="Tap to start talking">
        <div className="panel-body">
          <WalletCard onConnect={() => undefined} />
          <section className="welcome" aria-label="Welcome">
            <p className="serif big">Say who you want to pay.</p>
            <p className="note">Or ask me anything.</p>
            <ul className="examples" aria-label="Try one of these">
              {["Send 500 naira to Tunde", "What can you do?", "How do you keep my PIN safe?"].map((ex) => (
                <li key={ex}><button type="button" className="example">{ex}</button></li>
              ))}
            </ul>
          </section>
        </div>
      </Frame>

      <p className="preview-h">2. On-device answer and a payment awaiting approval</p>
      <Frame title="Chat and payment" nano="available" hint={'Approve on the card, or say "no" to cancel'}>
        <div className="panel-body">
          <WalletCard connected />
          <ol className="chat" aria-label="Conversation">
            <Bubble who="app" chip={<Chip source="on_device" details={<p>Model time: 640 ms</p>} />}>Good afternoon. I&apos;m listening. You can ask me anything, or say who you want to pay.</Bubble>
            <Bubble who="you">Send 500 naira to Tunde</Bubble>
          </ol>
          <PayCard>
            <p className="amt">₦500.00</p>
            <p className="to">to Tunde</p>
            <div className="meta"><span>Fees included</span><span>From the wallet&apos;s quote</span></div>
            <div className="stack">
              <button type="button" className="btn primary"><FingerprintIcon /> Approve with fingerprint</button>
              <button type="button" className="btn ghost">Use my PIN instead</button>
              <button type="button" className="btn quiet">Cancel</button>
            </div>
          </PayCard>
        </div>
      </Frame>

      <p className="preview-h">3. Cloud answer, chip expanded</p>
      <Frame title="Cloud answer" nano="unavailable" hint="Tap and speak">
        <div className="panel-body">
          <ol className="chat" aria-label="Conversation">
            <Bubble who="you">What does a fingerprint approval protect me from?</Bubble>
            <li className="b ai">
              It means only you can approve a payment. Even if someone hears you speaking, they can&apos;t send money without your finger or your PIN.
              <details className="chipwrap" open>
                <summary className="tone-cloud"><span aria-hidden="true">☁</span> Answered online · names and amounts hidden</summary>
                <div className="details">
                  <p>What the cloud received: <code>What does a fingerprint approval protect me from?</code></p>
                  <p>Model time: 1180 ms</p>
                </div>
              </details>
            </li>
          </ol>
        </div>
      </Frame>

      <p className="preview-h">4. PIN tripwire</p>
      <Frame title="PIN tripwire" nano="available" hint="Tap and speak">
        <div className="panel-body">
          <ol className="chat" aria-label="Conversation">
            <Bubble who="you">(deleted)</Bubble>
            <PinStopped />
            <Bubble who="app" chip={<Chip source="rules" />}>Never say your PIN out loud. Type it on the keys.</Bubble>
          </ol>
        </div>
      </Frame>

      <p className="preview-h">5. Paid receipt and receipt list</p>
      <Frame title="Paid" nano="available" hint="Tap and speak">
        <div className="panel-body">
          <ReceiptCard amount="₦500.00" to="Tunde" how="Approved with fingerprint · 9:32 PM · saved by the server" simulated={false} onRead={() => undefined} />
          <h2 className="h3">Recent receipts</h2>
          <ul className="list" aria-label="Receipts, newest first">
            <ReceiptRow name="Tunde" sub="Today, 9:32 PM · fingerprint" amount="₦500.00" badge="REAL" simulated={false} />
            <ReceiptRow name="Mama Ade" sub="Today, 5:14 PM · PIN" amount="₦1,200.00" badge="SIMULATED" simulated />
          </ul>
        </div>
      </Frame>
    </>
  );
}
