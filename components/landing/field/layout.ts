// Where each token sits in each scene of the landing field. One dot is one token of the run.
// The hero's CSS fallback uses the same constants, so the WebGL field lands on the same shapes.

export type FieldCall = {
  name: string;
  model: string;
  /** Milliseconds from the start of the run. */
  start: number;
  end: number;
  /** Prompt tokens: input plus cache read plus cache write. */
  prompt: number;
  output: number;
  /** Prompt tokens that repeat the call before it at full price (the cache finding). */
  resent: number;
  /** The call repeats a tool loop or asks for a step that failed: all of it is waste. */
  repeat: boolean;
  /** Cost of the call as recorded, in USD. */
  cost: number;
};

export type FieldRun = { duration: number; calls: FieldCall[] };

/** Token kinds inside one call, bottom to top: context sent again, new prompt tokens, output. */
export const KIND_RESENT = 0;
export const KIND_NEW = 1;
export const KIND_OUTPUT = 2;

export const tokensOf = (c: FieldCall) => c.prompt + c.output;
export const countOf = (run: FieldRun) => run.calls.reduce((a, c) => a + tokensOf(c), 0);

/** Below this width the layouts use their phone shape. */
export const HERO = { phone: 640 };

/**
 * The hero galaxy. The run spirals out from the core: the first call at the center, the last at
 * the rim, and a call with more tokens takes a longer stretch of arm. Center and radius are shares
 * of the screen; the radius is the smaller of rW x width and rH x height. Shared with the still
 * fallback in Hero.tsx, so both draw the same galaxy.
 */
export const GALAXY = {
  desk: { cx: 0.66, cy: 0.47, rW: 0.4, rH: 0.75 },
  phone: { cx: 0.5, cy: 0.88, rW: 0.75, rH: 0.4 },
  /** How far the disk tips toward the viewer, in radians. 0 is edge on. */
  pitch: 0.52,
  turns: 1.55,
  /** Radians per second. */
  spin: 0.035,
  /** Share of the tokens in the faint halo around the disk. */
  halo: 0.07,
};

export const galaxyFrame = (W: number, H: number) => {
  const g = W < HERO.phone ? GALAXY.phone : GALAXY.desk;
  return { cx: W * g.cx, cy: H * g.cy, r: Math.min(W * g.rW, H * g.rH) };
};

/**
 * One galaxy point on screen, in units of the radius from the center. The same math runs in the
 * vertex shader. `rot` is the spin angle, `yaw` and `pitch` the view.
 */
export function projectGalaxy(r: number, th: number, z: number, rot: number, pitch = GALAXY.pitch, yaw = 0) {
  const a = th + rot;
  let x = Math.cos(a) * r;
  let y = z;
  let d = Math.sin(a) * r;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  [x, d] = [cy * x + sy * d, -sy * x + cy * d];
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  [y, d] = [cp * y - sp * d, sp * y + cp * d];
  // Mild perspective, kept far from the camera, so no dot can blow up toward it.
  const k = 1 / (1 + Math.max(-1.5, Math.min(1.5, d)) * 0.16);
  return { x: x * k, y: y * k, depth: d };
}
/** The replay timeline. */
export const REPLAY = { pad: 0.06, padMin: 20, base: 0.84, maxH: 0.42, maxHPhone: 0.34 };
/** The waste heap, under the timeline's baseline. */
export const HEAP = { halfW: 0.42, halfWPhone: 0.46, h: 0.13 };
/** The closing ring. Radius and thickness are shares of the short side of the screen. */
export const RING = { r: 0.34, t: 0.035, cy: 0.5 };

/** A token is waste when it repeats earlier context at full price, or its whole call was a repeat. */
export const isWaste = (c: FieldCall, j: number) => c.repeat || j < c.resent;
export const wasteCount = (run: FieldRun) => run.calls.reduce((a, c) => a + (c.repeat ? tokensOf(c) : c.resent), 0);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Static data per dot: [seed, call index, place in the call 0..1, kind] and a unit gaussian
 * offset for the cloud the dots wait in before their call runs.
 */
