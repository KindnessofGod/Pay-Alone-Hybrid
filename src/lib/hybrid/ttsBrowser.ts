// Browser wiring for tts.ts: loads Kokoro-82M on this computer, plays its audio with Web Audio, and holds the
// browser's own voice as the fallback. Browser only; nothing here runs on the server.
"use client";
import { createSpeaker, type Audio, type Model, type Playing } from "./tts";
import { pickVoice } from "./voice";

const KOKORO_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm"; // pinned exact version
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
// "af_heart": Kokoro's warmest, clearest American English female voice (top-graded in the Kokoro voice list).
// "af_bella" is the next best choice if a different tone is wanted.
export const KOKORO_VOICE = "af_heart";

type KokoroTts = { generate(text: string, o: { voice: string; speed?: number }): Promise<{ audio: Float32Array; sampling_rate: number }> };

async function loadKokoro(): Promise<Model> {
  if (typeof window === "undefined") throw new Error("Kokoro loads in the browser only");
  const { KokoroTTS } = await import("kokoro-js");
  const load = (device: "webgpu" | "wasm") => KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device }) as Promise<KokoroTts>;
  let tts: KokoroTts;
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try {
    // WebGPU only when an adapter really exists; if anything about it fails we use wasm, which works everywhere.
    if (!gpu || !(await gpu.requestAdapter())) throw new Error("no webgpu");
    tts = await load("webgpu");
    await tts.generate("Ready.", { voice: KOKORO_VOICE }); // prove it works before we trust it
  } catch {
    tts = await load("wasm");
  }
  return { generate: (text) => tts.generate(text, { voice: KOKORO_VOICE }) };
}

let ctx: AudioContext | undefined;
function audioContext(): AudioContext {
  const C = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
  ctx ??= new (C.AudioContext ?? C.webkitAudioContext!)();
  return ctx;
}

function playAudio(a: Audio): Playing {
  const c = audioContext();
  void c.resume?.();
  const buf = c.createBuffer(1, a.audio.length, a.sampling_rate);
  buf.copyToChannel(a.audio as Float32Array<ArrayBuffer>, 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  src.onended = finish;
  src.start();
  // Never wait longer than the clip lasts (plus a margin) even if "ended" is not delivered.
  const t = setTimeout(finish, buf.duration * 1000 + 1500);
  void done.then(() => clearTimeout(t));
  return {
    done,
    stop: () => {
      try {
        src.stop();
      } catch {
        /* not started or already stopped */
      }
      finish();
    },
  };
}

/** The browser's own voice (speechSynthesis), with the old safety timeout so it never hangs. */
export function browserVoice(text: string): Playing {
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  if (typeof speechSynthesis === "undefined") {
    finish();
    return { done, stop: finish };
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(speechSynthesis.getVoices?.() ?? []);
  if (voice) u.voice = voice;
  u.rate = 0.95;
  // Chrome sometimes never fires onend; never wait longer than the sentence could take.
  const t = setTimeout(finish, 3_000 + text.length * 120);
  void done.then(() => clearTimeout(t));
  u.onend = finish;
  u.onerror = finish;
  speechSynthesis.speak(u);
  return {
    done,
    stop: () => {
      try {
        speechSynthesis.cancel();
      } catch {
        /* nothing to cancel */
      }
      finish();
    },
  };
}

export const speaker = createSpeaker({ loadModel: loadKokoro, play: playAudio, fallback: browserVoice, generateLimitMs: 8_000 });
