"use client";
// React glue for the Gemini Live prototype (flag ?live=1). The rules live in src/lib/hybrid/live.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { closeCodeOf, liveErrorCode, runLive, sanitizeReason, type LiveController, type LiveDeps, type LiveTurn } from "@/lib/hybrid/live";
import { createPlayer, startMic } from "@/lib/hybrid/liveAudio";
import { reportEvent } from "@/lib/firebase/client";

export type LiveHandlers = Pick<LiveDeps, "contacts" | "limitMinor" | "present" | "understand" | "onTripwire"> & {
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
  const [active, setActive] = useState(false);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [failed, setFailed] = useState(false);
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

  const start = useCallback(async () => {
    if (ctrl.current) return;
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
      player = createPlayer();
      stage = "mic";
      stopMic = await startMic((b) => ctrl.current?.sendMic(b));
      stage = "connect";
      const { connectLive } = await import("@/lib/firebase/live");
      const session = await connectLive(h.current.contacts, h.current.pronunciation);
      const p = player;
      const c = runLive(session, {
        contacts: h.current.contacts,
        understand: (said) => h.current.understand!(said),
        limitMinor: () => h.current.limitMinor(),
        present: async (r, said) => {
          const ok = await h.current.present(r, said);
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
        },
      });
      ctrl.current = c;
      stopAudio.current = () => undefined;
      setActive(true);
      reportEvent({ event: "live_session", outcome: "started" });
    } catch (e) {
      fail(e);
    }
  }, [teardown]);

  const resume = useCallback(() => ctrl.current?.resume(), []);
  useEffect(() => () => void ctrl.current?.stop(), []);
  return { active, turns, failed, toolLog, start, stop, resume };
}
