"use client";
// "My receipts and activity": what the server saved, so a payment can be proven after a page reset.
// Loads on its own after a payment and when a Firebase session already exists (never signs a new
// visitor in just to look).
import { useCallback, useEffect, useState } from "react";
import { api, firebaseConfigured, reportEvent } from "@/lib/firebase/client";
import { bigAmount } from "@/lib/ui/amountview";
import { ReceiptRow } from "./ui";
import { activityLine, badgeOf, debugRow, receiptSentence, type EventView, type ReceiptView } from "@/lib/ui/history";

type Loaded = { receipts: ReceiptView[]; events: EventView[] };

export type HistoryState = { data: Loaded | null; note: string; busy: boolean; load: (signIn: boolean) => Promise<void> };

/** Loads the person's receipts and activity. On page load (only if already signed in) and again whenever refreshKey changes. */
export function useHistory(refreshKey: number): HistoryState {
  const [data, setData] = useState<Loaded | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signIn: boolean) => {
    if (!firebaseConfigured()) return;
    setBusy(true);
    const t0 = performance.now();
    try {
      const r = await api<Loaded>("/api/history", {}, { signIn });
      if (r.ok) {
        reportEvent({ event: "history_load", count: (r.receipts ?? []).length, ms: Math.round(performance.now() - t0) });
        setData({ receipts: r.receipts ?? [], events: r.events ?? [] });
        setNote("");
      } else if (r.reason !== "signed_out") {
        setNote("Could not load your receipts. Please try again.");
        reportEvent({ event: "client_error", where: "history", code: "failed" });
      }
    } catch {
      setNote("Could not load your receipts. Please try again.");
      reportEvent({ event: "client_error", where: "history", code: "unreachable" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load, refreshKey]);
  return { data, note, busy, load };
}

export default function History({ h, speak }: { h: HistoryState; speak: (t: string) => Promise<void> }) {
  const { data, note, busy, load } = h;
  const last = data?.receipts[0];
  return (
    <section aria-labelledby="history-h" className="chat history">
      <h2 id="history-h" className="h3">Recent receipts</h2>
      <div className="row2">
        <button type="button" className="btn ghost small" onClick={() => void load(true)} disabled={busy}>
          {data ? "Refresh" : "Show my receipts and activity"}
        </button>
        <button type="button" className="btn ghost small" disabled={!last} onClick={() => (reportEvent({ event: "read_receipt" }), void speak(last ? receiptSentence(last) : "").catch(() => undefined))}>
          <span aria-hidden="true">🔊</span> Read my last receipt
        </button>
      </div>
      <div aria-live="polite">
        {note && <p className="note">{note}</p>}
        {busy && <p className="note">Loading…</p>}
        {data && data.receipts.length === 0 && <p className="note">No saved receipts yet.</p>}
      </div>
      {data && data.receipts.length > 0 && (
        <ul className="list" aria-label="Receipts, newest first">
          {data.receipts.map((r) => (
            <ReceiptRow
              key={r.id}
              name={r.payeeName}
              sub={`${new Date(r.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${r.method === "passkey" ? "fingerprint" : "PIN"}`}
              amount={bigAmount(r.debit)}
              badge={badgeOf(r)}
              simulated={r.simulated}
            />
          ))}
        </ul>
      )}
      {data && data.events.length > 0 && (
        <>
          <h3 className="h3">Activity</h3>
          <ul aria-label="Activity, newest first" className="note">
            {data.events.slice(0, 30).map((e, i) => (
              <li key={`${e.at}-${i}`}>{activityLine(e)}</li>
            ))}
          </ul>
          <details>
            <summary>Debug log: my last {data.events.length} steps</summary>
            <ol aria-label="Debug log, newest first" className="note">
              {data.events.map((e, i) => (
                <li key={`d${i}`} style={{ color: "var(--ink)", fontSize: 14, padding: "2px 0" }}>
                  {(() => {
                    const r = debugRow(e);
                    return (
                      <>
                        <span>{r.time}</span> <strong>{r.event}</strong> <span>{r.status}</span> {r.reason && <span>({r.reason})</span>}
                      </>
                    );
                  })()}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
