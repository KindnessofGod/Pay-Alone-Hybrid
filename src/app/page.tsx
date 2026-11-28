"use client";
// The voice screen: header, wallet, conversation, and a sticky dock with the big mic. Everything is also
// spoken, and works with a screen reader and with the keyboard only (Space to talk).
import { useCallback, useEffect, useRef, useState } from "react";
import { understand, type Policy, type Understood } from "@/lib/hybrid/understand";
import type { Contact } from "@/lib/hybrid/crosscheck";
import { nanoAvailability } from "@/lib/hybrid/device";
import { installLocalSpeech, listenOnce, localSpeechStatus, say, SpeechError, speechErrorInfo, stopListening } from "@/lib/hybrid/listen";
import { readCloudOptIn, writeCloudOptIn } from "@/lib/hybrid/speechoptin";
import { api, firebaseApp, firebaseConfigured, remoteSettings, reportEvent } from "@/lib/firebase/client";
import { speechMode, type SpeechStatus } from "@/lib/hybrid/speechpolicy";
import { chatEngines, firebaseEngines, lastCall, prepareOnDevice, warmUpOnDevice } from "@/lib/firebase/engines";
import { isEmbedMuted } from "@/lib/embed";
import { DEMO_CONTACTS, CONTACT_PRONUNCIATION } from "@/lib/demo/contacts";
import { speaker } from "@/lib/hybrid/ttsBrowser";
import type { TtsStatus } from "@/lib/hybrid/tts";
import { chatReply, type ChatTurn } from "@/lib/hybrid/chat";
import { afterPayment, chatOnly, initialDialog, next as dialogNext, silence, type DialogState } from "@/lib/hybrid/dialog";
import { spokenSecret } from "@/lib/hybrid/tripwire";
import Approve from "./Approve";
import { Bubble, Chip, LanguagePicker, ListeningBubble, PinStopped, PrivacyCard, RequestCard, SPEECH_CONSENT_TEXT, SpeechConsent, StartLayer } from "./ui";
import { ActivityCard, BoardTop, PeopleCard, Rail, SafetyTiles, Sheet, SpentCard, TabBar, VoicePanel, WalletStack, type Tab } from "./dash";
import { leftSentence, leftThisWeek, weekBars, type WalletView } from "@/lib/ui/summary";
import { aiPill } from "@/lib/ui/status";
import type { OrbMode } from "./GlassOrb";
import Setup from "./Setup";
import { amountSpoken, readLang, stringsFor, writeLang, type LangCode } from "@/lib/hybrid/languages";
import { openingTurn, speakableForLive, startKey, APP_OPENED_AGAIN } from "@/lib/ui/voiceflow";
import History, { useHistory } from "./History";
import { takeResume, type Resume } from "@/lib/ui/resume";
import { liveEnabled } from "@/lib/hybrid/live";
import { useLive } from "./useLive";
import { runDeviceCheck, type DeviceCheckResult } from "@/lib/hybrid/nanocheck";
import { initialHandoff, stepHandoff, type HandoffEvent } from "@/lib/hybrid/handoff";
import { hybridStrip } from "@/lib/hybrid/strip";
import PayCode, { usePayCode } from "./PayCode";
import { answerToRequest, payCodeSpeech, requestPrompt } from "@/lib/ui/requestprompt";
import { bigAmount } from "@/lib/ui/amountview";

// SIMULATED test contacts until the saved-contacts screen exists (the server checks the same list).
const CONTACTS: Contact[] = DEMO_CONTACTS.map((c) => ({ ...c }));

/** A shop's payment request as the server sends it (seller.ts PendingView). */
type ShopReq = { id: string; ref: string; shopName: string; note?: string; amountMinor: string; assetCode: "NGN"; assetScale: 2 };
const REQUEST_POLL_MS = 4000;

