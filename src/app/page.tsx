"use client";
// The voice screen. One big button. Everything is also spoken, and works with a screen reader and
// with the keyboard only (Space to talk).
import { useCallback, useEffect, useRef, useState } from "react";
import { understand, type Policy, type Understood } from "@/lib/hybrid/understand";
import type { Contact } from "@/lib/hybrid/crosscheck";
import { nanoAvailability } from "@/lib/hybrid/device";
import { installLocalSpeech, listenOnce, localSpeechStatus, say, stopListening } from "@/lib/hybrid/listen";
import { firebaseApp, firebaseConfigured, remoteSettings } from "@/lib/firebase/client";
import { speechMode, type SpeechStatus } from "@/lib/hybrid/speechpolicy";
import { firebaseEngines, lastCall, prepareOnDevice, warmUpOnDevice } from "@/lib/firebase/engines";
import { DEMO_CONTACTS } from "@/lib/demo/contacts";
import { speaker } from "@/lib/hybrid/ttsBrowser";
import type { TtsStatus } from "@/lib/hybrid/tts";
import Approve from "./Approve";
import { takeResume, type Resume } from "@/lib/ui/resume";

// SIMULATED test contacts until the saved-contacts screen exists (the server checks the same list).
const CONTACTS: Contact[] = DEMO_CONTACTS.map((c) => ({ ...c }));

const REASONS: Record<string, string> = {
  unknown_payee: "I don't know that person. I can only send to people saved in your list.",
  payee_not_said: "Please say the full name of the person.",
  no_amount: "Please say how much to send.",
  amount_mismatch: "I heard two different amounts, so I stopped. Please say it again.",
  over_limit: "That is more than your spending limit.",
};

const SOURCE_LABEL: Record<string, string> = {
  on_device: "Understood on this computer (Gemini Nano)",
  cloud: "Understood online (Gemini) - no names or amounts sent",
  rules: "Understood by plain rules (no AI)",
};

