"use client";
// React glue for the Gemini Live prototype (flag ?live=1). The rules live in src/lib/hybrid/live.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { closeCodeOf, liveErrorCode, runLive, sanitizeReason, type LiveController, type LiveDeps, type LiveTurn } from "@/lib/hybrid/live";
import { createPlayer, startMic } from "@/lib/hybrid/liveAudio";
import { reportEvent } from "@/lib/firebase/client";

export type LiveHandlers = Pick<LiveDeps, "understand" | "present" | "onTripwire"> & {
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
      const session = await connectLive();
      const p = player;
      const c = runLive(session, {
        understand: (said) => h.current.understand(said),
        present: async (r, said) => {
          const ok = await h.current.present(r, said);
          reportEvent({ event: "live_tool", shown: ok, reason: ok ? "approve_card" : "no_payment" });
          if (ok) p.flush(); // anything the model already queued is cut; our own read-back is next
          return ok;
        },
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
  return { active, turns, failed, start, stop, resume };
}