export default function Home() {
  const [ready, setReady] = useState(false);
  const [nano, setNano] = useState("checking");
  const [speech, setSpeech] = useState<SpeechStatus | "checking">("checking");
  const [cloudSpeech, setCloudSpeech] = useState(false);
  const [policy, setPolicy] = useState<Policy>("on_device_first");
  const [limitMinor, setLimitMinor] = useState("5000000");
  const [listening, setListening] = useState(false);
  const [liveWords, setLiveWords] = useState(""); // interim words, shown on screen only
  const [consent, setConsent] = useState(false); // the one-tap online speech choice
  const [tab, setTab] = useState<"home" | "talk">("home"); // phone: which panel shows (the dark rail and the voice panel are side by side on wide screens)
  const [sheet, setSheet] = useState<null | "settings" | "history">(null);
  const [wallet, setWallet] = useState<WalletView | null>(null); // the wallet grant: weekly limit and its week, from the server
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [walletConnected, setWalletConnected] = useState(false);
  type Turn = { who: "you" | "app"; text: string; ai?: "on_device" | "cloud"; sent?: string };
  const [turns, setTurns] = useState<Turn[]>([]);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<Understood | null>(null);
  const [ms, setMs] = useState(0);
  const [approving, setApproving] = useState<{ payeeId: string; amountMinor: string; key: number; shopRequestId?: string; reference?: string; nanoChecked?: boolean } | null>(null);
  const [incoming, setIncoming] = useState<ShopReq | null>(null); // a shop is asking this person to pay
  const [requestBusy, setRequestBusy] = useState(false);
  const [working, setWorking] = useState("");
  const [voice, setVoice] = useState<TtsStatus>("off");
  const [historyKey, setHistoryKey] = useState(0); // bumps after a payment so the receipts reload
  const [begun, setBegun] = useState(false); // the start layer is gone: someone pressed a key or tapped
  const [lang, setLangState] = useState<LangCode>("en");
  const langRef = useRef<LangCode>("en");
  langRef.current = lang;
  const [setupOn, setSetupOn] = useState(false); // first-run setup (PIN, fingerprint) is showing
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
  const stopAsked = useRef(false); // the person pressed stop (or typed) while the mic was open
  const stopMic = useCallback(() => {
    stopAsked.current = true;
    stopListening();
  }, []);

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

  // One natural voice: while Live is running, OUR sentences are read by Live's voice (live.speakExact checks word for
  // word that it said exactly our template). If it said anything else, or there is no Live session, our own voice speaks.
  const liveRef = useRef<{ active: boolean; stop: () => Promise<void>; speakExact: (t: string) => Promise<"spoken" | "mismatch" | "failed"> } | null>(null);
  const speak = useCallback(async (t: string) => {
    if (isEmbedMuted()) return;
    const t0 = performance.now();
    const L = liveRef.current;
    if (L?.active && speakableForLive(t)) {
      const r = await L.speakExact(t).catch(() => "failed" as const);
      if (r === "spoken") {
        reportEvent({ event: "speak", engine: "live", ms: Math.round(performance.now() - t0), ok: true });
        return;
      }
      // "mismatch" was already counted (template_mismatch). Either way: our own voice says the template now.
    }
    const engine = !t ? "none" : speaker.status() === "ready" ? "kokoro" : "browser";
    try {
      await say(t);
      reportEvent({ event: "speak", engine, ms: Math.round(performance.now() - t0), ok: true });
    } catch (e) {
      reportEvent({ event: "speak", engine, ms: Math.round(performance.now() - t0), ok: false });
      throw e;
    }
  }, []);

  // Gemini Live is the default conversation engine. ?live=0 turns it off for this tab session; the older Web Speech path then runs.
  const [liveOn, setLiveOn] = useState(true);
  const [debugOn, setDebugOn] = useState(false); // ?debug=1: show the Debug panel (in memory only)
  useEffect(() => {
    setDebugOn(new URLSearchParams(window.location.search).get("debug") === "1");
    let ss: Storage | undefined;
    try {
      ss = window.sessionStorage;
    } catch {
      ss = undefined;
    }
    setLiveOn(liveEnabled(window.location.search, ss));
    try {
      const l = readLang(window.localStorage);
      setLangState(l);
      langRef.current = l;
    } catch {
      /* English */
    }
  }, []);
  // Hybrid strip facts: the last Nano double-check on a Live payment, and whether one is running now.
  const [lastCheck, setLastCheck] = useState<DeviceCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  // Cloud <-> device handoff (src/lib/hybrid/handoff.ts). The dispatcher is filled in below, once speak and talk exist.
  const [hand, setHand] = useState(initialHandoff);
  const handRef = useRef(hand);
  const dispatchHand = useRef<(e: HandoffEvent) => void>(() => undefined);
  const liveSettings = useRef<{ policy: Policy; limitMinor: string; nano: string }>({ policy, limitMinor, nano });
  liveSettings.current = { policy, limitMinor, nano };
  const live = useLive({
    contacts: CONTACTS,
    pronunciation: CONTACT_PRONUNCIATION,
    // Fallback only (the model promised details but called no tool): the same understand() as typed or spoken input.
    understand: (said) => {
      const c = liveSettings.current;
      return understand(said, { contacts: CONTACTS, limitMinor: c.limitMinor, policy: c.policy, deviceAvailable: c.nano === "available" || c.nano === "warming up", instant: true }, {
        onDeviceBusy: firebaseEngines.onDeviceBusy,
        onDevice: (x) => firebaseEngines.onDevice(x),
        cloud: (x) => firebaseEngines.cloud(x),
      });
    },
    limitMinor: () => liveSettings.current.limitMinor,
    // Gemini Nano on THIS device reads the same words again, before the card. ONLY_ON_DEVICE: the cloud is never used here.
    deviceCheck: async (said, lp) => {
      const c = liveSettings.current;
      setChecking(true);
      try {
        return await runDeviceCheck(said, { contacts: CONTACTS, limitMinor: c.limitMinor, live: lp, deviceAvailable: c.nano === "available" || c.nano === "warming up", engines: firebaseEngines });
      } finally {
        setChecking(false);
      }
    },
    onCheck: setLastCheck,
    onClosed: () => dispatchHand.current({ type: "live_closed", online: typeof navigator === "undefined" ? true : navigator.onLine }),
    // Opens the existing Approve card (server quote, fingerprint or PIN). The read-back is our own template.
    present: async (r, said, meta) => {
      const o = dialogNext(dialog.current, r, { contacts: CONTACTS, said, limitMinor: liveSettings.current.limitMinor });
      dialog.current = o.state;
      if (!(o.then === "approve" && o.approve)) return false;
      seq.current++;
      setResult(r);
      setApproving({ ...o.approve, key: Date.now(), nanoChecked: meta?.deviceCheck === "agree" });
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

  liveRef.current = live;

  // Offline (or Live closing) hands the voice to the on-device loop: Web Speech with processLocally, Gemini Nano, browser voice.
  const begunRef = useRef(false);
  dispatchHand.current = (e) => {
    const r = stepHandoff(handRef.current, e);
    handRef.current = r.state;
    setHand(r.state);
    if (r.log) reportEvent({ event: "handoff", to: r.log.to, reason: r.log.reason }); // fixed words only
    if (!begunRef.current) return;
    if (r.say) {
      addTurn("app", r.say);
      void speak(r.say).catch(() => undefined);
    }
    if (r.log?.to === "device") {
      if (liveRef.current?.active) void liveRef.current.stop();
      setTimeout(() => void talkRef.current(true), 1500); // the on-device loop listens (it does nothing if on-device speech is not ready)
    }
  };
  useEffect(() => {
    const go = () => dispatchHand.current({ type: "offline" });
    const back = () => dispatchHand.current({ type: "online" });
    window.addEventListener("offline", go);
    window.addEventListener("online", back);
    if (!navigator.onLine) go();
    return () => {
      window.removeEventListener("offline", go);
      window.removeEventListener("online", back);
    };
  }, []);

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
    if (override === undefined) reportEvent({ event: "typed_submit", chars: text.length }); // the length only, never the text
    stopMic(); // typing wins over a microphone that is still open
    lastInput.current = "typed";
    setTyped("");
    try {
      const s = ready ? undefined : await start(false);
      await handle(text, s, "typed");
    } catch {
      reportEvent({ event: "client_error", where: "start", code: "failed" });
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
      const tU = performance.now();
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
        reportEvent({ event: "client_error", where: "understand", code: "failed" });
        if (my !== seq.current) return false;
        setWorking("Something went wrong. Please try again.");
        await speak("Something went wrong. Please try again.");
        return false;
      }
      if (my !== seq.current) return false; // a newer request started while this one ran
      setWorking("");
      setMs(lastCall.ms);
      setResult(r);
      // Codes, route and times only: never the sentence, names, amounts or digits.
      reportEvent({
        event: "understand_done",
        source: justChat ? "none" : r.source,
        kind: r.kind,
        ms: Math.max(0, Math.round(performance.now() - tU)),
        cloud_raced: r.source === "on_device" && "sentToCloud" in r && r.sentToCloud !== undefined,
      });
      // Only the route and the time are reported, never the sentence, names or amounts.
      reportEvent({ event: "intent", source: r.source, ms: r.source === "rules" ? 0 : Math.max(0, Math.round(lastCall.ms)) });
      // The conversation decides what to say next. Its lines are fixed templates; it never approves anything.
      const o = dialogNext(dialog.current, r, { contacts: CONTACTS, said, limitMinor: c.limitMinor });
      // Open conversation: where the dialog only has a fallback line, the AI may answer in its own words.
      // Its text is guarded (chat.ts safeReply) and only ever spoken; it never changes the payee or amount.
      let ai: { source: "on_device" | "cloud"; sent?: string } | undefined;
      if (o.chat && c.policy !== "ai_off") {
        setWorking("Thinking…");
        const tC = performance.now();
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
            reportEvent({ event: "chat_done", source: cr.source, ms: Math.max(0, Math.round(performance.now() - tC)), guarded: Boolean(cr.guarded) });
            if (!cr.guarded) {
              o.state = o.chat.state; // a real answer is not a miss
              o.say = `${cr.text}${o.chat.suffix ? ` ${o.chat.suffix}` : ""}`;
              o.then = o.chat.then;
              ai = { source: cr.source, sent: cr.sentToCloud };
            }
            // A guarded (unsafe or empty) AI answer is never spoken: the dialog's own friendly fixed line is used.
          }
        } catch {
          reportEvent({ event: "client_error", where: "chat", code: "failed" });
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
      const sp = speech === "installable" ? "none" : speech;
      if (busy.current) {
        if (!auto) reportEvent({ event: "mic_tap", state: "stop", speech: sp });
        return stopMic(); // a second press stops listening
      }
      if (speech === "checking") {
        if (!auto) reportEvent({ event: "mic_tap", state: "blocked", speech: sp });
        await speak("One moment, I am checking speech on this computer.");
        return;
      }
      if (speech !== "local") kickInstall();
      const mode = speechMode(speech, cloudSpeech || forceCloud);
      if (!mode.mic) {
        if (auto) return;
        reportEvent({ event: "mic_tap", state: "blocked", speech: sp });
        if (speech === "none") {
          await speak("This browser cannot hear speech. Please type instead.");
          return;
        }
        await askConsent();
        return;
      }
      if (!auto) reportEvent({ event: "mic_tap", state: "start", speech: sp });
      lastInput.current = "voice";
      busy.current = true;
      setConsent(false);
      setLiveWords("");
      setListening(true);
      let again = false;
      const tL = performance.now();
      stopAsked.current = false;
      reportEvent({ event: "listen_start", mode: mode.local ? "local" : "online" });
      try {
        const before = seq.current;
        const said = await listenOnce({ local: mode.local, onInterim: setLiveWords });
        // Only how it ended and how long the words were, never the words.
        reportEvent({ event: "listen_end", outcome: said ? "heard" : stopAsked.current ? "stopped" : "silence", ms: Math.round(performance.now() - tL), chars: said.length });
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
        reportEvent({ event: "listen_end", outcome: "error", ms: Math.round(performance.now() - tL), chars: 0 });
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

  // ---- A shop asks, this person approves (seller.ts). Polled, because there are no webhooks. ----
  const approvingRef = useRef<typeof approving>(null);
  approvingRef.current = approving;
  const incomingRef = useRef<ShopReq | null>(null);
  incomingRef.current = incoming;
  const announced = useRef(new Set<string>()); // requests already spoken this page load
  const dismissed = useRef(new Set<string>()); // requests this person declined
  const readyRef = useRef(false);
  readyRef.current = ready;
  const micRef = useRef(false);
  micRef.current = speechMode(speech === "checking" ? "none" : speech, cloudSpeech).mic;
  const localRef = useRef(false);
  localRef.current = speechMode(speech === "checking" ? "none" : speech, cloudSpeech).local;

  const checkRequest = useCallback((rq: ShopReq) => {
    stopListening();
    setIncoming(null);
    seq.current++;
    setApproving({ payeeId: "", amountMinor: rq.amountMinor, shopRequestId: rq.id, reference: rq.ref, key: Date.now() });
  }, []);

  const declineRequest = useCallback(
    async (rq: ShopReq) => {
      stopListening();
      dismissed.current.add(rq.id);
      setIncoming((cur) => (cur?.id === rq.id ? null : cur));
      setRequestBusy(true);
      let done = false;
      try {
        done = (await api("/api/requests/decline", { id: rq.id })).ok;
      } catch {
        done = false;
      }
      setRequestBusy(false);
      await speak(done ? "Declined. Nothing was sent." : "I could not decline it. It will run out by itself in a few minutes. Nothing was sent.").catch(() => undefined);
    },
    [speak],
  );

  /** Speaks the template, then (voice only, never typed) listens once for yes or no. A yes only opens the usual check. */
  const announceRequest = useCallback(
    async (rq: ShopReq) => {
      const amt = { value: rq.amountMinor, assetCode: rq.assetCode, assetScale: rq.assetScale };
      const L = langRef.current;
      await speak(L === "en" ? requestPrompt(rq.shopName, amt, rq.ref) : stringsFor(L).requestPrompt({ shop: rq.shopName, amount: amountSpoken(rq.amountMinor, L), ref: rq.ref })).catch(() => undefined);
      if (!readyRef.current || !micRef.current || busy.current || approvingRef.current || incomingRef.current?.id !== rq.id) return;
      busy.current = true;
      setListening(true);
      let said = "";
      try {
        said = await listenOnce({ local: localRef.current, onInterim: setLiveWords });
      } catch {
        said = "";
      } finally {
        busy.current = false;
        setListening(false);
        setLiveWords("");
      }
      if (incomingRef.current?.id !== rq.id || approvingRef.current) return;
      const a = answerToRequest(said);
      if (a === "check") checkRequest(rq);
      else if (a === "decline") await declineRequest(rq);
      else if (a === "secret") await speak("Stop. Never say your PIN out loud. Type it on the keys.").catch(() => undefined);
    },
    [speak, checkRequest, declineRequest],
  );

  useEffect(() => {
    if (!firebaseConfigured()) return;
    let off = false;
    let running = false;
    const poll = async () => {
      if (running || off || document.visibilityState === "hidden") return;
      running = true;
      try {
        const r = await api<{ requests: ShopReq[] }>("/api/requests/pending", {});
        if (off || !r.ok || !Array.isArray(r.requests)) return;
        const open = r.requests.filter((x) => !dismissed.current.has(x.id));
        const busyWith = approvingRef.current?.shopRequestId;
        const next = open.find((x) => x.id !== busyWith);
        setIncoming((cur) => {
          if (cur && open.some((x) => x.id === cur.id)) return cur;
          return next ?? null;
        });
        if (next && !busyWith && !announced.current.has(next.id)) {
          announced.current.add(next.id);
          setTab("talk");
          setSheet(null);
          void announceRequest(next);
        }
      } catch {
        /* the next poll tries again */
      } finally {
        running = false;
      }
    };
    void poll();
    const t = setInterval(() => void poll(), REQUEST_POLL_MS);
    const wake = () => void poll();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      off = true;
      clearInterval(t);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [announceRequest]);

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

  // The voice conversation. Live is the default; if it cannot connect, the older Web Speech path takes over.
  begunRef.current = begun;
  const liveUsable = liveOn && (hand.mode === "cloud" ? !live.failed : hand.offer);
  const startLive = useCallback(async (): Promise<boolean> => {
    stopListening();
    lastInput.current = "typed"; // the normal hands-free loop stays off while Live is the voice
    let ls: Storage | undefined;
    try {
      ls = window.localStorage;
    } catch {
      ls = undefined;
    }
    const ok = await live.start(langRef.current, ls ? openingTurn(ls) : APP_OPENED_AGAIN);
    if (ok) dispatchHand.current({ type: "live_started" });
    return ok;
  }, [live]);

  /** First key press or tap: connect Live (inside the gesture, so sound and the microphone are allowed), then it greets first. */
  const begun0 = useRef(false);
  const beginApp = useCallback(() => {
    if (begun0.current) return;
    begun0.current = true;
    setBegun(true);
    reportEvent({ event: "mic_tap", state: "start", speech: speechRef.current === "installable" || speechRef.current === "checking" ? "none" : speechRef.current });
    const liveP = liveOn ? startLive() : Promise.resolve(false); // first, synchronously: the audio context must be made inside the gesture
    const prep = start(false).catch(() => {
      setWorking("Something went wrong while starting. Please reload the page.");
      return undefined;
    });
    void (async () => {
      const ok = await liveP;
      const settings = await prep;
      if (!ok) {
        // Live is off or did not connect: the older voice says hello, and Live's own message (if any) was already shown.
        const hi = "Pay Alone is ready. Press the big button or the space bar, then say who to pay and how much.";
        addTurn("app", hi);
        await speak(hi).catch(() => undefined);
      } else await live.afterGreeting();
      // First run: a PIN and a fingerprint, before the first payment. Only when the server says there is no PIN yet.
      if (settings && firebaseConfigured()) {
        try {
          const st = await api<{ hasPin: boolean }>("/api/setup/status", {});
          if (st.ok && st.hasPin === false) setSetupOn(true);
        } catch {
          /* the payment card still sets a PIN when needed */
        }
      }
    })();
  }, [liveOn, startLive, start, addTurn, speak, live]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (begun) return;
    const go = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (!startKey(e.key)) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "SELECT" || t.tagName === "OPTION")) return; // choosing a language is not "start"
        e.preventDefault();
      } else {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.(".startlang")) return;
      }
      beginApp();
    };
    window.addEventListener("keydown", go);
    window.addEventListener("pointerdown", go);
    return () => {
      window.removeEventListener("keydown", go);
      window.removeEventListener("pointerdown", go);
    };
  }, [begun, beginApp]);

  // Live mic button / space bar: pause or resume the microphone. If Live is not running, start it again.
  const toggleLive = useCallback(async () => {
    reportEvent({ event: "mic_tap", state: live.active ? "stop" : "start", speech: speechRef.current === "installable" || speechRef.current === "checking" ? "none" : speechRef.current });
    if (live.active) return live.togglePause();
    try {
      if (!ready) await start(false);
    } catch {
      /* typing and the normal flow still work */
    }
    await startLive();
  }, [live, ready, startLive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (e.code !== "Space" || !begun || approving || setupOn || tag === "INPUT" || tag === "SELECT" || tag === "BUTTON" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (live.active) return live.togglePause();
      if (!ready) return;
      void (liveUsable ? toggleLive() : talk());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [begun, ready, talk, approving, setupOn, live, liveUsable, toggleLive]);

  // Closed microphone for Live while the first-run card is open (a PIN is being typed), open again after.
  useEffect(() => {
    if (!setupOn) return;
    live.pauseMic();
    return () => live.resume();
  }, [setupOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Changing the language reconnects Live in the new one (a click or key press is a gesture, so audio is allowed).
  const changeLang = useCallback(
    async (c: LangCode) => {
      setLangState(c);
      langRef.current = c;
      try {
        writeLang(window.localStorage, c);
      } catch {
        /* the choice then lasts for this visit only */
      }
      if (live.active) {
        await live.stop();
        await live.start(c, APP_OPENED_AGAIN);
      }
    },
    [live],
  );

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
  const hint = live.active ? (approving ? "Approve on the card" : live.paused ? "Microphone paused. Press Space to talk" : "Listening. Press Space to pause") : !ready ? "Tap to start talking" : listening ? "Listening…" : approving ? "Approve on the card, or say \"no\" to cancel" : "Tap and speak";
  const micLabel = live.active ? (live.paused ? "Microphone is paused. Press to talk, or press Space" : "Microphone is on. Press to pause, or press Space") : !ready ? "Tap to start talking" : listening ? "Listening. Press to stop" : "Press to speak (or Space)";
  const onMic = () => {
    if (liveUsable) void toggleLive();
    else if (!ready) {
      reportEvent({ event: "mic_tap", state: "start", speech: speech === "installable" ? "none" : speech });
      void start().catch(() => setWorking("Something went wrong while starting. Please reload the page."));
    } else void talk();
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

  const nanoUsable = nano === "available" || nano === "warming up";
  const stripMode = hand.mode === "cloud" && !live.failed ? "cloud" : "device";
  const stripFacts = { mode: stripMode, liveActive: live.active, nanoUsable, checking, offer: hand.offer } as const;
  const panelStrip = hybridStrip({ ...stripFacts, lastCheck });
  const approveStrip = hybridStrip({ ...stripFacts, checking: false, lastCheck: approving?.nanoChecked ? { result: "agree", source: "on_device" } : null });
  const approveEl = approving ? (
            <Approve
              key={approving.key}
              payeeId={approving.payeeId}
              amountMinor={approving.amountMinor}
              shopRequestId={approving.shopRequestId}
              reference={approving.reference}
              speak={speak}
              lang={lang}
              strip={approveStrip}
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
  const setupEl = setupOn && !approving ? (
    <Setup
      speak={speak}
      lang={lang}
      listen={(() => {
        const m = speechMode(speech === "checking" ? "none" : speech, cloudSpeech);
        return m.mic ? () => listenOnce({ local: m.local }) : null;
      })()}
      onClose={() => {
        setSetupOn(false);
        setHistoryKey((k) => k + 1); // a fingerprint may have been added: ask the server again
      }}
    />
  ) : null;
  const langEl = (
    <div className="langbar">
      <LanguagePicker value={lang} onChange={(c) => void changeLang(c)} />
    </div>
  );
  const startEl = !begun ? <StartLayer lang={lang} onLang={(c) => void changeLang(c)} onStart={beginApp} /> : null;
  const requestEl =
    incoming && !approving ? (
      <RequestCard
        shopName={incoming.shopName}
        amount={bigAmount({ value: incoming.amountMinor, assetCode: incoming.assetCode, assetScale: incoming.assetScale })}
        reference={incoming.ref}
        note={incoming.note}
        busy={requestBusy}
        onCheck={() => checkRequest(incoming)}
        onDecline={() => void declineRequest(incoming)}
      />
    ) : null;
  const welcomeEl =
    quiet ? (
          <section className="welcome-chat" aria-label="Welcome">
            <ol className="chat">
              <li className="b ai">Hello. Ask me what is left to spend, who you paid, or tell me who to send money to.</li>
            </ol>
            <ul className="examples" aria-label="Try one of these">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button type="button" className="example" onClick={() => (reportEvent({ event: "example_chip", index: EXAMPLES.indexOf(ex) }), void submitTyped(ex))}>
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
                reportEvent({ event: "approve_action", action: "continue", outcome: "ok", ms: 0 });
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
          {debugOn && (
            <details className="card" style={{ fontSize: 12, wordBreak: "break-word" }}>
              <summary>Debug (this page only, never sent)</summary>
              <p>Tool calls</p>
              <pre>{live.toolLog.length ? JSON.stringify(live.toolLog, null, 1) : "none yet"}</pre>
              <p>Transcripts this session</p>
              <pre>{live.turns.length ? live.turns.map((t) => `${t.who === "you" ? "person" : "assistant"}: ${t.text}`).join("\n") : "none yet"}</pre>
            </details>
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
    </div>
  );
  const privacyFacts = [
    { label: "Gemini Nano", value: nano },
    { label: "Speech", value: speechWords },
    { label: "Voice", value: voiceWords },
    { label: "Policy", value: policy },
    ...(!firebaseConfigured() ? [{ label: "Firebase", value: "not configured, plain rules only" }] : []),
  ];

  const hist = useHistory(historyKey);
  const code = usePayCode(begun);
  const receipts = hist.data?.receipts ?? null;

  // The wallet's weekly limit and whether a fingerprint is saved, from the server. Asked after the first press and after each payment.
  const refreshAccount = useCallback(async () => {
    if (!firebaseConfigured()) return;
    try {
      const [w, st] = await Promise.all([
        api<{ connected: boolean; cap: WalletView["cap"]; interval?: string }>("/api/wallet/status", {}),
        api<{ hasPasskey: boolean }>("/api/setup/status", {}),
      ]);
      if (w.ok) setWallet({ connected: Boolean(w.connected), cap: w.cap ?? null, interval: w.interval });
      if (st.ok) setHasPasskey(Boolean(st.hasPasskey));
    } catch {
      /* the cards then say "connect" or "shown after you start": nothing invented */
    }
  }, []);
  const loadHistory = hist.load;
  useEffect(() => {
    if (!begun) return;
    void refreshAccount().then(() => loadHistory(true));
  }, [begun, historyKey, refreshAccount, loadHistory]);

  const connected = walletConnected || Boolean(wallet?.connected);
  const nowMs = Date.now();
  const left = leftThisWeek(wallet ? { ...wallet, connected } : connected ? { connected, cap: null } : null, receipts, nowMs);
  const capAsset = wallet?.cap ?? (receipts && receipts[0] ? { value: "0", assetCode: receipts[0].debit.assetCode, assetScale: receipts[0].debit.assetScale } : null);
  const week = weekBars(receipts ?? [], nowMs, capAsset?.assetCode ?? "USD", capAsset?.assetScale ?? 2);
  const limitPct = left.kind === "left" && BigInt(left.limit.value) > BigInt(0) ? Number((BigInt(left.spent.value) * BigInt(100)) / BigInt(left.limit.value)) : null;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const sayLeft = () => void speak(leftSentence(left)).catch(() => undefined);

  const orbMode: OrbMode = live.active ? (live.paused ? "idle" : "listening") : listening ? "listening" : begun && liveUsable && !live.failed && !ready ? "connecting" : "idle";
  const statusLabel = working ? "Thinking" : orbMode === "listening" ? "Listening" : live.active && live.paused ? "Paused" : orbMode === "connecting" ? "Connecting" : "Ready";
  const talkLabel = live.active ? (live.paused ? "Talk" : "Pause") : "Talk";

  // Sheets sit over the board; on a wide screen the voice panel stays visible beside them, so "no" by voice still works.
  const noteEl = walletNote || (resume && !approving) ? (
    <div className="card wallnote" aria-live="polite">
      {walletNote && <p>{walletNote}</p>}
      {resumeBtn}
    </div>
  ) : null;
  const barTab: Tab = sheet === "history" ? "activity" : sheet === "settings" ? "settings" : tab;
  const onTab = (t: Tab) => {
    if (t === "activity") return setSheet("history");
    if (t === "settings") return setSheet("settings");
    setSheet(null);
    setTab(t);
  };

  return (
    <>
      {startEl}
      <div className="dash" inert={!begun} data-tab={tab}>
        <Rail tab={sheet ? "settings" : "home"} onTab={onTab} onTalk={onMic} onSettings={() => setSheet("settings")} />
        <main className="board" id="top">
          <BoardTop name="" today={today} connected={connected} onConnect={firebaseConfigured() ? () => void connectWallet() : undefined} onSettings={() => setSheet("settings")} />
          {noteEl}
          <section className="row-1">
            <WalletStack
              name=""
              payCode={code}
              left={left}
              connected={connected}
              onConnect={firebaseConfigured() ? () => void connectWallet() : undefined}
              onSayCode={() => code && void speak(payCodeSpeech(code)).catch(() => undefined)}
              onSayLeft={sayLeft}
              onTalk={onMic}
              talkLabel={talkLabel}
            />
            <SpentCard week={week} limitPct={limitPct} />
          </section>
          <section className="row-2">
            <PeopleCard contacts={CONTACTS} onSend={onMic} />
            <ActivityCard receipts={receipts} onAll={() => setSheet("history")} />
          </section>
          <SafetyTiles fingerprint={hasPasskey} limit={wallet?.cap ?? null} payCode={code} onSayCode={() => code && void speak(payCodeSpeech(code)).catch(() => undefined)} />
        </main>
        <VoicePanel
          mode={orbMode}
          statusLabel={statusLabel}
          ai={aiPill(nano, liveUsable && hand.mode === "cloud")}
          strip={panelStrip}
          onRestore={() => void toggleLive()}
          hint={hint}
          micLabel={micLabel}
          micOn={listening || live.active}
          onMic={onMic}
          typed={typed}
          onTyped={setTyped}
          onSubmit={() => void submitTyped()}
          inputRef={inputBox}
        >
          {welcomeEl}
          {chatEl}
        </VoicePanel>
        <TabBar tab={barTab} onTab={onTab} />
        {requestEl && <Sheet label="Payment request from a shop" bare>{requestEl}</Sheet>}
        {setupEl && <Sheet label="First-time setup" bare>{setupEl}</Sheet>}
        {approveEl && <Sheet label="Approve payment" bare>{approveEl}</Sheet>}
        {sheet === "history" && (
          <Sheet label="Your payments" title="Your payments" onClose={() => setSheet(null)}>
            <div className="hist"><History h={hist} speak={speak} /></div>
          </Sheet>
        )}
        {sheet === "settings" && (
          <Sheet label="Voice and settings" title="Voice and settings" onClose={() => setSheet(null)}>
            <div className="settings">
              {langEl}
              {checkboxEl}
              <PayCode code={code} speak={speak} />
              <PrivacyCard facts={privacyFacts} />
            </div>
          </Sheet>
        )}
      </div>
    </>
  );
}
