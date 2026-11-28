"use client";
// "Judge demo: one screen, two people". The customer and the shop are on one page so a judge sees both sides.
// Nothing here is faked: the shop's request, the customer's approval (PIN or fingerprint, verified by the server),
// the payment and the PAID status all go through the same server routes as the real app. The only demo rule is
// server side (demo.ts): the same person may ask their own pay code. Wallet totals are sums of the server's records.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, firebaseConfigured, reportEvent } from "@/lib/firebase/client";
import { say } from "@/lib/hybrid/listen";
import { parseMajor } from "@/lib/money";
import { bigAmount } from "@/lib/ui/amountview";
import { initialDemo, MOVE_MS, stepDemo, tokenText, type DemoEvent } from "@/lib/ui/demoflow";
import { customerWalletLines, shopWalletLines, type Sum } from "@/lib/ui/demowallet";
import { formatPayCode, payCodeSpeech, requestPrompt, shopStatusView } from "@/lib/ui/requestprompt";
import Approve from "../Approve";
import { PayCodeView, RequestCard } from "../ui";
import { ShopStatus } from "../shop/ShopView";
import { DemoHalf, DemoShopForm, DemoStageView, DemoTopBar, DemoWallet, WaitingForRequest } from "./DemoView";

const POLL_MS = 2000;
const NAME_DEFAULT = "Mama Put";

