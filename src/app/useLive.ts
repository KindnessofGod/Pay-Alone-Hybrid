"use client";
// React glue for Gemini Live, the default conversation engine (?live=0 turns it off). The rules live in src/lib/hybrid/live.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { closeCodeOf, liveErrorCode, runLive, sanitizeReason, type LiveController, type LiveDeps, type LiveTurn } from "@/lib/hybrid/live";
import { createPlayer, startMic } from "@/lib/hybrid/liveAudio";
import { reportEvent } from "@/lib/firebase/client";
import type { LangCode } from "@/lib/hybrid/languages";
import type { DeviceCheckResult } from "@/lib/hybrid/nanocheck";

export type LiveHandlers = Pick<LiveDeps, "contacts" | "limitMinor" | "present" | "understand" | "onTripwire" | "deviceCheck"> & {
  /** The Nano double-check finished (agree, mismatch or unavailable). A fixed word; the page lights the strip. */
  onCheck?: (c: DeviceCheckResult) => void;
  /** Live ended by itself (socket closed or failed), not because the person stopped it. */
  onClosed?: () => void;
  pronunciation?: Record<string, string>;
  /** Short, plain message for the screen when Live cannot run; the normal flow stays available. */
  onProblem: (say: string) => void;
};

const SAY: Record<string, string> = {
  mic_denied: "I could not use the microphone, so the live voice is off. You can type, or use the normal button.",
  quota: "The live voice has reached its limit for now. I will use the normal voice instead.",
  unavailable: "The live voice is not available right now. I will use the normal voice instead.",
  other: "The live voice stopped working. I will use the normal voice instead.",
};

