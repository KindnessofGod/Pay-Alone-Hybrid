"use client";
// "My receipts and activity": what the server saved, so a payment can be proven after a page reset.
// Loads on its own after a payment and when a Firebase session already exists (never signs a new
// visitor in just to look).
import { useCallback, useEffect, useState } from "react";
import { api, firebaseConfigured, reportEvent } from "@/lib/firebase/client";
import { activityLine, badgeOf, receiptSentence, type EventView, type ReceiptView } from "@/lib/ui/history";

type Loaded = { receipts: ReceiptView[]; events: EventView[] };

export default function History({ refreshKey, speak }: { refreshKey: number; speak: (t: string) => Promise<void> }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signIn: boolean) => {
    if (!firebaseConfigured()) return;
    setBusy(true);
    try {
      const r = await api<Loaded>("/api/history", {}, { signIn });
      if (r.ok) {
        setData({ receipts: r.receipts ?? [], events: r.events ?? [] });
        setNote("");
      } else if (r.reason !== "signed_out") {
        setNote("Could not load your receipts. Please try again.");
        reportEvent({ event: "error", code: "history_failed" });
      }
    } catch {
      setNote("Could not load your receipts. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  // On page load (only if already signed in) and again after every payment.
  useEffect(() => {
    void load(false);
  }, [load, refreshKey]);

  const last = data?.receipts[0];
  return (
    <section className="card" aria-labelledby="history-h">
      <h2 id="history-h">My receipts and activity</h2>
      <div className="row">
        <button type="button" onClick={() => void load(true)} disabled={busy}>
          {data ? "Refresh" : "Show my receipts and activity"}
        </button>
        <button
          type="button"
          disabled={!last}
          onClick={() => void speak(last ? receiptSentence(last) : "").catch(() => undefined)}
        >
          Read my last receipt
        </button>
      </div>
      <div aria-live="polite">
        {note && <p className="status">{note}</p>}
        {busy && <p className="status">Loading…</p>}
        {data && data.receipts.length === 0 && <p className="status">No saved receipts yet.</p>}
      </div>
      {data && data.receipts.length > 0 && (
        <>
          <h3>Receipts</h3>
          <ul aria-label="Receipts, newest first">
            {data.receipts.map((r) => (
              <li key={r.id}>
                <span className={`badge ${r.simulated ? "rules" : "on_device"}`}>{badgeOf(r)}</span> {receiptSentence(r)}
              </li>
            ))}
          </ul>
        </>
      )}
      {data && data.events.length > 0 && (
        <>
          <h3>Activity</h3>
          <ul aria-label="Activity, newest first" className="status">
            {data.events.map((e, i) => (
              <li key={`${e.at}-${i}`}>{activityLine(e)}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
