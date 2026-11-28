"use client";
// The voice screen: header, wallet, conversation, and a sticky dock with the big mic. Everything is also
// spoken, and works with a screen reader and with the keyboard only (Space to talk).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { understand, type Policy, type Understood } from "@/lib/hybrid/understand";
import type { Contact } from "@/lib/hybrid/crosscheck";
import { nanoAvailability } from "@/lib/hybrid/device";
import { installLocalSpeech, listenOnce, localSpeechStatus, say, SpeechError, speechErrorInfo, stopListening } from "@/lib/hybrid/listen";
import { readCloudOptIn, writeCloudOptIn } from "@/lib/hybrid/speechoptin";
import { api, firebaseApp, firebaseConfigured, remoteSettings, reportEvent } from "@/lib/firebase/client";
import { speechMode, type SpeechStatus } from "@/lib/hybrid/speechpolicy";
import { chatEngines, firebaseEngines, lastCall, prepareOnDevice, warmUpOnDevice } from "@/lib/firebase/engines";
import { DEMO_CONTACTS } from "@/lib/demo/contacts";
import { speaker } from "@/lib/hybrid/ttsBrowser";
import type { TtsStatus } from "@/lib/hybrid/tts";
import { chatReply, type ChatTurn } from "@/lib/hybrid/chat";
import { afterPayment, chatOnly, initialDialog, next as dialogNext, silence, type DialogState } from "@/lib/hybrid/dialog";
import { spokenSecret } from "@/lib/hybrid/tripwire";
import Approve from "./Approve";
import { Bubble, Chip, Dock, Header, ListeningBubble, PinStopped, PrivacyCard, SPEECH_CONSENT_TEXT, SpeechConsent, WalletCard, type Tab } from "./ui";
import History from "./History";
import { takeResume, type Resume } from "@/lib/ui/resume";
import { liveEnabled } from "@/lib/hybrid/live";
import { useLive } from "./useLive";

// SIMULATED test contacts until the saved-contacts screen exists (the server checks the same list).
const CONTACTS: Contact[] = DEMO_CONTACTS.map((c) => ({ ...c }));

// One layout per screen size. The wide layout (>= 1024px) puts the wallet in the header, the conversation on
// the left, and the payment, receipts and privacy cards on the right. The phone layout is unchanged.
const WIDE = "(min-width: 1024px)";
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

