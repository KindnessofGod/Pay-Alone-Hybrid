"use client";
// Approval of one payment. The server quotes, reads back and decides; this screen only collects the
// PIN and sends it once. Voice can only say NO here: a spoken "yes" just asks for the PIN.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/firebase/client";
import { yesNo } from "@/lib/hybrid/confirm";
import { spokenSecret } from "@/lib/hybrid/tripwire";
import { FINGERPRINT_FAILED, FINGERPRINT_OFFER, FINGERPRINT_PROMPT, fingerprintAvailable, fingerprintRequest } from "@/lib/ui/fingerprint";
import { formatAmount } from "@/lib/money";
import { approvalMessage } from "@/lib/ui/messages";
import { pinAnnouncement, pinPress } from "@/lib/ui/pinpad";
import { saveResume } from "@/lib/ui/resume";
import { FingerprintIcon, PayCard, ReceiptCard } from "./ui";

type Phase = "connect" | "starting" | "set_pin" | "confirm_pin" | "pin" | "offer_pin" | "sending" | "done" | "stopped";

interface Props {
  payeeId: string;
  amountMinor: string;
  speak(text: string): Promise<void>;
  listen: (() => Promise<string>) | null; // null when the mic is off for privacy
  /** "paid" after a receipt; "stopped" after a cancel, a stop or Not now. */
  onClose(outcome: "paid" | "stopped"): void;
  /** Called the moment the server has saved a receipt, before the person closes the card. */
  onPaid?(): void;
}

interface Receipt {
  id: string;
  payeeName: string;
  debit: { value: string; assetCode: string; assetScale: number };
  simulated: boolean;
  createdAt: string;
}

function alreadyDeclined(): boolean {
  try {
    return window.localStorage.getItem("pay_alone_fp_offer_declined") === "1";
  } catch {
    return false;
  }
}