export function buildStatic(run: FieldRun) {
  const count = countOf(run);
  const meta = new Float32Array(count * 4);
  const cloud = new Float32Array(count * 2);
  const ring = new Float32Array(count * 2);
  // The galaxy, per dot: radius, angle, height above the disk, and place in the run (0..1).
  const gal = new Float32Array(count * 4);
  const grand = rng(31);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, grand()))) * Math.cos(2 * Math.PI * grand());
  const rand = rng(7);
  let k = 0;
  run.calls.forEach((c, i) => {
    const n = tokensOf(c);
    for (let j = 0; j < n; j++, k++) {
      const kind = j < c.resent ? KIND_RESENT : j < c.prompt ? KIND_NEW : KIND_OUTPUT;
      meta[k * 4] = rand();
      meta[k * 4 + 1] = i;
      meta[k * 4 + 2] = n > 1 ? j / (n - 1) : 0;
      meta[k * 4 + 3] = kind;
      // Box-Muller. A rare far dot is placed again inside, so the cloud has no hard rim.
      let r = Math.sqrt(-2 * Math.log(Math.max(1e-9, rand())));
      if (r > 2.6) r = rand() * 2.6;
      const th = rand() * Math.PI * 2;
      cloud[k * 2] = r * Math.cos(th);
      cloud[k * 2 + 1] = r * Math.sin(th);
      // The ring: an angle, and a soft offset across the band.
      ring[k * 2] = rand() * Math.PI * 2;
      ring[k * 2 + 1] = (rand() + rand() + rand() - 1.5) / 1.5;
      const t = k / Math.max(1, count - 1);
      if (grand() < GALAXY.halo) {
        // The halo: faint dust around the disk.
        gal[k * 4] = Math.min(1.5, 0.95 + Math.abs(gauss()) * 0.3);
        gal[k * 4 + 1] = grand() * Math.PI * 2;
        gal[k * 4 + 2] = gauss() * 0.16;
      } else if (t < 0.045) {
        // The core: the first call, a round bulge. A 3D gaussian ball, so no dots pile up on one axis.
        const bx = gauss() * 0.06;
        const bd = gauss() * 0.06;
        gal[k * 4] = Math.hypot(bx, bd);
        gal[k * 4 + 1] = Math.atan2(bd, bx);
        gal[k * 4 + 2] = gauss() * 0.045;
      } else {
        // Two arms. The run winds outward along them, in token order.
        const r = 0.08 + 0.92 * Math.pow(t, 0.72);
        // Tight arms near the core, a little looser at the rim, so the spiral reads.
        gal[k * 4] = Math.max(0, r + gauss() * (0.012 + 0.035 * r));
        gal[k * 4 + 1] = t * GALAXY.turns * Math.PI * 2 + (k % 2) * Math.PI + gauss() * (0.05 + 0.05 * r);
        gal[k * 4 + 2] = gauss() * (0.03 - 0.015 * r);
      }
      gal[k * 4 + 3] = t;
    }
  });
  return { count, meta, cloud, ring, gal };
}

type Rect = { x: number; y: number; w: number; h: number };

/** A jittered grid for n dots in a rect, filled bottom row first. */
function grid(n: number, r: Rect, rand: () => number) {
  const cols = Math.max(1, Math.round(Math.sqrt((n * r.w) / Math.max(1, r.h))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cw = r.w / cols;
  const ch = r.h / rows;
  return (k: number, out: Float32Array, i: number) => {
    out[i * 2] = r.x + ((k % cols) + rand()) * cw;
    out[i * 2 + 1] = r.y + r.h - (Math.floor(k / cols) + rand()) * ch;
  };
}

/** Fills a rect with n dots, bottom row first. Writes x, y pairs from index `at`. */
function fill(out: Float32Array, at: number, n: number, r: Rect, rand: () => number) {
  const put = grid(n, r, rand);
  for (let k = 0; k < n; k++) put(k, out, at + k);
}

export function replayRects(run: FieldRun, W: number, H: number): Rect[] {
  const pad = Math.max(REPLAY.padMin, W * REPLAY.pad);
  const span = W - pad * 2;
  const base = H * REPLAY.base;
  const maxH = H * (W < HERO.phone ? REPLAY.maxHPhone : REPLAY.maxH);
  const most = Math.max(...run.calls.map(tokensOf));
  return run.calls.map((c) => {
    const x = pad + (c.start / run.duration) * span;
    const w = Math.max(3, ((c.end - c.start) / run.duration) * span);
    const h = (maxH * tokensOf(c)) / most;
    return { x, y: base - h, w, h };
  });
}

/** Lays out every dot into `out` for one scene. Returns the mean area per dot, in px². */
export function layout(run: FieldRun, rects: Rect[], out: Float32Array, seed: number) {
  const rand = rng(seed);
  let at = 0;
  let area = 0;
  run.calls.forEach((c, i) => {
    const n = tokensOf(c);
    fill(out, at, n, rects[i], rand);
    at += n;
    area += rects[i].w * rects[i].h;
  });
  return area / Math.max(1, at);
}

/**
 * The waste scene. Kept tokens settle into shorter bars at the same place on the timeline, at the
 * same density as the replay. Waste tokens fall into a heap under the baseline.
 * Returns the mean area per dot of the heap, in px².
 */
export function wasteLayout(run: FieldRun, W: number, H: number, out: Float32Array, seed: number) {
  const rand = rng(seed);
  const rects = replayRects(run, W, H);
  const cx = W / 2;
  const hw = W * (W < HERO.phone ? HEAP.halfWPhone : HEAP.halfW);
  const hh = H * HEAP.h;
  let at = 0;
  let heaped = 0;
  run.calls.forEach((c, i) => {
    const n = tokensOf(c);
    const kept = c.repeat ? 0 : n - c.resent;
    const r = rects[i];
    const h = (r.h * kept) / n;
    const put = grid(Math.max(1, kept), { x: r.x, y: r.y + r.h - h, w: r.w, h }, rand);
    let k = 0;
    for (let j = 0; j < n; j++, at++) {
      if (!isWaste(c, j)) {
        put(k++, out, at);
        continue;
      }
      // A mound: uniform inside a parabola standing on the bottom edge.
      for (;;) {
        const x = (rand() * 2 - 1) * hw;
        const y = rand() * hh;
        const s = x / hw;
        if (y <= hh * (1 - s * s)) {
          out[at * 2] = cx + x;
          out[at * 2 + 1] = H - y;
          break;
        }
      }
      heaped++;
    }
  });
  return ((4 / 3) * hw * hh) / Math.max(1, heaped);
}
