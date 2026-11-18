"use client";

// The token field: every token of the billing agent run as one point, drawn by WebGL2.
// Scenes are positions and colors per dot; the vertex shader blends them, so the CPU only moves
// uniforms. Scroll, the pointer and file drags write through `api`. The frame loop eases toward it.

import { motionValue } from "motion/react";
import { useEffect, useRef } from "react";
import { buildStatic, GALAXY, galaxyFrame, HERO, layout, replayRects, RING, wasteLayout, type FieldRun } from "./layout";

export type FieldCtrl = {
  /** 0 in the hero, 1 when the replay scene owns the field. */
  scene: number;
  /** Replay playhead, 0..1 of the run, a little past 1 so the last call lands. */
  play: number;
  /** 0..1: each dot takes the color of its price per token. */
  ignite: number;
  /** 0 = recorded prices, 1 = every call on the model in `pin` / `pout` (USD per token). */
  model: { mix: number; pin: number; pout: number };
  /** 0..1: waste falls into the heap. */
  waste: number;
  /** 0..1: the field gathers into the closing ring. */
  ring: number;
  /** 0..1: the tokens step back while the waiting scene shows dead time. */
  dim: number;
  /** One weight per finding group: cache, loop, retry, premium, tools. A lit group turns orange. */
  focus: number[];
  /** 0..1: the whole field fades out, for content that needs a clean background. */
  hide: number;
  /** 0..1: while hidden, every dot gathers into one point at the ring's center. The ring grows from it. */
  origin: number;
  mouse: { x: number; y: number; on: boolean };
  pull: { x: number; y: number; on: boolean };
  sink: { x: number; y: number; on: boolean };
};

/**
 * The field's input, and the only way to write it. Components call these from handlers and scroll
 * events. The motion values carry the same numbers to DOM overlays that line up with the field.
 */
export function makeField() {
  const ctrl: FieldCtrl = {
    scene: 0,
    play: 0,
    ignite: 0,
    model: { mix: 0, pin: 0, pout: 0 },
    waste: 0,
    ring: 0,
    dim: 0,
    focus: [0, 0, 0, 0, 0],
    hide: 0,
    origin: 0,
    mouse: { x: -9999, y: -9999, on: false },
    pull: { x: 0, y: 0, on: false },
    sink: { x: 0, y: 0, on: false },
  };
  // `labels` is for the overlay only: the price scene's model labels, faded before the next scene.
  const mv = { scene: motionValue(0), play: motionValue(0), ignite: motionValue(0), model: motionValue(0), waste: motionValue(0), ring: motionValue(0), labels: motionValue(0), dim: motionValue(0), hide: motionValue(0), origin: motionValue(0) };
  const api = {
    mv,
    scene: (p: number) => void (mv.scene.set(p), (ctrl.scene = p)),
    play: (p: number) => void (mv.play.set(p), (ctrl.play = p)),
    ignite: (p: number) => void (mv.ignite.set(p), (ctrl.ignite = p)),
    model: (mix: number, pin: number, pout: number) => void (mv.model.set(mix), (ctrl.model = { mix, pin, pout })),
    waste: (p: number) => void (mv.waste.set(p), (ctrl.waste = p)),
    ring: (p: number) => void (mv.ring.set(p), (ctrl.ring = p)),
    labels: (p: number) => void mv.labels.set(p),
    dim: (p: number) => void (mv.dim.set(p), (ctrl.dim = p)),
    focus: (w: number[]) => void (ctrl.focus = w),
    hide: (p: number) => void (mv.hide.set(p), (ctrl.hide = p)),
    origin: (p: number) => void (mv.origin.set(p), (ctrl.origin = p)),
    mouse: (x: number, y: number) => void (ctrl.mouse = { x, y, on: true }),
    mouseOff: () => void (ctrl.mouse.on = false),
    pull: (x: number, y: number) => void (ctrl.pull = { x, y, on: true }),
    pullOff: () => void (ctrl.pull.on = false),
    sink: (x: number, y: number) => void (ctrl.sink = { x, y, on: true }),
    sinkOff: () => void (ctrl.sink.on = false),
  };
  return { ctrl, api };
}

export type FieldApi = ReturnType<typeof makeField>["api"];

const MAX_CALLS = 32;

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec4 aGal; // radius, angle, height, place in the run
layout(location = 1) in vec2 aReplay;
layout(location = 2) in vec2 aCloud;
layout(location = 3) in vec4 aMeta; // seed, call, place in call, kind
layout(location = 4) in vec2 aWaste;
layout(location = 5) in vec2 aRing; // angle, offset across the band

uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
uniform float uCalls;
uniform float uStart[${MAX_CALLS}];
uniform float uEnd[${MAX_CALLS}];
uniform float uPin[${MAX_CALLS}];
uniform float uPout[${MAX_CALLS}];
uniform float uRepeat[${MAX_CALLS}];
uniform float uN[${MAX_CALLS}];
uniform float uGroup[${MAX_CALLS}]; // bits: 1 loop, 2 retry, 4 premium
uniform float uToolsN[${MAX_CALLS}]; // tool definition tokens at the start of the prompt
uniform float uF[5];
uniform float uDim;
uniform float uHide;
uniform float uOrigin;
uniform float uRef;
uniform float uScene;
uniform float uPlay;
uniform vec2 uCloudC;
uniform vec2 uCloudS;
uniform float uIgnite;
uniform vec3 uModel; // mix, price in, price out
uniform float uWaste;
uniform float uRing;
uniform vec3 uRingG; // radius, thickness, center y share
uniform vec2 uMouse;
uniform float uMouseK;
uniform vec2 uPull;
uniform float uPullK;
uniform float uSwirl;
uniform vec2 uSink;
uniform float uSinkK;
uniform vec4 uAlpha; // hero, replay, cloud, heap
uniform vec3 uGal; // center x, center y, radius in px
uniform vec3 uView; // spin, pitch, yaw
uniform vec4 uQuiet; // the headline's box: dots behind it step back
uniform float uRingA;

out vec4 vColor;

const vec3 WHITE = vec3(0.93, 0.93, 0.94);
const vec3 REC = vec3(1.0, 0.373, 0.122);
const float PI = 3.14159265;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float smooth01(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }

