"use client";
// The glass voice orb from the original Pay Alone app (src/components/GlassOrb.tsx), same fragment shader,
// drawn with plain WebGL (no three.js). Without WebGL it falls back to a CSS sphere. Decorative: aria-hidden.
import { useEffect, useRef } from "react";

export type OrbMode = "idle" | "connecting" | "listening" | "speaking";

const PALETTES: Record<OrbMode, [string, string, string, string]> = {
  idle: ["#0b4f3e", "#1a9a84", "#8ef0d2", "#e2f8b8"],
  connecting: ["#3d5a52", "#7f9e94", "#cfe3dc", "#f1f7f4"],
  speaking: ["#06493a", "#11a88f", "#7cf0d8", "#d9f7a0"],
  listening: ["#103e8f", "#2a8fe0", "#8ce9ff", "#d8fff4"],
};

const VERT = `attribute vec2 position; varying vec2 vUv; void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uLevel;
uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4;
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float edge = 1.0 - smoothstep(0.975, 1.0, r);
  if (edge <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 n = normalize(vec3(p, z));
  float t = uTime * (0.35 + uLevel * 0.9);
  vec3 q = n * 1.25;
  q.xy += 0.35 * vec2(sin(t * 0.7 + q.y * 2.0), cos(t * 0.6 + q.x * 2.0));
  float w1 = sin(q.x * 2.6 + t + 1.6 * sin(q.y * 1.9 - t * 0.6));
  float w2 = sin(q.y * 2.9 - t * 0.8 + 1.6 * sin(q.z * 2.3 + t * 0.5));
  float w3 = sin(q.z * 2.4 + t * 0.55 + 1.6 * sin(q.x * 2.1 + t * 0.9));
  float f = (w1 + w2 + w3) / 3.0;
  float silk = pow(0.5 + 0.5 * sin(f * 5.5 + t * 0.8 + uLevel * 2.0), 3.0);
  float silk2 = pow(0.5 + 0.5 * sin(f * 3.2 - t * 0.6 + 1.7), 4.0);
  vec3 col = mix(uC1, uC2, smoothstep(-0.9, 0.7, p.y + 0.35 * f));
  col = mix(col, uC3, silk * 0.85);
  col = mix(col, uC4, silk2 * 0.7);
  col += vec3(1.0) * pow(silk, 6.0) * 0.35;
  col = mix(col, mix(uC3, vec3(1.0), 0.6), (1.0 - z) * 0.35);
  float fres = pow(1.0 - z, 3.0);
  col = mix(col, vec3(1.0), fres * 0.6);
  col += uC3 * 0.25 * smoothstep(0.8, 0.0, r) * (0.4 + uLevel);
  col += vec3(1.0) * smoothstep(0.5, 0.0, length((p - vec2(-0.3, 0.45)) * vec2(1.0, 1.6))) * 0.38;
  col += vec3(1.0) * smoothstep(0.07, 0.0, length(p - vec2(-0.42, 0.55))) * 0.55;
  col += uC4 * smoothstep(0.35, 0.0, length((p - vec2(0.2, -0.62)) * vec2(1.0, 2.2))) * 0.25;
  gl_FragColor = vec4(col * edge, edge);
}`;

const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export function GlassOrb({ mode = "idle", level, size = 260, className }: { mode?: OrbMode; level?: () => number; size?: number | string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  const levelRef = useRef(level);
  useEffect(() => {
    modeRef.current = mode;
    levelRef.current = level;
  }, [mode, level]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) {
      el.classList.add("glass-orb-fallback");
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      el.classList.add("glass-orb-fallback");
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uTime = U("uTime"), uLevel = U("uLevel");
    const uC = [U("uC1"), U("uC2"), U("uC3"), U("uC4")];
    el.appendChild(canvas);

    const fit = () => {
      const s = Math.max(1, el.clientWidth);
      const px = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(s * px);
      canvas.height = Math.round(s * px);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const cur = PALETTES[modeRef.current].map(rgb);
    let smooth = 0;
    let time = 0;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const lvl = Math.max(0, Math.min(1, levelRef.current?.() ?? (modeRef.current === "speaking" ? 0.35 : 0.1)));
      smooth += (lvl - smooth) * Math.min(1, dt * 8);
      time += reduce ? dt * 0.2 : dt;
      const pal = PALETTES[modeRef.current].map(rgb);
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) cur[i][k] += (pal[i][k] - cur[i][k]) * Math.min(1, dt * 3);
      gl.uniform1f(uTime, time);
      gl.uniform1f(uLevel, smooth);
      for (let i = 0; i < 4; i++) gl.uniform3f(uC[i], cur[i][0], cur[i][1], cur[i][2]);
      el.style.setProperty("--orb-level", smooth.toFixed(3));
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      canvas.remove();
    };
  }, []);

  return (
    <div className={`glass-orb ${mode} ${className ?? ""}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="glass-orb-halo" />
      <div className="glass-orb-canvas" ref={box} />
    </div>
  );
}