export function useLive(handlers: LiveHandlers) {
  const h = useRef(handlers);
  h.current = handlers;
  const ctrl = useRef<LiveController | null>(null);
  const stopAudio = useRef<() => void>(() => undefined);
  const playerRef = useRef<ReturnType<typeof createPlayer> | null>(null);
  const greeting = useRef<Promise<void>>(Promise.resolve());
  const [active, setActive] = useState(false);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [failed, setFailed] = useState(false);
  const [paused, setPausedState] = useState(false); // the person paused the microphone (space bar)
  // ?debug=1 only: raw tool calls and what this session heard. Memory only, never sent anywhere, gone on reload.
  const [toolLog, setToolLog] = useState<{ call: { name: string; args?: unknown }; response: unknown }[]>([]);

  const teardown = useCallback(() => {
    stopAudio.current();
    stopAudio.current = () => undefined;
    ctrl.current = null;
    setActive(false);
  }, []);

  const stop = useCallback(async () => {
    await ctrl.current?.stop();
  }, []);

  /** Connects, then the model greets first (opening is "[app opened]" or "[app opened again]"). True when Live is running. */
  const start = useCallback(async (lang: LangCode, opening: string): Promise<boolean> => {
    if (ctrl.current) return true;
    setPausedState(false);
    setFailed(false);
    setTurns([]);
    setToolLog([]);
    let stopMic: (() => void) | undefined;
    let player: ReturnType<typeof createPlayer> | undefined;
    let stage: "mic" | "player" | "connect" | "session" = "player";
    const fail = (e: unknown) => {
      const code = liveErrorCode(e);
      stopMic?.();
      player?.close();
      const cc = closeCodeOf(e);
      reportEvent({ event: "live_session", outcome: "error", code, stage, reason: sanitizeReason(e), ...(cc === undefined ? {} : { close_code: cc }) });
      setFailed(true);
      h.current.onProblem(SAY[code] ?? SAY.other);
    };
    try {
      player = createPlayer(); // inside the person's key press or tap, so the browser lets it make sound
      stage = "connect";
      const { connectLive } = await import("@/lib/firebase/live");
      const session = await connectLive(h.current.contacts, h.current.pronunciation, lang);
      const p = player;
      playerRef.current = p;
      const c = runLive(session, {
        contacts: h.current.contacts,
        understand: (said) => h.current.understand!(said),
        limitMinor: () => h.current.limitMinor(),
        deviceCheck: h.current.deviceCheck ? (said, lp) => h.current.deviceCheck!(said, lp) : undefined,
        onCheck: (c) => {
          reportEvent({ event: "live_check", result: c.result, source: c.source }); // a fixed word and a source, no content
          h.current.onCheck?.(c);
        },
        present: async (r, said, meta) => {
          const ok = await h.current.present(r, said, meta);
          if (ok) p.flush(); // anything the model already queued is cut; our own read-back is next
          return ok;
        },
        // Counts and fixed words only: no names, no amounts, no sentences.
        onTool: (e) => {
          reportEvent({ event: "live_tool", shown: e.shown, reason: e.reason });
          setToolLog((l) => [...l, { call: { name: e.call.name, args: e.call.args }, response: e.response }]);
        },
        onTurnDone: (who, chars) => reportEvent({ event: "live_turn", who, chars }),
        onTurns: setTurns,
        onTripwire: (s) => {
          p.flush();
          h.current.onTripwire(s);
        },
        onMismatch: () => reportEvent({ event: "template_mismatch" }), // a count only, never the words
        onAudioOut: (b) => p.play(b),
        onInterrupted: () => p.flush(),
        onEnd: (how, code, detail) => {
          stopMic?.();
          p.close();
          teardown();
          if (how === "error") {
            reportEvent({
              event: "live_session",
              outcome: "error",
              code: code ?? "other",
              stage: "session",
              ...(detail?.reason ? { reason: detail.reason } : {}),
              ...(detail?.closeCode === undefined ? {} : { close_code: detail.closeCode }),
            });
            setFailed(true);
            h.current.onProblem(SAY[code ?? "other"] ?? SAY.other);
          } else reportEvent({ event: "live_session", outcome: "ended", ...(code ? { code } : {}) });
          if (how === "error" || (how === "ended" && !code)) h.current.onClosed?.(); // not stopped by the person, not the PIN tripwire
        },
      });
      ctrl.current = c;
      stopAudio.current = () => undefined;
      setActive(true);
      reportEvent({ event: "live_session", outcome: "started" });
      greeting.current = c.sendText(opening, { wait: true }).catch(() => undefined); // the model speaks first: nobody here can see the screen
      stage = "mic";
      stopMic = await startMic((b) => ctrl.current?.sendMic(b));
      return true;
    } catch (e) {
      fail(e);
      void ctrl.current?.stop();
      return false;
    }
  }, [teardown]);

  const resume = useCallback(() => ctrl.current?.resume(), []);
  const pauseMic = useCallback(() => ctrl.current?.pauseMic(), []);
  /** Space bar: the microphone stays closed until pressed again. */
  const togglePause = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    const v = !c.isUserPaused();
    c.setUserPaused(v);
    setPausedState(v);
  }, []);
  /** Our own sentence in the Live voice. "failed" when there is no session. */
  const speakExact = useCallback(async (t: string): Promise<"spoken" | "mismatch" | "failed"> => {
    if (!ctrl.current) return "failed";
    const r = await ctrl.current.speakExact(t);
    // the turn ends before the sound does: wait for the tail, so nothing (the next sentence, the browser's listening) starts on top of it
    const tail = playerRef.current?.pendingMs() ?? 0;
    if (tail > 0) await new Promise((x) => setTimeout(x, tail + 120));
    return r;
  }, []);
  /** Resolves when the model has finished its opening greeting. */
  const afterGreeting = useCallback(async () => {
    await greeting.current;
    const tail = playerRef.current?.pendingMs() ?? 0;
    if (tail > 0) await new Promise((x) => setTimeout(x, tail + 120));
  }, []);
  /** A plain text turn, e.g. a first-run line. Waits for the model to finish speaking when wait is set. */
  const sendText = useCallback(async (t: string, wait = false) => void (await ctrl.current?.sendText(t, { wait })), []);
  useEffect(() => () => void ctrl.current?.stop(), []);
  return { active, turns, failed, paused, toolLog, start, stop, resume, pauseMic, togglePause, speakExact, sendText, afterGreeting };
}