const ERRORS: Record<string, string> = {
  bad_code: "A pay code has 6 digits.",
  unknown_code: "That pay code is not known. Reload the page to get your own.",
  bad_amount: "Type the amount in naira, for example 2000 or 1500.50.",
  over_limit: "That is more than the limit for one payment. Ask for a smaller amount.",
  bad_name: "Type the shop name using letters and numbers, up to 40 characters.",
  bad_note: "The note can only use letters, numbers and simple punctuation.",
  too_many_requests: "Too many requests in one minute. Wait a little and try again.",
  buyer_busy: "The customer already has 3 requests waiting. Answer those first.",
  demo_not_allowed: "Demo mode only works from this page. Reload /demo.",
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
interface ShopReq {
  id: string;
  ref: string;
  shopName: string;
  note?: string;
  amountMinor: string;
  assetCode: "NGN";
  assetScale: 2;
}
interface Summary {
  simulated: boolean;
  shop: { received: Sum[]; wallet: string | null };
  customer: { sentThisWeek: Sum[]; cap: { value: string; assetCode: string; assetScale: number }; wallet: string | null };
}

export default function DemoPage() {
  const [demo, setDemo] = useState(initialDemo);
  const send = useCallback((e: DemoEvent) => setDemo((s) => stepDemo(s, e)), []);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const chain = useRef<Promise<void>>(Promise.resolve());

  // One voice at a time: the customer's and the shop's lines wait for each other. Muting skips them. Screen text stays.
  const speak = useCallback((t: string): Promise<void> => {
    if (mutedRef.current || !t) return Promise.resolve();
    chain.current = chain.current.then(() => (mutedRef.current ? undefined : say(t))).catch(() => undefined);
    return chain.current;
  }, []);
  const toggleMute = () => {
    const next = !mutedRef.current;
    setMuted(next);
    mutedRef.current = next;
    if (next) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* nothing was speaking */
      }
    }
  };

  // ---- customer side
  const [payCode, setPayCode] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<ShopReq | null>(null);
  const [approving, setApproving] = useState<{ req: ShopReq; key: number } | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const announced = useRef(new Set<string>());
  const approvingRef = useRef<typeof approving>(null);
  approvingRef.current = approving;

  // ---- shop side
  const [shopName, setShopName] = useState(NAME_DEFAULT);
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("2000");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;
  const codeTouched = useRef(false);

  // ---- wallets (server sums; applied after the token lands so the numbers change when the money arrives)
  const [summary, setSummary] = useState<Summary | null>(null);
  const [bump, setBump] = useState(0);
  const pendingSummary = useRef<Summary | null>(null);
  const movingRef = useRef(false);
  movingRef.current = demo.stage === "moving";

  const refreshSummary = useCallback(async () => {
    try {
      const r = await api<Summary>("/api/demo/summary", {});
      if (!r.ok) return;
      if (movingRef.current) pendingSummary.current = r;
      else setSummary(r);
    } catch {
      /* the cards keep their last numbers */
    }
  }, []);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    reportEvent({ event: "demo_opened" });
    let off = false;
    api<{ code: string }>("/api/paycode", {})
      .then((r) => {
        if (off || !r.ok || !/^\d{6}$/.test(r.code)) return;
        setPayCode(r.code);
        if (!codeTouched.current) setCode(formatPayCode(r.code));
      })
      .catch(() => undefined);
    void refreshSummary();
    return () => {
      off = true;
    };
  }, [refreshSummary]);

  // Shop asks. `demo: true` is accepted by the server only from this page.
  async function ask() {
    setError("");
    const minor = parseMajor(amount, 2);
    if (!minor) return setError(ERRORS.bad_amount);
    if (!firebaseConfigured()) return setError("The app is not connected to its server here.");
    setBusy(true);
    try {
      const r = await api<{ request: { id: string; ref: string } }>("/api/shop/ask", { demo: true, code, amountMinor: minor, shopName, note: note || undefined });
      if (!r.ok) return setError(ERRORS[r.reason ?? ""] ?? "Something went wrong. Nothing was sent. Please try again.");
      const amt = { value: minor, assetCode: "NGN", assetScale: 2 };
      setLive({ id: r.request.id, ref: r.request.ref, shopName: shopName.trim(), amount: amt, status: "pending" });
      send({ type: "asked", amount: amt, ref: r.request.ref });
      void tick(); // show it on the customer side without waiting for the next poll
    } catch {
      setError("I could not reach the server. Nothing was sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const checkRequest = useCallback(
    (rq: ShopReq) => {
      setIncoming(null);
      setApproving({ req: rq, key: Date.now() });
      send({ type: "approving" });
    },
    [send],
  );

  const declineRequest = useCallback(
    async (rq: ShopReq) => {
      setIncoming(null);
      setRequestBusy(true);
      let done = false;
      try {
        done = (await api("/api/requests/decline", { id: rq.id })).ok;
      } catch {
        done = false;
      }
      setRequestBusy(false);
      void speak(done ? "Declined. Nothing was sent." : "I could not decline it. It will run out by itself in a few minutes. Nothing was sent.");
    },
    [speak],
  );

  // Poll: the customer's open requests, and the shop's status of its own request. The server decides both.
  const polling = useRef(false);
  const tick = useCallback(async () => {
    if (polling.current || !firebaseConfigured()) return;
    polling.current = true;
    try {
      const p = await api<{ requests: ShopReq[] }>("/api/requests/pending", {});
      if (p.ok && Array.isArray(p.requests)) {
        const busyWith = approvingRef.current?.req.id;
        const next = p.requests.find((x) => x.id !== busyWith);
        setIncoming((cur) => (cur && p.requests.some((x) => x.id === cur.id) ? cur : next ?? null));
        if (next && !busyWith && !announced.current.has(next.id)) {
          announced.current.add(next.id);
          void speak(requestPrompt(next.shopName, { value: next.amountMinor, assetCode: next.assetCode, assetScale: next.assetScale }, next.ref));
        }
      }
      const cur = liveRef.current;
      if (cur && cur.status === "pending") {
        const s = await api<{ status: Status }>("/api/shop/status", { id: cur.id });
        if (s.ok && s.status !== "pending") {
          setLive((l) => (l && l.id === cur.id ? { ...l, status: s.status } : l));
          if (s.status === "paid") {
            send({ type: "paid" });
            setIncoming(null);
            void refreshSummary();
          } else if (s.status === "declined") send({ type: "declined" });
          else send({ type: "expired" });
        }
      }
    } catch {
      /* the next poll tries again */
    } finally {
      polling.current = false;
    }
  }, [refreshSummary, send, speak]);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    const t = setInterval(() => void tick(), POLL_MS);
    const wake = () => void tick();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    void tick();
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [tick]);

  // The token crosses for MOVE_MS, then both cards show the new totals, and the shop says what a shop says.
  const stage = demo.stage;
  useEffect(() => {
    if (stage !== "moving") return;
    const t = setTimeout(() => {
      send({ type: "moveEnd" });
      if (pendingSummary.current) {
        setSummary(pendingSummary.current);
        pendingSummary.current = null;
      }
      setBump((b) => b + 1);
      const l = liveRef.current;
      if (l) {
        const v = shopStatusView("paid", l.ref, l.amount);
        if (v.speech) void speak(v.speech);
      }
    }, MOVE_MS);
    return () => clearTimeout(t);
  }, [stage, send, speak]);

  const newRequest = () => {
    setLive(null);
    setNote("");
    setError("");
    send({ type: "reset" });
    if (stage === "done") setApproving(null); // the paid receipt card is finished with
  };

  const view = live ? shopStatusView(live.status === "paid" && stage === "moving" ? "pending" : live.status, live.ref, live.amount) : null;
  const sw = shopWalletLines(summary?.shop.received ?? [], summary?.shop.wallet ?? null, summary?.simulated ?? true);
  const cw = customerWalletLines(summary?.customer.sentThisWeek ?? [], summary?.customer.cap ?? { value: "5000", assetCode: "USD", assetScale: 2 }, summary?.customer.wallet ?? null, summary?.simulated ?? true);
  const tokenAmt = demo.stage === "idle" ? null : demo.amount;
  const wordsMoved = stage === "moving" || stage === "done" ? `${tokenAmt ? bigAmount(tokenAmt) : ""} moved from the customer to the shop.` : "";

  const customer = (
    <DemoHalf side="customer" title="Customer (Ada, blind)" persona="Demo persona. Ada uses the app alone: she hears the request and approves it herself.">
      <DemoWalletCustomer cw={cw} fine={summary ? "Totals from this account's receipts. Not a balance: Open Payments has none." : "Loading from the server…"} bump={stage === "moving" ? 0 : bump} />
      <PayCodeView code={payCode} onSay={() => payCode && void speak(payCodeSpeech(payCode))} />
      {approving && (
        <Approve
          key={approving.key}
          payeeId=""
          amountMinor={approving.req.amountMinor}
          shopRequestId={approving.req.id}
          reference={approving.req.ref}
          speak={speak}
          listen={null}
          onPaid={() => {
            send({ type: "paid" });
            void refreshSummary();
          }}
          onClose={(outcome) => {
            setApproving(null);
            if (outcome === "stopped") send({ type: "stopped" });
          }}
        />
      )}
      {incoming && !approving && (
        <RequestCard
          shopName={incoming.shopName}
          amount={bigAmount({ value: incoming.amountMinor, assetCode: incoming.assetCode, assetScale: incoming.assetScale })}
          reference={incoming.ref}
          note={incoming.note}
          busy={requestBusy}
          onCheck={() => checkRequest(incoming)}
          onDecline={() => void declineRequest(incoming)}
        />
      )}
      {!incoming && !approving && <WaitingForRequest />}
    </DemoHalf>
  );

  const shop = (
    <DemoHalf side="shop" title={`Shop (${live?.shopName || shopName || NAME_DEFAULT})`} persona="The shop only asks. It cannot take money: the customer must approve.">
      <DemoWallet key={bump} title="Shop wallet" big={sw.big} lines={[sw.received]} address={sw.address} fine={summary ? "Counts the shop requests this server marked paid after a verified approval. Not a balance." : "Loading from the server…"} bump={stage === "moving" ? false : bump > 0} />
      {view && live ? (
        <ShopStatus tone={view.tone} headline={view.headline} sub={view.sub} shop={live.shopName} onNew={newRequest} />
      ) : (
        <DemoShopForm
          shopName={shopName}
          code={code}
          amount={amount}
          note={note}
          error={error}
          busy={busy}
          onShopName={setShopName}
          onCode={(v) => ((codeTouched.current = true), setCode(v))}
          onAmount={setAmount}
          onNote={setNote}
          onAsk={() => void ask()}
        />
      )}
      {!firebaseConfigured() && <p className="note">This run is not connected to the server, so the demo cannot ask or pay here.</p>}
    </DemoHalf>
  );

  return (
    <div className="dm">
      <DemoTopBar muted={muted} onMute={toggleMute} />
      <DemoStageView stage={stage} token={tokenAmt ? tokenText(tokenAmt) : undefined} screenReader={wordsMoved} customer={customer} shop={shop} />
    </div>
  );
}

function DemoWalletCustomer({ cw, fine, bump }: { cw: { big: string; sent: string; limit: string; address: string }; fine: string; bump: number }) {
  return <DemoWallet key={bump} title="Customer wallet" big={cw.big} lines={[cw.sent, cw.limit]} address={cw.address} fine={fine} bump={bump > 0} />;
}