export default function Approve({ payeeId, amountMinor, speak, listen, onClose, onPaid }: Props) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [showPin, setShowPin] = useState(false); // with a fingerprint on file the PIN pad opens on request
  const [approvedBy, setApprovedBy] = useState<"PIN" | "fingerprint">("PIN");
  const [spokenReceipt, setSpokenReceipt] = useState("");
  const [offer, setOffer] = useState(false); // after a PIN receipt: offer the fingerprint once
  const req = useRef<{ requestId: string; challenge: string } | null>(null);
  const started = useRef(false);

  // Any network or sign-in failure becomes a spoken, honest message instead of a blank box.
  async function call<T = Record<string, unknown>>(path: string, body: unknown): Promise<T & { ok: boolean; reason?: string }> {
    try {
      return await api<T>(path, body);
    } catch {
      return { ok: false, reason: "unreachable" } as T & { ok: boolean; reason?: string };
    }
  }

  const tell = async (t: string) => {
    setMessage(t);
    await speak(t);
  };

  async function begin() {
    const r = await call<{ requestId: string; challenge: string; readBack: string; hasPasskey?: boolean }>("/api/pay/start", { payeeId, amountMinor });
    if (r.ok) {
      req.current = { requestId: r.requestId, challenge: r.challenge };
      setPhase("pin");
      const fp = Boolean(r.hasPasskey) && fingerprintAvailable();
      setHasPasskey(Boolean(r.hasPasskey));
      await tell(fp ? `${r.readBack} ${FINGERPRINT_PROMPT}` : r.readBack);
      void voiceNo();
    } else if (r.reason === "no_pin_set") {
      setPhase("set_pin");
      await tell("First, choose a PIN of 4 to 6 digits. Type it on the keys. Never say it out loud.");
    } else if (r.reason === "wallet_not_connected") {
      setPhase("connect");
      await tell(approvalMessage({ ok: false, reason: r.reason }));
    } else {
      setPhase("stopped");
      await tell(approvalMessage({ ok: false, reason: r.reason ?? "unknown" }));
    }
  }

  // One-time wallet connection: the wallet's own page is where the weekly limit is set and agreed to.
  async function connectWallet() {
    const r = await call<{ redirectUrl: string }>("/api/wallet/connect", {});
    if (r.ok && r.redirectUrl) {
      saveResume(window.sessionStorage, { payeeId, amountMinor }); // so the person can carry on after the wallet page
      window.location.href = r.redirectUrl;
      return;
    }
    setPhase("stopped");
    await tell("I could not reach your wallet. Nothing was changed. Please try again.");
  }

  // After the read-back the person may say "no". "Yes" only reminds them to type the PIN.
  async function voiceNo() {
    if (!listen) return;
    const said = await listen().catch(() => "");
    if (!said) return;
    if (spokenSecret(said).tripped) return void tell("Stop. Never say your PIN out loud. Type it on the keys.");
    const a = yesNo(said);
    if (a === "no") await cancel();
    else if (a === "yes") await tell("Type your PIN to approve.");
  }

  async function cancel() {
    if (req.current) await call("/api/pay/cancel", { requestId: req.current.requestId }).catch(() => undefined);
    req.current = null;
    setPin("");
    setPhase("stopped");
    await tell("Cancelled. Nothing was sent.");
  }

  async function submit() {
    const p = pin;
    setPin(""); // the PIN leaves this screen's memory as soon as it is sent
    if (!/^\d{4,6}$/.test(p)) return void tell("A PIN has 4 to 6 digits.");
    if (phase === "set_pin") {
      setFirstPin(p);
      setPhase("confirm_pin");
      return void tell("Type the same PIN again.");
    }
    if (phase === "confirm_pin") {
      const same = p === firstPin;
      setFirstPin("");
      if (!same) {
        setPhase("set_pin");
        return void tell("The two PINs were different. Choose a PIN again.");
      }
      const s = await call("/api/pin", { pin: p });
      if (!s.ok) {
        setPhase("set_pin");
        return void tell(s.reason === "weak_pin" ? "That PIN is too easy to guess. Choose another one." : approvalMessage({ ok: false, reason: s.reason ?? "unknown" }));
      }
      await tell("Your PIN is saved.");
      setPhase("starting");
      return void begin();
    }
    if (phase === "offer_pin") return void addFingerprint(p);
    if (phase !== "pin" || !req.current) return;
    setPhase("sending");
    const r = await call<{ receipt: Receipt; spoken: string; challenge?: string; triesLeft?: number }>("/api/pay/finish", {
      requestId: req.current.requestId,
      proof: { method: "pin", challenge: req.current.challenge, pin: p },
    });
    if (r.ok) {
      req.current = null;
      setReceipt(r.receipt);
      setApprovedBy("PIN");
      setSpokenReceipt(r.spoken);
      onPaid?.();
      setPhase("done");
      await tell(r.spoken);
      if (!hasPasskey && fingerprintAvailable() && !alreadyDeclined()) {
        setOffer(true);
        await speak(FINGERPRINT_OFFER);
      }
      return;
    }
    if (r.challenge) {
      req.current = { ...req.current, challenge: r.challenge };
      setPhase("pin");
    } else {
      req.current = null;
      setPhase("stopped");
    }
    await tell(approvalMessage({ ok: false, reason: r.reason ?? "unknown", triesLeft: r.triesLeft }));
  }

  // Fingerprint: the device signs this payment's challenge; the server checks the signature and decides.
  async function approveWithFingerprint() {
    if (phase !== "pin" || !req.current) return;
    const cur = req.current;
    setPhase("sending");
    let response: unknown;
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      response = await startAuthentication({ optionsJSON: fingerprintRequest(cur.challenge) });
    } catch {
      setPhase("pin"); // cancelled or no sensor: nothing reached the server, the same challenge still works
      return void tell(FINGERPRINT_FAILED);
    }
    const r = await call<{ receipt: Receipt; spoken: string; challenge?: string; triesLeft?: number }>("/api/pay/finish", {
      requestId: cur.requestId,
      proof: { method: "passkey", challenge: cur.challenge, response },
    });
    if (r.ok) {
      req.current = null;
      setReceipt(r.receipt);
      setApprovedBy("fingerprint");
      setSpokenReceipt(r.spoken);
      onPaid?.();
      setPhase("done");
      return void tell(r.spoken);
    }
    if (r.challenge) {
      req.current = { ...cur, challenge: r.challenge };
      setPhase("pin");
    } else {
      req.current = null;
      setPhase("stopped");
    }
    await tell(approvalMessage({ ok: false, reason: r.reason ?? "unknown", triesLeft: r.triesLeft }));
  }

  // Offered once, after a payment approved with the PIN. Adding a fingerprint asks for the PIN again.
  async function addFingerprint(p: string) {
    setPhase("sending");
    const o = await call<{ options: unknown; triesLeft?: number }>("/api/passkey/options", { pin: p });
    if (!o.ok) {
      const stay = o.reason === "wrong" || o.reason === "bad_pin";
      setPhase(stay ? "offer_pin" : "done");
      return void tell(approvalMessage({ ok: false, reason: o.reason ?? "unknown", triesLeft: o.triesLeft }));
    }
    let response: unknown;
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      response = await startRegistration({ optionsJSON: o.options as Parameters<typeof startRegistration>[0]["optionsJSON"] });
    } catch {
      setPhase("done");
      return void tell("Fingerprint was not added. Nothing was changed. You can still use your PIN.");
    }
    const r = await call("/api/passkey/register", { response });
    setPhase("done");
    setHasPasskey(r.ok);
    await tell(r.ok ? "Done. Next time you can approve with your fingerprint." : approvalMessage({ ok: false, reason: r.reason ?? "unknown" }));
  }

  async function declineOffer() {
    setOffer(false);
    try {
      window.localStorage.setItem("pay_alone_fp_offer_declined", "1");
    } catch {
      /* no storage: it may be offered again, which is harmless */
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typing = phase === "set_pin" || phase === "confirm_pin" || phase === "pin" || phase === "offer_pin";
  const fingerprintReady = phase === "pin" && hasPasskey && fingerprintAvailable();
  const title = phase === "set_pin" ? "Choose your PIN" : phase === "confirm_pin" ? "Type the same PIN again" : phase === "offer_pin" ? "Type your PIN to add your fingerprint" : phase === "pin" && hasPasskey ? "Or type your PIN to approve" : "Type your PIN to approve";

  const pinFormOpen = typing && !(fingerprintReady && !showPin);
  const paymentPhase = phase === "pin" || phase === "sending" || phase === "starting";

  if (phase === "done" && receipt) {
    return (
      <div className="chat" aria-label="Approve payment">
        <ReceiptCard
          amount={formatAmount(receipt.debit)}
          to={receipt.payeeName}
          how={`Approved with ${approvedBy} · ${new Date(receipt.createdAt).toLocaleTimeString([], { timeStyle: "short" })} · saved by the server`}
          simulated={receipt.simulated}
          onRead={spokenReceipt ? () => void speak(spokenReceipt).catch(() => undefined) : undefined}
        />
        <p className="note" aria-live="polite">{message}</p>
        {offer && (
          <div className="pay">
            <p className="msg">{FINGERPRINT_OFFER}</p>
            <div className="stack">
              <button type="button" className="btn primary" onClick={() => (setOffer(false), setPhase("offer_pin"), void tell("Type your PIN to add your fingerprint."))}>
                <FingerprintIcon /> Yes, add fingerprint
              </button>
              <button type="button" className="btn ghost" onClick={() => void declineOffer()}>
                Not now
              </button>
            </div>
          </div>
        )}
        <button type="button" className="btn ghost" onClick={() => onClose("paid")}>
          Done
        </button>
      </div>
    );
  }

  return (
    <PayCard label={paymentPhase ? "Please check this payment" : "Pay Alone"}>
      <p className="msg" aria-live="polite">{message}</p>
      <div className="stack">
        {fingerprintReady && (
          <button type="button" className="btn primary" onClick={() => void approveWithFingerprint()}>
            <FingerprintIcon /> Approve with fingerprint
          </button>
        )}
        {fingerprintReady && !showPin && (
          <button type="button" className="btn ghost" onClick={() => setShowPin(true)}>
            Use my PIN instead
          </button>
        )}
        {pinFormOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="pinlabel" htmlFor="pin">
              {title}
            </label>
            <input
              id="pin"
              className="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              autoFocus
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <p className="note" aria-live="polite">
              {pinAnnouncement(pin)}
            </p>
            <div className="pad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "clear"].map((k) => (
                <button type="button" key={k} onClick={() => setPin((p) => pinPress(p, k))} aria-label={k === "back" ? "Delete one digit" : k === "clear" ? "Clear" : k}>
                  {k === "back" ? "⌫" : k === "clear" ? "C" : k}
                </button>
              ))}
            </div>
            <button type="submit" className="btn primary">
              {phase === "pin" ? "Approve with PIN" : phase === "offer_pin" ? "Add fingerprint" : "Save"}
            </button>
          </form>
        )}
        {typing && (
          <button type="button" className="btn quiet" onClick={() => (phase === "offer_pin" ? (setPin(""), setPhase("done")) : void cancel())}>
            {phase === "offer_pin" ? "Not now" : "Cancel"}
          </button>
        )}
        {phase === "connect" && (
          <>
            <button type="button" className="btn primary" onClick={() => void connectWallet()}>
              Connect wallet
            </button>
            <button type="button" className="btn quiet" onClick={() => onClose("stopped")}>
              Not now
            </button>
          </>
        )}
        {phase === "sending" && <p className="note">Checking on the server...</p>}
        {(phase === "done" || phase === "stopped") && (
          <button type="button" className="btn ghost" onClick={() => onClose(phase === "done" ? "paid" : "stopped")}>
            Done
          </button>
        )}
      </div>
    </PayCard>
  );
}