export default function Home() {
  const wide = useWide();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [nano, setNano] = useState("checking");
  const [speech, setSpeech] = useState<SpeechStatus | "checking">("checking");
  const [cloudSpeech, setCloudSpeech] = useState(false);
  const [policy, setPolicy] = useState<Policy>("on_device_first");
  const [limitMinor, setLimitMinor] = useState("5000000");
  const [listening, setListening] = useState(false);
  const [liveWords, setLiveWords] = useState(""); // interim words, shown on screen only
  const [consent, setConsent] = useState(false); // the one-tap online speech choice
  const [tab, setTab] = useState<Tab>("talk");
  const [walletConnected, setWalletConnected] = useState(false);
  type Turn = { who: "you" | "app"; text: string; ai?: "on_device" | "cloud"; sent?: string };
  const [turns, setTurns] = useState<Turn[]>([]);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<Understood | null>(null);
  const [ms, setMs] = useState(0);
  const [approving, setApproving] = useState<{ payeeId: string; amountMinor: string; key: number } | null>(null);
  const [working, setWorking] = useState("");
  const [voice, setVoice] = useState<TtsStatus>("off");
  const [historyKey, setHistoryKey] = useState(0); // bumps after a payment so the receipts reload
  const busy = useRef(false);
  const dialog = useRef<DialogState>(initialDialog());
  const lastInput = useRef<"voice" | "typed">("typed"); // hands-free loop only when the person is using the mic
  const inputBox = useRef<HTMLInputElement>(null);
  const talkRef = useRef<(auto?: boolean, forceCloud?: boolean) => Promise<void>>(async () => undefined);
  const history = useRef<ChatTurn[]>([]); // what the open conversation may see (chat.ts drops secrets and keeps the last few)
  const addTurn = useCallback((who: "you" | "app", text: string, ai?: { source: "on_device" | "cloud"; sent?: string }) => {
    if (!text) return;
    history.current = [...history.current, { who, text }].slice(-12);
    setTurns((t) => [...t, { who, text, ...(ai ? { ai: ai.source, sent: ai.sent } : {}) }].slice(-6));
  }, []);

  useEffect(() => {
    setVoice(speaker.status());
    return speaker.onStatus((st) => {
      setVoice(st);
      if (st === "ready") reportEvent({ event: "voice_ready", voice: "natural" });
      if (st === "failed") reportEvent({ event: "voice_ready", voice: "browser" });
    });
  }, []);
  const seq = useRef(0); // only the newest request may change the screen
  const speechRef = useRef<SpeechStatus | "checking">("checking");
  speechRef.current = speech;
  const installing = useRef(false);

  const setCloudOptIn = useCallback((on: boolean) => {
    setCloudSpeech(on);
    let ls: Storage | undefined;
    try {
      ls = window.localStorage;
    } catch {
      ls = undefined;
    }
    writeCloudOptIn(ls, on);
  }, []);

  // Speech check on page load (it only asks Chrome; nothing is installed or started without a tap).
  useEffect(() => {
    let ls: Storage | undefined;
    try {
      ls = window.localStorage;
    } catch {
      ls = undefined;
    }
    if (readCloudOptIn(ls)) setCloudSpeech(true);
    void localSpeechStatus().then((sp) => setSpeech((cur) => (cur === "checking" ? sp : cur)));
  }, []);

  /** Starts the on-device speech pack download once, from a tap, and switches to it live when it is ready. */
  const kickInstall = useCallback(() => {
    if (installing.current || (speechRef.current !== "installable" && speechRef.current !== "downloading")) return;
    installing.current = true;
    void installLocalSpeech("en-US", (st) => {
      if (st === "downloading") setSpeech((cur) => (cur === "local" ? cur : "downloading"));
      else if (st === "local") {
        setSpeech("local");
        const t = "Good news: speech now works on this computer. Your voice stays here.";
        addTurn("app", t);
        void say(t);
      } else if (st === "server") setSpeech((cur) => (cur === "local" ? cur : "server"));
    });
  }, [addTurn]);

  const speak = useCallback(async (t: string) => {
    await say(t);
  }, []);

  // Gemini Live prototype: OFF unless the page was opened with ?live=1 (remembered for this tab session).
  const [liveOn, setLiveOn] = useState(false);
  useEffect(() => {
    let ss: Storage | undefined;
    try {
      ss = window.sessionStorage;
    } catch {
      ss = undefined;
    }
    setLiveOn(liveEnabled(window.location.search, ss));
  }, []);
  const liveSettings = useRef<{ policy: Policy; limitMinor: string; nano: string }>({ policy, limitMinor, nano });
  liveSettings.current = { policy, limitMinor, nano };
  const live = useLive({
    // The same understand() as typed or spoken input: tripwire, instant rules, Nano, redacted cloud, crossCheck.
    understand: (said) => {
      const c = liveSettings.current;
      return understand(said, { contacts: CONTACTS, limitMinor: c.limitMinor, policy: c.policy, deviceAvailable: c.nano === "available" || c.nano === "warming up", instant: true }, {
        onDeviceBusy: firebaseEngines.onDeviceBusy,
        onDevice: (x) => firebaseEngines.onDevice(x),
        cloud: (x) => firebaseEngines.cloud(x),
      });
    },
    // Opens the existing Approve card (server quote, fingerprint or PIN). The read-back is our own template.
    present: async (r, said) => {
      const o = dialogNext(dialog.current, r, { contacts: CONTACTS, said, limitMinor: liveSettings.current.limitMinor });
      dialog.current = o.state;
      if (!(o.then === "approve" && o.approve)) return false;
      seq.current++;
      setResult(r);
      setApproving({ ...o.approve, key: Date.now() });
      return true;
    },
    onTripwire: (secret) => {
      const r: Understood = { kind: "secret_spoken", secret, source: "rules" };
      const o = dialogNext(dialog.current, r, { contacts: CONTACTS, said: "", limitMinor: liveSettings.current.limitMinor });
      dialog.current = o.state;
      setResult(r);
      addTurn("you", "(deleted)");
      addTurn("app", o.say);
      void speak(o.say); // the existing warning, in our own voice
    },
    onProblem: (t) => {
      addTurn("app", t);
      void speak(t);
    },
  });

  type Settings = { policy: Policy; limitMinor: string; nano: string };

  async function start(greet = true): Promise<Settings> {
    setWorking("Getting ready…");
    let policyNow = policy;
    let limitNow = limitMinor;
    kickInstall(); // the first tap is a user gesture; the speech pack keeps downloading in the background
    if (firebaseConfigured()) {
      setNano("preparing");
      const [s] = await Promise.all([remoteSettings(), prepareOnDevice((p) => setNano(`downloading ${Math.round(p * 100)}%`))]);
      policyNow = s.policy;
      limitNow = s.limitMinor;
      setPolicy(s.policy);
      setLimitMinor(s.limitMinor);
    }
    const nanoNow = await nanoAvailability();
    setNano(nanoNow);
    if (nanoNow === "available") {
      // In the background: load Gemini Nano first, then the natural voice, one after the other, so they do
      // not fight over the processor (on CPU-only PCs that made Nano several times slower).
      setNano("warming up");
      void warmUpOnDevice().then(() => {
        setNano("available");
        speaker.load();
      });
    } else {
      speaker.load(); // natural on-device voice; the browser voice speaks until it is ready
    }
    setReady(true);
    setWorking("");
    if (greet) {
      const hi = "Pay Alone is ready. Press the big button or the space bar, then say who to pay and how much.";
      addTurn("app", hi);
      await speak(hi);
    }
    return { policy: policyNow, limitMinor: limitNow, nano: nanoNow };
  }

  // Typing works before Start too: the Go press is the user gesture that starts Gemini Nano.
  async function submitTyped(override?: string) {
    const text = override ?? typed;
    if (!text) return;
    stopListening(); // typing wins over a microphone that is still open
    lastInput.current = "typed";
    setTyped("");
    try {
      const s = ready ? undefined : await start(false);
      await handle(text, s, "typed");
    } catch {
      reportEvent({ event: "error", code: "start_failed" });
      setWorking("Something went wrong. Please try again.");
    }
  }

  /** Returns true when the conversation wants the microphone opened again (voice only). */
  const handle = useCallback(
    async (said: string, now: Settings | undefined, via: "voice" | "typed"): Promise<boolean> => {
      setApproving(null);
      const c = now ?? { policy, limitMinor, nano };
      const my = ++seq.current;
      setWorking("Working on it…");
      let r: Understood;
      // Plain conversation (no name, amount or money word, nothing pending) skips the payment model and goes
      // straight to the chat AI: one on-device call instead of two. The PIN tripwire still runs first.
      const pendingPay = Boolean(dialog.current.payeeId || dialog.current.amountMinor);
      const justChat = !pendingPay && !spokenSecret(said).tripped && chatOnly(said, CONTACTS);
      try {
        r = justChat ? { kind: "unclear", source: "rules" } : await understand(said, { contacts: CONTACTS, limitMinor: c.limitMinor, policy: c.policy, deviceAvailable: c.nano === "available" || c.nano === "warming up", instant: true }, {
          // Say on screen which step is running, so a slow step never looks like a frozen app.
          onDeviceBusy: firebaseEngines.onDeviceBusy,
          onDevice: (x) => (setWorking("Thinking on this computer (Gemini Nano)…"), firebaseEngines.onDevice(x)),
          cloud: (x) => (setWorking("Asking online, with names and amounts hidden…"), firebaseEngines.cloud(x)),
        });
      } catch {
        reportEvent({ event: "error", code: "understand_failed" });
        if (my !== seq.current) return false;
        setWorking("Something went wrong. Please try again.");
        await speak("Something went wrong. Please try again.");
        return false;
      }
      if (my !== seq.current) return false; // a newer request started while this one ran
      setWorking("");
      setMs(lastCall.ms);
      setResult(r);
      // Only the route and the time are reported, never the sentence, names or amounts.
      reportEvent({ event: "intent", source: r.source, ms: r.source === "rules" ? 0 : Math.max(0, Math.round(lastCall.ms)) });
      // The conversation decides what to say next. Its lines are fixed templates; it never approves anything.
      const o = dialogNext(dialog.current, r, { contacts: CONTACTS, said, limitMinor: c.limitMinor });
      // Open conversation: where the dialog only has a fallback line, the AI may answer in its own words.
      // Its text is guarded (chat.ts safeReply) and only ever spoken; it never changes the payee or amount.
      let ai: { source: "on_device" | "cloud"; sent?: string } | undefined;
      if (o.chat && c.policy !== "ai_off") {
        setWorking("Thinking…");
        try {
          const cr = await chatReply(history.current, said, { contacts: CONTACTS, policy: c.policy, deviceAvailable: c.nano === "available" || c.nano === "warming up" }, {
            onDeviceBusy: chatEngines.onDeviceBusy,
            onDevice: (x) => (setWorking("Thinking on this computer (Gemini Nano)…"), chatEngines.onDevice(x)),
            cloud: (x) => (setWorking("Asking online, with names and amounts hidden…"), chatEngines.cloud(x)),
          });
          if (my !== seq.current) return false;
          if (cr.kind === "reply") {
            setMs(lastCall.ms);
            reportEvent({ event: "chat_reply", source: cr.source, guarded: Boolean(cr.guarded) });
            if (!cr.guarded) {
              o.state = o.chat.state; // a real answer is not a miss
              o.say = `${cr.text}${o.chat.suffix ? ` ${o.chat.suffix}` : ""}`;
              o.then = o.chat.then;
              ai = { source: cr.source, sent: cr.sentToCloud };
            }
            // A guarded (unsafe or empty) AI answer is never spoken: the dialog's own friendly fixed line is used.
          }
        } catch {
          reportEvent({ event: "error", code: "chat_failed" });
          // chat is optional: keep the fixed line
        }
        if (my !== seq.current) return false;
        setWorking("");
      }
      dialog.current = o.state;
      addTurn("you", r.kind === "secret_spoken" ? "(deleted)" : said);
      if (o.then === "approve" && o.approve) {
        setApproving({ ...o.approve, key: Date.now() });
        return false;
      }
      addTurn("app", o.say, ai);
      await speak(o.say);
      if (my !== seq.current) return false; // the person typed or pressed something while it was speaking
      if (o.then === "listen") {
        if (via === "voice") return true;
        inputBox.current?.focus(); // typed: keep typing; do not open the mic
      }
      return false;
    },
    [limitMinor, policy, nano, speak, addTurn],
  );

  const askConsent = useCallback(async () => {
    setConsent(true);
    await speak(SPEECH_CONSENT_TEXT);
  }, [speak]);

  const talk = useCallback(
    async (auto = false, forceCloud = false) => {
      if (busy.current) return stopListening(); // a second press stops listening
      if (speech === "checking") {
        await speak("One moment, I am checking speech on this computer.");
        return;
      }
      if (speech !== "local") kickInstall();
      const mode = speechMode(speech, cloudSpeech || forceCloud);
      if (!mode.mic) {
        if (auto) return;
        if (speech === "none") {
          await speak("This browser cannot hear speech. Please type instead.");
          return;
        }
        await askConsent();
        return;
      }
      lastInput.current = "voice";
      busy.current = true;
      setConsent(false);
      setLiveWords("");
      setListening(true);
      let again = false;
      try {
        const before = seq.current;
        const said = await listenOnce({ local: mode.local, onInterim: setLiveWords });
        setListening(false);
        setLiveWords("");
        if (seq.current !== before) return; // the person typed while the mic was open: their typing wins
        if (said) {
          again = await handle(said, undefined, "voice");
        } else {
          const o = silence(dialog.current); // after 2 silent turns in a row the loop stops
          dialog.current = o.state;
          addTurn("app", o.say);
          await speak(o.say);
          again = o.then === "listen" && seq.current === before;
        }
      } catch (e) {
        setListening(false);
        setLiveWords("");
        const info = e instanceof SpeechError ? e.info : speechErrorInfo("other");
        reportEvent({ event: "speech_error", code: info.code }); // only the code, never words
        if (info.kind === "language" && mode.local) {
          setSpeech("server"); // on-device speech cannot do this language: offer the online choice
          if (!(cloudSpeech || forceCloud)) await askConsent();
          else await speak("Speech is not working right now. Please type instead.");
        } else {
          const say2 = info.kind === "language" ? "Speech is not working right now. Please type instead." : info.say;
          addTurn("app", say2);
          await speak(say2);
        }
      } finally {
        busy.current = false;
      }
      if (again && (auto || lastInput.current === "voice")) void talkRef.current(true);
    },
    [handle, speak, speech, cloudSpeech, addTurn, askConsent, kickInstall],
  );
  talkRef.current = talk;

  // Start App Check (reCAPTCHA) on page load, so a payment call right away already has its token.
  useEffect(() => {
    if (firebaseConfigured()) firebaseApp();
    reportEvent({ event: "app_start" }, { signIn: false }); // only if a saved session exists; no new sign-in just for this
  }, []);

  // Back from the wallet's consent page: /?wallet=connected or /?wallet=failed.
  const [walletNote, setWalletNote] = useState("");
  const [resume, setResume] = useState<Resume | null>(null);
  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get("wallet");
    if (w !== "connected" && w !== "failed") return;
    const back = takeResume(window.sessionStorage);
    if (w === "connected" && back) setResume(back);
    const t =
      w === "connected"
        ? back
          ? "Wallet connected. Your weekly limit is set. Press Continue to finish your payment."
          : "Wallet connected. Your weekly limit is set."
        : "The wallet was not connected. Nothing was changed. You can try again when you pay.";
    setWalletNote(t);
    setWalletConnected(w === "connected");
    window.history.replaceState(null, "", window.location.pathname);
    void say(t).catch(() => undefined); // the browser may block speech before a first tap; the text stays on screen
  }, []);

  // Live mic button: start or stop the Live conversation. Falls back to the normal flow if Live fails.
  const toggleLive = useCallback(async () => {
    if (live.active) {
      await live.stop();
      return;
    }
    stopListening();
    lastInput.current = "typed"; // the normal hands-free loop stays off while Live is the voice
    try {
      if (!ready) await start(false);
    } catch {
      /* typing and the normal flow still work */
    }
    await live.start();
  }, [live, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && ready && !approving && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        void (liveOn && !live.failed ? toggleLive() : talk());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, talk, approving, liveOn, live.failed, toggleLive]);

  // The same wallet connection the approval card offers: the wallet's own page sets the weekly limit.
  async function connectWallet() {
    try {
      const r = await api<{ redirectUrl: string }>("/api/wallet/connect", {});
      if (r.ok && r.redirectUrl) {
        window.location.href = r.redirectUrl;
        return;
      }
    } catch {
      /* falls through to the message */
    }
    setWalletNote("I could not reach your wallet. Nothing was changed. Please try again.");
  }
  const EXAMPLES = ["Send 500 naira to Tunde", "What can you do?", "How do you keep my PIN safe?"];

  const speechWords =
    speech === "local"
      ? "on this computer"
      : speech === "checking"
        ? "checking"
        : cloudSpeech && speech !== "none"
          ? "Google servers (you allowed it)"
          : speech === "downloading"
            ? "downloading on-device speech"
            : speech === "none"
              ? "not available in this browser"
              : "off, type instead";
  const voiceWords = voice === "ready" ? "natural (on this computer)" : voice === "loading" ? "loading, browser voice meanwhile" : "browser";
  const hint = live.active ? (approving ? "Approve on the card" : "Live voice is on. Talk, or tap to stop") : !ready ? "Tap to start talking" : listening ? "Listening…" : approving ? "Approve on the card, or say \"no\" to cancel" : "Tap and speak";
  const micLabel = live.active ? "Live voice is on. Press to stop" : !ready ? "Tap to start talking" : listening ? "Listening. Press to stop" : "Press to speak (or Space)";
  const onMic = () => {
    if (liveOn && !live.failed) void toggleLive();
    else if (!ready) void start().catch(() => setWorking("Something went wrong while starting. Please reload the page."));
    else void talk();
  };

  // What the latest request showed: what the cloud received, skipped parts and model time. Kept in full.
  const resultDetails =
    result && result.kind !== "secret_spoken" ? (
      <>
        {"sentToCloud" in result && result.sentToCloud !== undefined && (
          <p>
            {result.source === "on_device" ? "The online model was also asked, in case this computer was slow, and received (its answer was not used): " : "What the cloud received: "}
            <code>{result.sentToCloud}</code>
          </p>
        )}
        {result.skipped?.map((w) => (
          <p key={w}>Skipped {w}</p>
        ))}
        {ms > 0 && result.source !== "rules" && <p>Model time: {ms} ms</p>}
      </>
    ) : undefined;
  const hasResultDetails = Boolean(result && result.kind !== "secret_spoken" && (("sentToCloud" in result && result.sentToCloud !== undefined) || result.skipped?.length || (ms > 0 && result.source !== "rules")));
  const quiet = turns.length === 0 && !approving && !consent && !listening;
  const lastIsApp = turns.length > 0 && turns[turns.length - 1].who === "app";

  const approveEl = approving ? (
            <Approve
              key={approving.key}
              payeeId={approving.payeeId}
              amountMinor={approving.amountMinor}
              speak={speak}
              onPaid={() => setHistoryKey((k) => k + 1)}
              listen={(() => {
                const m = speechMode(speech === "checking" ? "none" : speech, cloudSpeech);
                return m.mic ? () => listenOnce({ local: m.local }) : null;
              })()}
              onClose={(outcome) => {
                stopListening(); // the approval card may still have the mic open for "no"
                live.resume(); // Gemini Live prototype: mic and voice come back after paid or stopped
                setApproving(null);
                seq.current++; // anything still running from before no longer owns the screen
                const my = seq.current;
                const o = afterPayment(dialog.current, outcome);
                dialog.current = o.state;
                addTurn("app", o.say);
                void speak(o.say).then(() => {
                  if (my === seq.current && lastInput.current === "voice" && speechMode(speech === "checking" ? "none" : speech, cloudSpeech).mic) void talkRef.current(true);
                });
              }}
            />
  ) : null;
  const welcomeEl =
    quiet ? (
          <section className="welcome" aria-label="Welcome">
            <p className="serif big">Say who you want to pay.</p>
            <p className="note">Or ask me anything.</p>
            <ul className="examples" aria-label="Try one of these">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button type="button" className="example" onClick={() => void submitTyped(ex)}>
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
          </section>
    ) : null;
  const checkboxEl =
    ready && speech !== "local" ? (
          <p className="note">
            <label>
              <input type="checkbox" checked={cloudSpeech} onChange={(e) => setCloudOptIn(e.target.checked)} />
              <span>Use online speech recognition. Your voice will be sent to Google. Never say a PIN.</span>
            </label>
          </p>
    ) : null;
  const resumeBtn = (
    <>
      {resume && !approving && (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setApproving({ ...resume, key: Date.now() });
                setResume(null);
                setWalletNote("");
              }}
            >
              Continue payment to {CONTACTS.find((c) => c.id === resume.payeeId)?.name ?? "your contact"}
            </button>
          )}
    </>
  );
  const walletEl = (compact: boolean) => (
    <WalletCard compact={compact} note={compact ? undefined : walletNote} connected={walletConnected} onConnect={firebaseConfigured() ? () => void connectWallet() : undefined}>
      {!compact && resumeBtn}
    </WalletCard>
  );
  const chatEl = (
    <div aria-live="polite" className="chat">
          {working && <p className="working">{working}</p>}
          {turns.length > 0 && (
            <ol className="chat" aria-label="Conversation">
              {turns.map((t, i) => {
                const last = i === turns.length - 1 && t.who === "app";
                const sent = t.sent ? (
                  <p>
                    {t.ai === "on_device" ? "The online model was also asked, in case this computer was slow, and received (its answer was not used): " : "What the cloud received: "}
                    <code>{t.sent}</code>
                  </p>
                ) : null;
                const extra = last && hasResultDetails ? resultDetails : null;
                const details = sent || extra ? <>{sent}{extra}</> : undefined;
                const chip = t.who === "app" ? (t.ai ? <Chip source={t.ai} details={details} /> : last && result && result.kind !== "secret_spoken" ? <Chip source={result.source} details={details} /> : undefined) : undefined;
                return (
                  <Bubble key={i} who={t.who} chip={chip}>
                    {t.text}
                  </Bubble>
                );
              })}
              {result?.kind === "secret_spoken" && <PinStopped />}
              {!lastIsApp && result && result.kind !== "secret_spoken" && (
                <li className="b ai">
                  <Chip source={result.source} details={hasResultDetails ? resultDetails : undefined} />
                </li>
              )}
            </ol>
          )}
          {live.turns.length > 0 && (
            <ol className="chat" aria-label="Live conversation">
              {live.turns.map((t, i) => (
                <Bubble
                  key={`live${i}`}
                  who={t.who}
                  chip={
                    t.who === "app" ? (
                      <span className="chipstatic tone-cloud">
                        <span aria-hidden="true">🎙</span> Gemini Live (Google, online)
                      </span>
                    ) : undefined
                  }
                >
                  {t.text}
                </Bubble>
              ))}
            </ol>
          )}
          {(consent || listening) && (
            <ol className="chat" aria-label="Listening">
              {consent && !listening && (
                <SpeechConsent
                  onYes={() => {
                    setCloudOptIn(true);
                    setConsent(false);
                    kickInstall();
                    void talkRef.current(false, true);
                  }}
                  onNo={() => {
                    setConsent(false);
                    const t = "OK. Please type instead.";
                    addTurn("app", t);
                    void speak(t);
                    inputBox.current?.focus();
                  }}
                />
              )}
              {listening && <ListeningBubble words={liveWords} />}
            </ol>
          )}
          {!wide && approveEl}
    </div>
  );
  const privacyFacts = [
    { label: "Gemini Nano", value: nano },
    { label: "Speech", value: speechWords },
    { label: "Voice", value: voiceWords },
    { label: "Policy", value: policy },
    ...(!firebaseConfigured() ? [{ label: "Firebase", value: "not configured, plain rules only" }] : []),
  ];

  // Keep the newest message in view inside the conversation panel (wide layout only).
  useEffect(() => {
    if (wide && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [wide, turns, working, approving, consent, liveWords]);

  if (wide) {
    return (
      <div className="app desk">
        <Header nano={nano} right={walletEl(true)} />
        <div className="grid">
          <section className={`convo${quiet ? " empty" : ""}`} aria-label="Conversation">
            <div className="scroll" ref={scrollRef}>
              {welcomeEl}
              {chatEl}
              {checkboxEl}
            </div>
            <Dock desk hint={hint} listening={listening || live.active} micLabel={micLabel} onMic={onMic} typed={typed} onTyped={setTyped} onSubmit={() => void submitTyped()} inputRef={inputBox} tab={tab} />
          </section>
          <aside className="side" aria-label="Payment, receipts and privacy">
            {(walletNote || (resume && !approving)) && (
              <div className="card wallnote" aria-live="polite">
                {walletNote && <p>{walletNote}</p>}
                {resumeBtn}
              </div>
            )}
            {approveEl}
            <div className="card hist"><History refreshKey={historyKey} speak={speak} /></div>
            <PrivacyCard facts={privacyFacts} />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header nano={nano} />
      <div className="panel-body" role="tabpanel" id="panel-talk" aria-labelledby="tab-talk" hidden={tab !== "talk"}>
        {walletEl(false)}
        {welcomeEl}
        {chatEl}
        {checkboxEl}
      </div>
      <div className="panel-body" role="tabpanel" id="panel-receipts" aria-labelledby="tab-receipts" hidden={tab !== "receipts"}>
        <History refreshKey={historyKey} speak={speak} />
      </div>
      <div className="panel-body" role="tabpanel" id="panel-privacy" aria-labelledby="tab-privacy" hidden={tab !== "privacy"}>
        <section className="card" aria-labelledby="privacy-h">
          <h2 id="privacy-h">Privacy</h2>
          <p>
            <b>On this device:</b> when Gemini Nano is ready, your words are understood inside this browser and go nowhere.
          </p>
          <p>
            <b>Online, hidden:</b> if the cloud model is used, it only receives text with names and amounts replaced. A spoken PIN is stopped before any AI or network call.
          </p>
          <p>The AI never approves or sends money. You approve each payment yourself on the card.</p>
          <p>Test money only. Test contacts (Mama Ade, Tunde, Chidi Okafor) are simulated.</p>
          <div className="facts">
            <span>Gemini Nano: <b>{nano}</b></span>
            <span>Speech recognition: <b>{speechWords}</b></span>
            <span>Voice: <b>{voiceWords}</b></span>
            <span>Policy: <b>{policy}</b></span>
            {!firebaseConfigured() && <span><b>Firebase not configured: plain rules only</b></span>}
          </div>
        </section>
      </div>
      <Dock hint={hint} listening={listening || live.active} micLabel={micLabel} onMic={onMic} typed={typed} onTyped={setTyped} onSubmit={() => void submitTyped()} inputRef={inputBox} tab={tab} onTab={setTab} />
    </div>
  );
}