void main() {
  float seed = aMeta.x;
  int call = int(aMeta.y + 0.5);
  float place = aMeta.z;
  bool isOutput = aMeta.w > 1.5;
  bool waste = aMeta.w < 0.5 || uRepeat[call] > 0.5;
  float callN = aMeta.y / max(1.0, uCalls - 1.0);
  float minRes = min(uRes.x, uRes.y);

  // Hero: the token galaxy. The run spirals out from its first call at the core to its last at
  // the rim. The disk turns, and the pointer tips it. Same math as projectGalaxy in layout.ts.
  float ga = aGal.y + uView.x;
  vec3 g3 = vec3(cos(ga) * aGal.x, aGal.z, sin(ga) * aGal.x);
  float cyw = cos(uView.z), syw = sin(uView.z);
  g3 = vec3(cyw * g3.x + syw * g3.z, g3.y, -syw * g3.x + cyw * g3.z);
  float cp = cos(uView.y), sp = sin(uView.y);
  g3 = vec3(g3.x, cp * g3.y - sp * g3.z, sp * g3.y + cp * g3.z);
  float persp = 1.0 / (1.0 + clamp(g3.z, -1.5, 1.5) * 0.16);
  vec2 hero = uGal.xy + g3.xy * persp * uGal.z;

  // The cloud each token waits in until its call runs. It turns slowly.
  vec2 cloud = uCloudC + (rot(uTime * 0.035 * (0.6 + seed)) * aCloud) * uCloudS;

  // Replay: a token flies from the cloud to its bar while the playhead crosses its call.
  float t0 = mix(uStart[call], uEnd[call], place);
  float e = smooth01((uPlay - t0) / 0.045);
  vec2 dir = aReplay - cloud;
  vec2 replay = mix(cloud, aReplay, e) + vec2(-dir.y, dir.x) * (seed - 0.5) * 0.35 * sin(e * PI);
  float inFlight = sin(e * PI);

  // Hero to replay: a wave from left to right.
  float w = smooth01(uScene * 1.7 - (hero.x / uRes.x) * 0.55 - seed * 0.15);
  vec2 pos = mix(hero, replay, w);

  // Waste: kept tokens settle, waste falls under gravity into the heap, call by call.
  float tw = clamp(uWaste * 1.7 - callN * 0.45 - seed * 0.25, 0.0, 1.0);
  if (waste) {
    pos = vec2(mix(pos.x, aWaste.x, smooth01(tw)), mix(pos.y, aWaste.y, tw * tw));
  } else {
    pos = mix(pos, aWaste, smooth01(tw));
  }

  // The ring: every dot spirals in to a band around the middle, which turns slowly. It starts from
  // one bright point at the center, where the dots gathered while the field was hidden.
  float tr = smooth01(uRing * 1.5 - seed * 0.5);
  float ang = aRing.x + uTime * 0.05;
  vec2 ringC = vec2(uRes.x * 0.5, uRes.y * uRingG.z);
  pos = mix(pos, ringC + aCloud * 3.0, uOrigin);
  vec2 ring = ringC + vec2(cos(ang), sin(ang)) * (uRingG.x + aRing.y * uRingG.y);
  vec2 rd = ring - pos;
  pos = mix(pos, ring, tr) + vec2(-rd.y, rd.x) * 0.25 * sin(tr * PI);

  // The pointer pushes dots aside in the hero and around the ring.
  vec2 d = pos - uMouse;
  float r = length(d);
  pos += (r > 0.001 ? d / r : vec2(0.0)) * uMouseK * exp(-(r * r) / (110.0 * 110.0)) * 30.0;

  // A dragged file: the field spirals toward the pointer, inner dots faster.
  vec2 p = pos - uPull;
  float near = exp(-length(p) / (0.42 * minRes));
  p = rot(uSwirl * (0.35 + 1.4 * near)) * p;
  p *= 1.0 - uPullK * (0.25 + 0.55 * near);
  pos = uPull + p;

  // The drop: every dot falls into one point, the slow ones last.
  float sk = clamp(uSinkK * 1.35 - seed * 0.35, 0.0, 1.0);
  sk = sk * sk * sk;
  pos = mix(pos, uSink, sk);

  vec2 clip = (pos / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);

  // Color. White is a token. Orange is money: the price of that token.
  float rec = isOutput ? uPout[call] : uPin[call];
  float alt = isOutput ? uModel.z : uModel.y;
  float price = mix(rec, alt, uModel.x) / uRef;
  float warm = pow(clamp(price, 0.0, 1.0), 0.6);
  vec3 hot = mix(WHITE * 0.3, REC, warm);
  hot = mix(hot, vec3(1.0, 0.84, 0.7), clamp((price - 1.0) / 4.0, 0.0, 1.0) * 0.7);
  float hotA = mix(0.7, 2.6, warm) + clamp(price - 1.0, 0.0, 4.0) * 0.2;
  vec3 col = mix(WHITE, hot, uIgnite);
  float a = mix(1.0, hotA, uIgnite);

  // Findings: the lit group turns orange, every other token steps back.
  float j = place * max(0.0, uN[call] - 1.0);
  float g = uGroup[call];
  float lit = max(
    max((aMeta.w < 0.5 ? 1.0 : 0.0) * uF[0], mod(g, 2.0) * uF[1]),
    max(max(mod(floor(g / 2.0), 2.0) * uF[2], mod(floor(g / 4.0), 2.0) * uF[3]), (j < uToolsN[call] ? 1.0 : 0.0) * uF[4])
  );
  float focusOn = max(max(uF[0], uF[1]), max(max(uF[2], uF[3]), uF[4]));
  col = mix(col, mix(WHITE * 0.6, REC, lit), focusOn);
  a *= mix(1.0, mix(0.2, 2.4, lit), focusOn);
  float ws = smooth01(tw * 1.4);
  col = mix(col, waste ? REC : WHITE, ws);
  a = mix(a, waste ? 2.4 : 1.0, ws);
  col = mix(col, WHITE, max(tr, uOrigin));

  // The ring has a slow sweep of light, like a recording head.
  float sweep = exp(-pow(mod(ang - uTime * 0.9, 2.0 * PI) - PI, 2.0) * 1.2);

  // In the galaxy the newest tokens, out at the rim, glow brightest; the far side dims a little.
  float rim = aGal.w * aGal.w;
  float glow = (0.5 + 0.9 * rim) * mix(1.15, 0.75, clamp(g3.z * 0.5 + 0.5, 0.0, 1.0));
  // Dots behind the text step back, so the type stays crisp. The distance is to a rounded box,
  // and the fall-off is long and eased, so the edge of the quiet area never shows as a shape.
  vec2 qc = (uQuiet.xy + uQuiet.zw) * 0.5;
  vec2 qh = (uQuiet.zw - uQuiet.xy) * 0.5;
  vec2 qd = abs(hero - qc) - qh + 40.0;
  float qdist = length(max(qd, 0.0)) + min(max(qd.x, qd.y), 0.0) - 40.0;
  float qt = smoothstep(-60.0, 170.0, qdist);
  float quiet = mix(0.16, 1.0, qt * qt * (3.0 - 2.0 * qt));
  float shine = (0.55 + 0.45 * fract(seed * 7.13)) * mix(glow * quiet, 1.0, w);
  float twinkle = 1.0 + 0.18 * sin(uTime * (1.3 + seed * 2.0) + seed * 60.0);
  float base = mix(uAlpha.x, mix(uAlpha.z, uAlpha.y, e), w);
  base = mix(base, waste ? uAlpha.w : uAlpha.y, ws);
  base = mix(base, uRingA * (0.7 + 0.9 * sweep), tr);
  a *= base * shine * twinkle * (1.0 + inFlight * w * (1.0 - ws) * 1.4 + uPullK * near * 0.8 + sk * 1.5);
  a *= mix(1.0, 0.55, (1.0 - e) * w * (1.0 - tr));
  a *= (1.0 - 0.72 * uDim) * (1.0 - uHide);
  vColor = vec4(col, clamp(a, 0.0, 1.0));
  gl_PointSize = uDpr * (1.25 + inFlight * w * (1.0 - ws) * 0.9 + sk * 1.2 + uPullK * near * 0.6 + tr * sweep * 0.5);
}`;

const FRAG = /* glsl */ `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d) * vColor.a;
  outColor = vec4(vColor.rgb * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

/** Eases `from` toward `to` at `rate` per second, frame-rate independent. */
const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

/** Ring radius and band thickness in px. On a phone the ring spans most of the width, around the text. */
function ringSize(W: number, H: number) {
  const m = Math.min(W, H);
  return W < HERO.phone ? [W * 0.46, m * RING.t] : [m * RING.r, m * RING.t];
}

/** Prices of the run as recorded, per call: USD per input token and per output token. */
export type CallPrice = { pin: number; pout: number };

/** Finding groups per call: bits 1 loop, 2 retry, 4 premium; and its tool definition tokens. */
export type CallMark = { group: number; tools: number };

export function Field({ run, prices, marks, ctrl, onReady }: { run: FieldRun; prices: CallPrice[]; marks: CallMark[]; ctrl: FieldCtrl; onReady: (ok: boolean) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const gl = el.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" });
    if (!gl) {
      onReady(false);
      return;
    }

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
    } catch (err) {
      console.warn(err);
      onReady(false);
      return;
    }

    const { count, meta, cloud, ring, gal } = buildStatic(run);
    const replay = new Float32Array(count * 2);
    const waste = new Float32Array(count * 2);

    const vao = gl.createVertexArray();
    const buffers: WebGLBuffer[] = [];
    gl.bindVertexArray(vao);
    const buffer = (loc: number, size: number, data: Float32Array, usage: number) => {
      const b = gl.createBuffer();
      buffers.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return b;
    };
    buffer(0, 4, gal, gl.STATIC_DRAW);
    const replayBuf = buffer(1, 2, replay, gl.DYNAMIC_DRAW);
    buffer(2, 2, cloud, gl.STATIC_DRAW);
    buffer(3, 4, meta, gl.STATIC_DRAW);
    const wasteBuf = buffer(4, 2, waste, gl.DYNAMIC_DRAW);
    buffer(5, 2, ring, gl.STATIC_DRAW);

    gl.useProgram(program);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const names = ["uRes", "uDpr", "uTime", "uScene", "uPlay", "uCloudC", "uCloudS", "uIgnite", "uModel", "uWaste", "uRing", "uRingG", "uMouse", "uMouseK", "uPull", "uPullK", "uSwirl", "uSink", "uSinkK", "uAlpha", "uRingA", "uF", "uDim", "uHide", "uOrigin", "uGal", "uView", "uQuiet"] as const;
    const loc = Object.fromEntries(names.map((n) => [n, u(n)])) as Record<(typeof names)[number], WebGLUniformLocation | null>;

    // Per-call data, set once.
    const arr = (f: (i: number) => number) => {
      const a = new Float32Array(MAX_CALLS);
      for (let i = 0; i < Math.min(MAX_CALLS, run.calls.length); i++) a[i] = f(i);
      return a;
    };
    gl.uniform1fv(u("uStart"), arr((i) => run.calls[i].start / run.duration));
    gl.uniform1fv(u("uEnd"), arr((i) => run.calls[i].end / run.duration));
    gl.uniform1fv(u("uPin"), arr((i) => prices[i]?.pin ?? 0));
    gl.uniform1fv(u("uPout"), arr((i) => prices[i]?.pout ?? 0));
    gl.uniform1fv(u("uRepeat"), arr((i) => (run.calls[i].repeat ? 1 : 0)));
    gl.uniform1fv(u("uN"), arr((i) => run.calls[i].prompt + run.calls[i].output));
    gl.uniform1fv(u("uGroup"), arr((i) => marks[i]?.group ?? 0));
    gl.uniform1fv(u("uToolsN"), arr((i) => marks[i]?.tools ?? 0));
    gl.uniform1f(u("uCalls"), run.calls.length);
    // Full orange: the most expensive input token of the recorded run.
    gl.uniform1f(u("uRef"), Math.max(1e-12, ...prices.map((p) => p.pin)));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    // Layout, in CSS px of the canvas. Dense layouts get fainter dots so the shapes keep their edges.
    let W = 0;
    let H = 0;
    let dpr = 1;
    const alpha = [0.6, 0.6, 0.45, 0.5];
    let ringA = 0.5;
    const toAlpha = (area: number) => Math.min(0.95, Math.max(0.3, area / 6));
    const resize = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      W = r.width;
      H = r.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.round(W * dpr);
      el.height = Math.round(H * dpr);
      // The galaxy is dense at the core: its dots stay faint and add up to a glow.
      const gf = galaxyFrame(W, H);
      alpha[0] = Math.min(0.8, Math.max(0.34, (Math.PI * gf.r * gf.r * Math.sin(GALAXY.pitch)) / count / 6));
      alpha[1] = toAlpha(layout(run, replayRects(run, W, H), replay, 23));
      // The heap and the ring are dense on a small screen, so they may go fainter than the rest.
      alpha[3] = Math.max(0.12, Math.min(0.6, wasteLayout(run, W, H, waste, 37) / 6));
      const [rr, rt] = ringSize(W, H);
      ringA = Math.max(0.1, Math.min(0.9, (2 * Math.PI * rr * rt * 2) / count / 6));
      for (const [b, data] of [
        [replayBuf, replay],
        [wasteBuf, waste],
      ] as const) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      }
      wake();
    };

    // Eased state that follows ctrl.
    const focus = new Float32Array(5);
    let dim = 0;
    let hide = 0;
    let origin = 0;
    // The pointer tips the galaxy: yaw from left and right, pitch from up and down.
    let yaw = 0;
    let pitch = GALAXY.pitch;
    const quietEl = () => document.querySelector<HTMLElement>("[data-quiet]");
    const s = { scene: ctrl.scene, play: ctrl.play, ignite: ctrl.ignite, mix: 0, pin: 0, pout: 0, waste: ctrl.waste, ring: ctrl.ring, mx: -9999, my: -9999, mk: 0, px: 0, py: 0, pk: 0, swirl: 0, sk: 0, sx: 0, sy: 0 };
    let raf = 0;
    let last = 0;
    let visible = true;
    let ready = false;
    let t = 0;

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      t += dt;
      const c = ctrl;
      const top = el.getBoundingClientRect().top;
      s.scene = ease(s.scene, c.scene, 9, dt);
      s.play = ease(s.play, c.play, 7, dt);
      s.ignite = ease(s.ignite, c.ignite, 6, dt);
      s.mix = ease(s.mix, c.model.mix, 6, dt);
      if (c.model.mix > 0) {
        if (s.mix < 0.01) {
          s.pin = c.model.pin;
          s.pout = c.model.pout;
        }
        s.pin = ease(s.pin, c.model.pin, 8, dt);
        s.pout = ease(s.pout, c.model.pout, 8, dt);
      }
      s.waste = ease(s.waste, c.waste, 5, dt);
      s.ring = ease(s.ring, c.ring, 5, dt);
      for (let k = 0; k < 5; k++) focus[k] = ease(focus[k], c.focus[k] ?? 0, 7, dt);
      dim = ease(dim, c.dim, 6, dt);
      hide = ease(hide, c.hide, 8, dt);
      origin = ease(origin, c.origin, 10, dt);
      if (c.mouse.on) {
        if (s.mk < 0.01) {
          s.mx = c.mouse.x;
          s.my = c.mouse.y - top;
        }
        s.mx = ease(s.mx, c.mouse.x, 16, dt);
        s.my = ease(s.my, c.mouse.y - top, 16, dt);
      }
      s.mk = ease(s.mk, c.mouse.on ? Math.max(1 - s.scene, s.ring) : 0, 6, dt);
      const gf = galaxyFrame(W, H);
      const tip = c.mouse.on && s.scene < 0.5;
      yaw = ease(yaw, tip ? Math.max(-1, Math.min(1, (c.mouse.x - gf.cx) / (W * 0.5))) * 0.28 : 0, 2.2, dt);
      pitch = ease(pitch, GALAXY.pitch + (tip ? Math.max(-1, Math.min(1, (c.mouse.y - top - gf.cy) / (H * 0.5))) * 0.14 : 0), 2.2, dt);
      if (c.pull.on) {
        if (s.pk < 0.01) {
          s.px = c.pull.x;
          s.py = c.pull.y - top;
        }
        s.px = ease(s.px, c.pull.x, 10, dt);
        s.py = ease(s.py, c.pull.y - top, 10, dt);
        s.swirl += dt * 1.1;
      } else {
        s.swirl = ease(s.swirl, 0, 2.6, dt);
      }
      s.pk = ease(s.pk, c.pull.on ? 1 : 0, 3.5, dt);
      if (c.sink.on) {
        if (s.sk === 0) {
          s.sx = c.sink.x;
          s.sy = c.sink.y - top;
        }
        s.sk = Math.min(1, s.sk + dt / 0.5);
      } else {
        s.sk = Math.max(0, s.sk - dt / 0.45);
      }

      const phone = W < HERO.phone;
      gl.viewport(0, 0, el.width, el.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(loc.uRes, W, H);
      gl.uniform1f(loc.uDpr, dpr);
      gl.uniform1f(loc.uTime, t);
      gl.uniform1f(loc.uScene, s.scene);
      gl.uniform1f(loc.uPlay, s.play);
      gl.uniform2f(loc.uCloudC, W * (phone ? 0.5 : 0.6), H * (phone ? 0.34 : 0.3));
      gl.uniform2f(loc.uCloudS, W * (phone ? 0.2 : 0.15), H * (phone ? 0.07 : 0.08));
      gl.uniform1f(loc.uIgnite, s.ignite);
      gl.uniform3f(loc.uModel, s.mix, s.pin, s.pout);
      gl.uniform1f(loc.uWaste, s.waste);
      gl.uniform1f(loc.uRing, s.ring);
      const [rr, rt] = ringSize(W, H);
      gl.uniform3f(loc.uRingG, rr, rt, RING.cy);
      gl.uniform2f(loc.uMouse, s.mx, s.my);
      gl.uniform1f(loc.uMouseK, s.mk);
      gl.uniform2f(loc.uPull, s.px, s.py);
      gl.uniform1f(loc.uPullK, s.pk);
      gl.uniform1f(loc.uSwirl, s.swirl);
      gl.uniform2f(loc.uSink, s.sx, s.sy);
      gl.uniform1f(loc.uSinkK, s.sk);
      gl.uniform4f(loc.uAlpha, alpha[0], alpha[1], alpha[2], alpha[3]);
      gl.uniform1f(loc.uRingA, ringA);
      gl.uniform1fv(loc.uF, focus);
      gl.uniform1f(loc.uDim, dim);
      gl.uniform1f(loc.uHide, hide);
      gl.uniform1f(loc.uOrigin, origin);
      gl.uniform3f(loc.uGal, gf.cx, gf.cy, gf.r);
      gl.uniform3f(loc.uView, t * GALAXY.spin, pitch, yaw);
      const q = s.scene < 1 ? quietEl()?.getBoundingClientRect() : undefined;
      if (q) gl.uniform4f(loc.uQuiet, q.left, q.top - top, q.right, q.bottom - top);
      else gl.uniform4f(loc.uQuiet, -1e5, -1e5, -1e5, -1e5);
      gl.drawArrays(gl.POINTS, 0, count);

      if (!ready) {
        ready = true;
        onReady(true);
      }
      if (visible) raf = requestAnimationFrame(frame);
    };

    function wake() {
      if (!raf && visible) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    }

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    // The loop runs only while the canvas is on screen and the tab is visible.
    let onScreen = true;
    const update = () => {
      visible = onScreen && document.visibilityState === "visible";
      if (visible) wake();
      else {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      update();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    const lost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      onReady(false);
    };
    el.addEventListener("webglcontextlost", lost);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
      el.removeEventListener("webglcontextlost", lost);
      // Free only this field's GPU objects, and keep the context alive. Next.js can keep this page
      // mounted in the background and run the effect again on return; a context lost on purpose
      // would come back dead, and the page would fall back to its still frames.
      for (const b of buffers) gl.deleteBuffer(b);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
    // `ctrl` is one object for the page's life; the field rebuilds only for a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, prices, marks]);

  return <canvas ref={canvas} className="block size-full" aria-hidden />;
}
