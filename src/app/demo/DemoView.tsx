"use client";
// /demo: the real customer app on an iPad and the real shop app on an iPhone, side by side. The page itself
// speaks nothing and approves nothing; it only watches the shop frame say "paid" (same origin postMessage) and
// shows that moment as a pill crossing the line. The amount comes from the shop frame, which got it from the server.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { addPaid, fitScale, formatNairaMinor, parseDemoMessage } from "@/lib/ui/demoframes";
import "./demo.css";

const IPAD = { w: 1216, h: 856 }; // landscape: 1180x820 screen plus an 18px bezel
const PHONE = { w: 422, h: 894 };
const FLIGHT_MS = 1200;

function useBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, stacked: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight, stacked: window.matchMedia("(max-width: 999px)").matches });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return [ref, box] as const;
}

function Fit({ native, box, children }: { native: { w: number; h: number }; box: { w: number; h: number; stacked: boolean }; children: ReactNode }) {
  const s = box.w ? fitScale({ w: box.w, h: box.stacked ? Infinity : box.h }, native) : 0.05;
  return (
    <div className="dm-fit" style={{ width: native.w * s, height: native.h * s }}>
      <div className="dm-dev-wrap" style={{ transform: `scale(${s})`, transformOrigin: "0 0", width: native.w, height: native.h, position: "absolute", left: 0, top: 0 }}>
        {children}
      </div>
    </div>
  );
}

