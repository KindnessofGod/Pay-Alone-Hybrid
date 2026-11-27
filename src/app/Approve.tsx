"use client";
// Approval of one payment. The server quotes, reads back and decides; this screen only collects the
// PIN and sends it once. Voice can only say NO here: a spoken "yes" just asks for the PIN.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/firebase/client";
import { yesNo } from "@/lib/hybrid/confirm";
import { spokenSecret } from "@/lib/hybrid/tripwire";
import { formatAmount } from "@/lib/money";
import { approvalMessage } from "@/lib/ui/messages";
import { pinAnnouncement, pinPress } from "@/lib/ui/pinpad";
import { saveResume } from "@/lib/ui/resume";

type Phase = "connect" | "starting" | "set_pin" | "confirm_pin" | "pin" | "sending" | "done" | "stopped";

interface Props {
  payeeId: string;
  amountMinor: string;
  speak(text: string): Promise<void>;
  listen: (() => Promise<string>) | null; // null when the mic is off for privacy
  /** "paid" after a receipt; "stopped" after a cancel, a stop or Not now. */
  onClose(outcome: "paid" | "stopped"): void;
}

interface Receipt {
  id: string;
  payeeName: string;
  debit: { value: string; assetCode: string; assetScale: number };
  simulated: boolean;
  createdAt: string;
}

export default function Approve({ payeeId, amountMinor, speak, listen, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
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
    const r = await call<{ requestId: string; challenge: string; readBack: string }>("/api/pay/start", { payeeId, amountMinor });
    if (r.ok) {
      req.current = { requestId: r.requestId, challenge: r.challenge };
      setPhase("pin");
      await tell(r.readBack);
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
    if (phase !== "pin" || !req.current) return;
    setPhase("sending");
    const r = await call<{ receipt: Receipt; spoken: string; challenge?: string; triesLeft?: number }>("/api/pay/finish", {
      requestId: req.current.requestId,
      proof: { method: "pin", challenge: req.current.challenge, pin: p },
    });
    if (r.ok) {
      req.current = null;
      setReceipt(r.receipt);
      setPhase("done");
      return void tell(r.spoken);
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

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typing = phase === "set_pin" || phase === "confirm_pin" || phase === "pin";
  const title = phase === "set_pin" ? "Choose your PIN" : phase === "confirm_pin" ? "Type the same PIN again" : "Type your PIN to approve";

  return (
    <section className="card approve" aria-label="Approve payment">
      <p>{message}</p>
      {typing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="status" htmlFor="pin">
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
          <p className="status" aria-live="polite">
            {pinAnnouncement(pin)}
          </p>
          <div className="pad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "clear"].map((k) => (
              <button type="button" key={k} onClick={() => setPin((p) => pinPress(p, k))} aria-label={k === "back" ? "Delete one digit" : k === "clear" ? "Clear" : k}>
                {k === "back" ? "⌫" : k === "clear" ? "C" : k}
              </button>
            ))}
          </div>
          <div className="row">
            <button type="submit" className="ok">
              {phase === "pin" ? "Approve with PIN" : "Save"}
            </button>
            <button type="button" className="no" onClick={() => void cancel()}>
              No, cancel
            </button>
          </div>
        </form>
      )}
      {phase === "connect" && (
        <div className="row">
          <button type="button" className="big" onClick={() => void connectWallet()}>
            Connect wallet
          </button>
          <button type="button" className="no" onClick={() => onClose("stopped")}>
            Not now
          </button>
        </div>
      )}
      {phase === "sending" && <p className="status">Checking your PIN on the server...</p>}
      {receipt && (
        <div className="receipt">
          <p>
            <b>Receipt</b> {receipt.simulated && <span className="badge bad">SIMULATED: no real money moved</span>}
          </p>
          <p className="status">
            To {receipt.payeeName} · {formatAmount(receipt.debit)} · {new Date(receipt.createdAt).toLocaleString()} · saved by the server
          </p>
        </div>
      )}
      {(phase === "done" || phase === "stopped") && (
        <button type="button" onClick={() => onClose(phase === "done" ? "paid" : "stopped")}>
          Done
        </button>
      )}
    </section>
  );
}