export default function Home() {
  const [ready, setReady] = useState(false);
  const [nano, setNano] = useState("checking");
  const [speech, setSpeech] = useState<SpeechStatus | "checking">("checking");
  const [cloudSpeech, setCloudSpeech] = useState(false);
  const [policy, setPolicy] = useState<Policy>("on_device_first");
  const [limitMinor, setLimitMinor] = useState("5000000");
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<Understood | null>(null);
  const [spoken, setSpoken] = useState("");
  const [ms, setMs] = useState(0);
  const [approving, setApproving] = useState<{ payeeId: string; amountMinor: string; key: number } | null>(null);
  const [working, setWorking] = useState("");
  const [voice, setVoice] = useState<TtsStatus>("off");
  const busy = useRef(false);

  useEffect(() => {
    setVoice(speaker.status());
    return speaker.onStatus(setVoice);
  }, []);
  const seq = useRef(0); // only the newest request may change the screen

  const speak = useCallback(async (t: string) => {
    setSpoken(t);
    await say(t);
  }, []);

  type Settings = { policy: Policy; limitMinor: string; nano: string };

  async function start(greet = true): Promise<Settings> {
    speaker.load(); // natural on-device voice: downloads in the background; the browser voice speaks until it is ready
    setWorking("Getting ready…");
    let policyNow = policy;
    let limitNow = limitMinor;
    // These checks do not depend on each other, so they run side by side; each has its own time limit.
    const speechCheck = (async () => {
      const sp = await localSpeechStatus();
      return sp === "installable" ? ((await installLocalSpeech()) ? "local" : "server") : sp;
    })();
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
      // In the background: load the model now, so the first real request does not pay for it.
      setNano("warming up");
      void warmUpOnDevice().then(() => setNano("available"));
    }
    const sp = await speechCheck;
    setSpeech(sp);
    setReady(true);
    setWorking("");
    if (greet) await speak("Pay Alone is ready. Press the big button or the space bar, then say who to pay and how much.");
    return { policy: policyNow, limitMinor: limitNow, nano: nanoNow };
  }

  // Typing works before Start too: the Go press is the user gesture that starts Gemini Nano.
  async function submitTyped() {
    if (!typed) return;
    stopListening(); // typing wins over a microphone that is still open
    try {
      const s = ready ? undefined : await start(false);
      await handle(typed, s);
    } catch {
      setWorking("Something went wrong. Please try again.");
    }
  }

  const handle = useCallback(
    async (said: string, now?: Settings) => {
      setHeard(said);
      setApproving(null);
      const c = now ?? { policy, limitMinor, nano };
      const my = ++seq.current;
      setWorking("Working on it…");
      let r: Understood;
      try {
        r = await understand(said, { contacts: CONTACTS, limitMinor: c.limitMinor, policy: c.policy, deviceAvailable: c.nano === "available" || c.nano === "warming up" }, {
          // Say on screen which step is running, so a slow step never looks like a frozen app.
          onDevice: (x) => (setWorking("Thinking on this computer (Gemini Nano)…"), firebaseEngines.onDevice(x)),
          cloud: (x) => (setWorking("Asking online, with names and amounts hidden…"), firebaseEngines.cloud(x)),
        });
      } catch {
        if (my !== seq.current) return;
        setWorking("Something went wrong. Please try again.");
        await speak("Something went wrong. Please try again.");
        return;
      }
      if (my !== seq.current) return; // a newer request started while this one ran
      setWorking("");
      setMs(lastCall.ms);
      if (r.kind === "secret_spoken") {
        setHeard("(deleted)");
        setResult(r);
        await speak("Stop. Never say your PIN or card number out loud. I have deleted what you said.");
        return;
      }
      setResult(r);
      if (r.kind === "proposal") setApproving({ payeeId: r.proposal.payeeId, amountMinor: r.proposal.amountMinor, key: Date.now() });
      else if (r.kind === "rejected") await speak(REASONS[r.reason] ?? "I could not do that.");
      else if (r.kind === "intent") await speak(`You asked about ${r.action}. That part is coming soon.`);
      else await speak("Sorry, I did not understand. Say who to pay and how much.");
    },
    [limitMinor, policy, nano, speak],
  );

  const talk = useCallback(async () => {
    if (busy.current) return stopListening(); // a second press stops listening
    const mode = speechMode(speech === "checking" ? "none" : speech, cloudSpeech);
    if (!mode.mic) {
      await speak("Speaking is off on this computer, to keep your voice private. Please type instead.");
      return;
    }
    busy.current = true;
    setListening(true);
    try {
      const before = seq.current;
      const said = await listenOnce({ local: mode.local });
      setListening(false);
      if (seq.current !== before) return; // the person typed while the mic was open: their typing wins
      if (said) await handle(said);
      else await speak("I did not hear anything. Try again.");
    } catch {
      setListening(false);
      await speak("The microphone did not work. You can type instead.");
    } finally {
      busy.current = false;
    }
  }, [handle, speak, speech, cloudSpeech]);

  // Start App Check (reCAPTCHA) on page load, so a payment call right away already has its token.
  useEffect(() => {
    if (firebaseConfigured()) firebaseApp();
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
    window.history.replaceState(null, "", window.location.pathname);
    void say(t).catch(() => undefined); // the browser may block speech before a first tap; the text stays on screen
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && ready && !approving && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        void talk();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, talk, approving]);

  return (
    <main>
      <h1>Pay Alone</h1>
      <p className="tag">Speak it. Approve it. The AI is never allowed to move your money.</p>

      {!ready ? (
        <button className="big" onClick={() => void start().catch(() => setWorking("Something went wrong while starting. Please reload the page."))}>
          Start
        </button>
      ) : (
        <button className="big" aria-pressed={listening} onClick={talk}>
          {listening ? "Listening..." : "Press to speak (or Space)"}
        </button>
      )}

      <div className="row">
        <input aria-label="Or type what you want to do" placeholder="Or type: send 5000 naira to Mama Ade" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submitTyped()} />
        <button onClick={() => void submitTyped()}>Go</button>
      </div>

      {ready && speech !== "local" && (
        <p className="status">
          <label>
            <input type="checkbox" checked={cloudSpeech} onChange={(e) => setCloudSpeech(e.target.checked)} /> Use online speech recognition. Your voice
            will be sent to Google. Never say a PIN.
          </label>
        </p>
      )}

      <div aria-live="polite">
        {walletNote && <p className="status">{walletNote}</p>}
        {resume && !approving && (
          <button
            className="big"
            onClick={() => {
              setApproving({ ...resume, key: Date.now() });
              setResume(null);
              setWalletNote("");
            }}
          >
            Continue payment to {CONTACTS.find((c) => c.id === resume.payeeId)?.name ?? "your contact"}
          </button>
        )}
        {working && <p className="status">{working}</p>}
        {result && (
          <div className="card">
            <p className="status">You said: <b>{heard}</b></p>
            {result.kind === "secret_spoken" ? (
              <span className="badge bad">PIN stopped before any AI saw it</span>
            ) : (
              <span className={`badge ${result.source}`}>{SOURCE_LABEL[result.source]}</span>
            )}
            {"sentToCloud" in result && result.sentToCloud !== undefined && (
              <p className="status">What the cloud received: <code>{result.sentToCloud}</code></p>
            )}
            {result.skipped?.map((w) => (
              <p className="status" key={w}>
                Skipped {w}
              </p>
            ))}
            {ms > 0 && result.kind !== "secret_spoken" && result.source !== "rules" && <p className="status">Model time: {ms} ms</p>}
            {!approving && <p>{spoken}</p>}
          </div>
        )}
        {approving && (
          <Approve
            key={approving.key}
            payeeId={approving.payeeId}
            amountMinor={approving.amountMinor}
            speak={speak}
            listen={(() => {
              const m = speechMode(speech === "checking" ? "none" : speech, cloudSpeech);
              return m.mic ? () => listenOnce({ local: m.local }) : null;
            })()}
            onClose={() => setApproving(null)}
          />
        )}
      </div>

      <p className="status">
        Gemini Nano: <b>{nano}</b> · Speech recognition: <b>{speech === "local" ? "on this computer" : speech === "server" ? "Google servers" : speech}</b> · Voice: <b>{voice === "ready" ? "natural (on this computer)" : voice === "loading" ? "loading, browser voice meanwhile" : "browser"}</b> · Policy: <b>{policy}</b>
        {!firebaseConfigured() && <> · <b>Firebase not configured: plain rules only</b></>}
      </p>
      <p className="sim">Test contacts (simulated): Mama Ade, Tunde, Chidi Okafor. Test money only.</p>
    </main>
  );
}
