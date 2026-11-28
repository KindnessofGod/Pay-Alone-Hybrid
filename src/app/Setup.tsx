"use client";
// First-run setup by voice and on screen: a PIN (typed twice), then the fingerprint or Windows Hello (can be skipped).
// Same server calls as the approval card: /api/pin, /api/passkey/options, /api/passkey/register. No default PIN.
// The PIN is typed on the keypad only; the microphone to Live is closed while this card is open, and the PIN lives in
// a ref just long enough to ask the server for the passkey options, then it is cleared.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/firebase/client";
import { stopListening } from "@/lib/hybrid/listen";
import { stringsFor, type LangCode } from "@/lib/hybrid/languages";
import { approvalMessage } from "@/lib/ui/messages";
import { isSkip, passkeyFailure, setupNext, startKey, type SetupEvent, type SetupStep } from "@/lib/ui/voiceflow";
import { SetupView } from "./ui";

interface Props {
  speak(text: string): Promise<void>;
  lang: LangCode;
  listen: (() => Promise<string>) | null;
  /** Called when setup is finished or the person leaves it. */
  onClose(): void;
}

export default function Setup({ speak, lang, listen, onClose }: Props) {
  const S = stringsFor(lang);
  const [step, setStepState] = useState<SetupStep>("pin");
  const stepRef = useRef<SetupStep>("pin");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const first = useRef("");
  const secret = useRef("");
  const started = useRef(false);
  const skipped = useRef(false);
  const inputBox = useRef<HTMLInputElement>(null);

  const setStep = (s: SetupStep) => {
    stepRef.current = s;
    setStepState(s);
  };
  const tell = useCallback(
    async (t: string) => {
      setMessage(t);
      await speak(t).catch(() => undefined);
    },
    [speak],
  );
  const go = async (ev: SetupEvent) => {
    const n = setupNext(stepRef.current, ev);
    setStep(n.step);
    if (n.say) await tell(S[n.say] as string);
    if (n.step === "pin" || n.step === "confirm") inputBox.current?.focus();
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void tell(S.setupIntro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The keypad speaks how many digits are typed, never which.
  const counted = useRef(0);
  const justSent = useRef(false);
  useEffect(() => {
    const n = pin.length;
    if (n === counted.current) return;
    counted.current = n;
    if (justSent.current) {
      justSent.current = false;
      return;
    }
    const t = setTimeout(() => void speak(S.digits(n)).catch(() => undefined), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const abortCeremony = () => void import("@simplewebauthn/browser").then((m) => m.WebAuthnAbortService.cancelCeremony()).catch(() => undefined);

  async function finishPasskey(ev: "passkey_done" | "passkey_failed" | "skip") {
    secret.current = ""; // the PIN is not kept past this step
    stopListening();
    setNeedKey(false);
    await go(ev);
    if (stepRef.current === "done" && ev !== "passkey_done") await tell(S.setupDone);
  }

  async function registerPasskey(auto: boolean) {
    if (stepRef.current !== "passkey" || skipped.current) return;
    setNeedKey(false);
    const o = await api<{ options: unknown }>("/api/passkey/options", { pin: secret.current }).catch(() => ({ ok: false }) as { ok: false });
    if (!o.ok) return void (await finishPasskey("passkey_failed"));
    const t0 = performance.now();
    let response: unknown;
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      response = await startRegistration({ optionsJSON: (o as { options: unknown }).options as Parameters<typeof startRegistration>[0]["optionsJSON"] });
    } catch (e) {
      if (skipped.current) return;
      const kind = passkeyFailure(e instanceof Error ? e.name : "", performance.now() - t0);
      if (kind === "aborted") return;
      if (kind === "needs_gesture" && auto) {
        setNeedKey(true);
        return void (await tell(S.pressKeyAdd));
      }
      return void (await finishPasskey("passkey_failed"));
    }
    const r = await api("/api/passkey/register", { response }).catch(() => ({ ok: false }));
    await finishPasskey(r.ok ? "passkey_done" : "passkey_failed");
  }

  // "Press any key": the browser wanted a fresh key press before it would show the fingerprint prompt.
  useEffect(() => {
    if (!needKey) return;
    const go1 = (e: Event) => {
      if (e instanceof KeyboardEvent && !startKey(e.key)) return;
      setNeedKey(false);
      void registerPasskey(false);
    };
    window.addEventListener("keydown", go1);
    window.addEventListener("pointerdown", go1);
    return () => {
      window.removeEventListener("keydown", go1);
      window.removeEventListener("pointerdown", go1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needKey]);

  async function skip() {
    if (skipped.current) return;
    skipped.current = true;
    abortCeremony();
    await finishPasskey("skip");
  }

  async function submit() {
    const p = pin;
    justSent.current = true;
    setPin(""); // the PIN leaves this screen's state the moment it is taken
    if (!/^\d{4,6}$/.test(p)) return void (await tell(S.typePin));
    if (stepRef.current === "pin") {
      first.current = p;
      return void (await go("pin_entered"));
    }
    if (stepRef.current !== "confirm") return;
    const same = p === first.current;
    first.current = "";
    if (!same) return void (await go("different"));
    secret.current = p;
    await go("same"); // saving
    const s = await api("/api/pin", { pin: p }).catch(() => ({ ok: false, reason: "unreachable" }) as { ok: false; reason: string });
    if (!s.ok) {
      secret.current = "";
      setStep("pin");
      const reason = (s as { reason?: string }).reason ?? "unknown";
      await tell(reason === "weak_pin" ? S.weakPin : approvalMessage({ ok: false, reason }));
      return void inputBox.current?.focus();
    }
    await go("saved");
    // Speak the fingerprint step and, at once, ask the device. Saying "skip" (or the Skip button) leaves it.
    if (listen) void listen().then((said) => (isSkip(said) ? skip() : undefined)).catch(() => undefined);
    await registerPasskey(true);
  }

  const count = pin.length === 0 ? "" : `${S.digits(pin.length)}`;
  return (
    <SetupView
      step={step}
      pin={pin}
      count={count}
      message={message}
      onPin={(v) => (stopListening(), setPin(v))}
      onSubmit={() => void submit()}
      onFingerprint={() => void registerPasskey(false)}
      onSkip={() => void skip()}
      onFinish={() => onClose()}
      inputRef={inputBox}
    />
  );
}
