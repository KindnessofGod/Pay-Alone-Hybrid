// Browser audio for the Gemini Live prototype: microphone at 16 kHz in, model voice at 24 kHz out.
// The pure helpers are tested; the Web Audio parts need a real browser and microphone.
"use client";

export function floatToPcm16Base64(samples: Float32Array): string {
  const buf = new ArrayBuffer(samples.length * 2);
  const v = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function pcm16Base64ToFloat(b64: string): Float32Array {
  const bin = atob(b64);
  const n = Math.floor(bin.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (x >= 0x8000) x -= 0x10000;
    out[i] = x / 32768;
  }
  return out;
}

/** Opens the microphone (this is where the browser asks permission) and calls onChunk with base64 PCM16 at 16 kHz. */
export async function startMic(onChunk: (b64: string) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: 16_000 });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1); // simple and widely supported; fine for a prototype
  proc.onaudioprocess = (e) => onChunk(floatToPcm16Base64(e.inputBuffer.getChannelData(0)));
  src.connect(proc);
  proc.connect(ctx.destination); // required for the processor to run; its output is silent
  return () => {
    proc.onaudioprocess = null;
    src.disconnect();
    proc.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
  };
}

/** Plays the model's 24 kHz PCM in order. flush() cuts anything queued (interruption, or our own read-back starting). */
export function createPlayer() {
  const ctx = new AudioContext({ sampleRate: 24_000 });
  let at = 0;
  let sources: AudioBufferSourceNode[] = [];
  return {
    play(b64: string) {
      const f = pcm16Base64ToFloat(b64);
      if (!f.length) return;
      const b = ctx.createBuffer(1, f.length, 24_000);
      b.copyToChannel(f as Float32Array<ArrayBuffer>, 0);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      at = Math.max(at, ctx.currentTime + 0.02);
      s.start(at);
      at += b.duration;
      sources.push(s);
      s.onended = () => (sources = sources.filter((x) => x !== s));
    },
    /** Milliseconds of queued sound still to play, so callers can wait for the end of a sentence (the turn ends before the audio does). */
    pendingMs() {
      return Math.max(0, Math.round((at - ctx.currentTime) * 1000));
    },
    flush() {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      sources = [];
      at = 0;
    },
    close() {
      this.flush();
      void ctx.close().catch(() => undefined);
    },
  };
}
