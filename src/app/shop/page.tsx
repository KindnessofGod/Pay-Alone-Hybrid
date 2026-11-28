"use client";
// The shop page: type the customer's pay code and an amount, press "Ask for payment", and watch the
// status. The SERVER decides the status (pending, paid, declined, expired); this page only reads it.
// There are no webhooks, so it asks every 2 seconds.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, firebaseConfigured } from "@/lib/firebase/client";
import { parseMajor } from "@/lib/money";
import { shopStatusView } from "@/lib/ui/requestprompt";
import { ShopForm, ShopShell, ShopStatus } from "./ShopView";

const NAME_KEY = "payalone.shopName";
const POLL_MS = 2000;

const ERRORS: Record<string, string> = {
  bad_code: "A pay code has 6 digits. Check it with the customer.",
  unknown_code: "No customer has that pay code. Check the digits.",
  bad_amount: "Type the amount in naira, for example 2000 or 1500.50.",
  over_limit: "That is more than the limit for one payment. Ask for a smaller amount.",
  bad_name: "Type your shop name using letters and numbers, up to 40 characters.",
  bad_note: "The note can only use letters, numbers and simple punctuation.",
  self_request: "You cannot ask your own device to pay. Use a different device or browser from the customer's.",
  too_many_requests: "Too many requests in one minute. Wait a little and try again.",
  buyer_busy: "This customer already has 3 requests waiting. Ask them to answer those first.",
  signed_out: "You are signed out. Please reload the page.",
  server_not_set_up: "The server is not set up yet.",
  app_check: "This page could not be verified. Please reload it.",
};

type Status = "pending" | "paid" | "declined" | "expired";
interface Live {
  id: string;
  ref: string;
  shopName: string;
  amount: { value: string; assetCode: string; assetScale: number };
  status: Status;
}

function speakNow(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-NG";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* the screen still shows it */
  }
}

export default function ShopPage() {
  const [shopName, setShopName] = useState("");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const spoken = useRef("");

  useEffect(() => {
    try {
      setShopName(window.localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      /* no storage: the name is typed each time */
    }
  }, []);
  const changeName = (v: string) => {
    setShopName(v);
    try {
      window.localStorage.setItem(NAME_KEY, v);
    } catch {
      /* ignore */
    }
  };

  async function ask() {
    setError("");
    const minor = parseMajor(amount, 2);
    if (!minor) return setError(ERRORS.bad_amount);
    if (!firebaseConfigured()) return setError("The app is not connected to its server here.");
    setBusy(true);
    try {
      const r = await api<{ request: { id: string; ref: string } }>("/api/shop/ask", { code, amountMinor: minor, shopName, note: note || undefined });
      if (!r.ok) return setError(ERRORS[r.reason ?? ""] ?? "Something went wrong. Nothing was sent. Please try again.");
      spoken.current = "";
      setLive({ id: r.request.id, ref: r.request.ref, shopName: shopName.trim(), amount: { value: minor, assetCode: "NGN", assetScale: 2 }, status: "pending" });
    } catch {
      setError("I could not reach the server. Nothing was sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Ask the server for the status every 2 seconds until it is no longer pending.
  const liveId = live?.id;
  const livePending = live?.status === "pending";
  useEffect(() => {
    if (!liveId || !livePending) return;
    let off = false;
    const tick = async () => {
      try {
        const r = await api<{ status: Status }>("/api/shop/status", { id: liveId });
        if (off || !r.ok) return;
        setLive((cur) => (cur && cur.id === liveId ? { ...cur, status: r.status } : cur));
      } catch {
        /* keep asking */
      }
    };
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [liveId, livePending]);

  const view = live ? shopStatusView(live.status, live.ref, live.amount) : null;
  useEffect(() => {
    if (view?.speech && live && spoken.current !== live.id) {
      spoken.current = live.id;
      speakNow(view.speech);
    }
  }, [view?.speech, live]);

  const again = useCallback(() => {
    setLive(null);
    setCode("");
    setAmount("");
    setNote("");
  }, []);

  return (
    <ShopShell>
      {view && live ? (
        <ShopStatus tone={view.tone} headline={view.headline} sub={view.sub} shop={live.shopName} onNew={again} />
      ) : (
        <ShopForm shopName={shopName} code={code} amount={amount} note={note} error={error} busy={busy} onShopName={changeName} onCode={setCode} onAmount={setAmount} onNote={setNote} onAsk={() => void ask()} />
      )}
    </ShopShell>
  );
}
