import { describe, expect, it } from "vitest";
import { floatToPcm16Base64, pcm16Base64ToFloat } from "./liveAudio";

describe("live audio helpers", () => {
  it("float samples become 16-bit little-endian PCM in base64 and back", () => {
    const b64 = floatToPcm16Base64(new Float32Array([0, 1, -1, 0.5]));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(bytes.length).toBe(8);
    const v = new DataView(bytes.buffer);
    expect([v.getInt16(0, true), v.getInt16(2, true), v.getInt16(4, true), v.getInt16(6, true)]).toEqual([0, 32767, -32768, 16384]);
    const back = pcm16Base64ToFloat(b64);
    expect(back[1]).toBeCloseTo(1, 3);
    expect(back[2]).toBeCloseTo(-1, 3);
  });
  it("clips out-of-range samples", () => {
    const v = new DataView(Uint8Array.from(atob(floatToPcm16Base64(new Float32Array([5, -5]))), (c) => c.charCodeAt(0)).buffer);
    expect([v.getInt16(0, true), v.getInt16(2, true)]).toEqual([32767, -32768]);
  });
});