export default function DemoView() {
  const params = useSearchParams();
  // Dev only: ?mock=1 shows fixed sample screens in the frames. It never exists in a production build.
  const mock = process.env.NODE_ENV !== "production" && params.get("mock") === "1";
  const mockState = params.get("state") ?? "idle";
  const srcCustomer = mock ? `/demo-mock?side=customer&state=${encodeURIComponent(mockState)}&embed=1` : "/?embed=1";
  const srcShop = mock ? `/demo-mock?side=shop&state=${encodeURIComponent(mockState)}&embed=1` : "/shop?embed=1&demo=1";

  const [gen, setGen] = useState(0);
  const [muted, setMuted] = useState(false);
  const [sent, setSent] = useState({ total: "0", refs: [] as string[] });
  const [recv, setRecv] = useState({ total: "0", refs: [] as string[] });
  const [shown, setShown] = useState(false);
  const [flight, setFlight] = useState<{ id: number; amountMinor: string; ref: string } | null>(null);
  const queue = useRef<{ amountMinor: string; ref: string }[]>([]);
  const flying = useRef(false);
  const seen = useRef(new Set<string>());
  const flightId = useRef(0);

  const customerFrame = useRef<HTMLIFrameElement>(null);
  const shopFrame = useRef<HTMLIFrameElement>(null);
  const ipadScreen = useRef<HTMLDivElement>(null);
  const phoneScreen = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const [leftRef, leftBox] = useBox();
  const [rightRef, rightBox] = useBox();

  const postMute = useCallback((on: boolean) => {
    for (const f of [customerFrame.current, shopFrame.current]) f?.contentWindow?.postMessage({ type: "payalone-demo", event: "mute", on }, window.location.origin);
  }, []);
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    postMute(next);
  };
  const onLoad = () => {
    if (muted) postMute(true);
  };

  const startFlight = useCallback(() => {
    if (flying.current) return;
    const next = queue.current.shift();
    if (!next) return;
    flying.current = true;
    setFlight({ id: ++flightId.current, ...next });
  }, []);

  // The shop frame says "paid". Check origin and shape, ignore a payment already seen, then fly the pill.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = parseDemoMessage(e.data, e.origin, window.location.origin);
      if (!m) return;
      const key = m.ref || `${m.amountMinor}@${Date.now()}`;
      if (m.ref) {
        if (seen.current.has(key)) return;
        seen.current.add(key);
      }
      queue.current.push({ amountMinor: m.amountMinor, ref: m.ref });
      startFlight();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [startFlight]);

  // Run the animation when a flight starts; update the counters when it lands.
  useEffect(() => {
    const el = pill.current;
    if (!flight || !el) return;
    const a = ipadScreen.current?.getBoundingClientRect();
    const b = phoneScreen.current?.getBoundingClientRect();
    const stacked = window.matchMedia("(max-width: 999px)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fin = () => {
      setSent((s) => addPaid(s, flight));
      setRecv((s) => addPaid(s, flight));
      setShown(true);
      setFlight(null);
      flying.current = false;
      startFlight();
    };
    if (!a || !b) return fin();
    const from = stacked ? { x: a.left + a.width / 2, y: a.top + 40 } : { x: a.right - 20, y: a.top + a.height / 2 };
    const to = stacked ? { x: b.left + b.width / 2, y: b.bottom - 120 } : { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    const at = (p: { x: number; y: number }) => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    const anim = reduce
      ? el.animate([{ transform: at(to), opacity: 0 }, { transform: at(to), opacity: 1, offset: 0.3 }, { transform: at(to), opacity: 1, offset: 0.8 }, { transform: at(to), opacity: 0 }], { duration: FLIGHT_MS, easing: "ease-in-out", fill: "forwards" })
      : el.animate([{ transform: at(from), opacity: 0 }, { transform: at(from), opacity: 1, offset: 0.08 }, { transform: at(to), opacity: 1, offset: 0.9 }, { transform: at(to), opacity: 0 }], { duration: FLIGHT_MS, easing: "ease-in-out", fill: "forwards" });
    anim.onfinish = fin;
    return () => {
      anim.onfinish = null;
      anim.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight?.id]);

  return (
    <div className="dm">
      <h1 className="vh">Pay Alone judge demo</h1>
      <header className="dm-top">
        <div className="dm-brand">
          <span className="dm-word">Pay alone.</span>
          <span className="dm-chip">Test money</span>
        </div>
        <div className="dm-acts">
          <button type="button" aria-pressed={muted} onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
          <button type="button" onClick={() => setGen((g) => g + 1)}>Start over</button>
        </div>
      </header>
      <div className="dm-body">
        <section className="dm-half dm-left" aria-label="Customer">
          <p className="dm-label">Customer · iPad</p>
          <div className="dm-stage" ref={leftRef}>
            <Fit native={IPAD} box={leftBox}>
              <div className="dm-dev dm-ipad">
                <span className="dm-btn t" aria-hidden="true" />
                <div className="dm-scr" ref={ipadScreen}>
                  <iframe key={`c${gen}`} ref={customerFrame} src={srcCustomer} title="Customer app on an iPad (landscape)" width={1180} height={820} allow="microphone; publickey-credentials-get *; publickey-credentials-create *" onLoad={onLoad} />
                </div>
              </div>
            </Fit>
          </div>
          <p className="dm-count" style={{ visibility: shown ? "visible" : "hidden" }} aria-live="polite">Sent {formatNairaMinor(sent.total)}</p>
        </section>
        <div className="dm-rule" aria-hidden="true" />
        <section className="dm-half dm-right" aria-label="Shop">
          <p className="dm-label">Shop · iPhone</p>
          <div className="dm-stage" ref={rightRef}>
            <Fit native={PHONE} box={rightBox}>
              <div className="dm-dev dm-phone">
                {["a", "b", "c", "d"].map((k) => (
                  <span key={k} className={`dm-btn ${k}`} aria-hidden="true" />
                ))}
                <div className="dm-scr" ref={phoneScreen}>
                  <iframe key={`s${gen}`} ref={shopFrame} src={srcShop} title="Shop app on an iPhone" width={402} height={874} onLoad={onLoad} />
                  <span className="dm-island" aria-hidden="true" />
                </div>
              </div>
            </Fit>
          </div>
          <p className="dm-count" style={{ visibility: shown ? "visible" : "hidden" }} aria-live="polite">Received {formatNairaMinor(recv.total)}</p>
        </section>
      </div>
      {flight && (
        <div className="dm-pill" ref={pill} aria-hidden="true">
          {formatNairaMinor(flight.amountMinor)} {typeof window !== "undefined" && window.matchMedia("(max-width: 999px)").matches ? "↑" : "→"}
        </div>
      )}
    </div>
  );
}
