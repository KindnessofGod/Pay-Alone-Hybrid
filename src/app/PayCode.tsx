"use client";
// The person's own pay code (server-made on first request). Shown with a "Say my pay code" button.
import { useEffect, useState } from "react";
import { api, firebaseConfigured, reportEvent } from "@/lib/firebase/client";
import { payCodeSpeech } from "@/lib/ui/requestprompt";
import { PayCodeView } from "./ui";

export default function PayCode({ speak }: { speak: (t: string) => Promise<void> }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (!firebaseConfigured()) return;
    let off = false;
    api<{ code: string }>("/api/paycode", {})
      .then((r) => {
        if (!off && r.ok && typeof r.code === "string" && /^\d{6}$/.test(r.code)) setCode(r.code);
      })
      .catch(() => reportEvent({ event: "client_error", where: "paycode", code: "unreachable" }));
    return () => {
      off = true;
    };
  }, []);
  if (!firebaseConfigured()) return null;
  return <PayCodeView code={code} onSay={() => code && void speak(payCodeSpeech(code)).catch(() => undefined)} />;
}
