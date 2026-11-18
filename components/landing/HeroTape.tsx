"use client";

// The landing page's instrument: the billing demo, replayed on the real tape, then re-priced.
// One loop, about 11 seconds:
//   1. The playhead sweeps the run. Spend rises as each LLM call ends.
//   2. The same run is priced on a smaller model. Each step of the line drops to its new
//      cost, left to right, and the gap between the two lines fills: the money saved.
//   3. A short hold. The new line and the saved band fade, and the sweep starts again. The card
//      itself never fades, so the loop does not blink.
// With reduced motion it shows the final state and does not move.

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { usd } from "@/lib/cost";

export type HeroData = {
  slug: string;
  title: string;
  duration: number;
  model: string;
  recorded: [number, number][];
  repriced: [number, number][];
  calls: { start: number; end: number; input: number; cached: number }[];
};

const SWEEP = 3200;
const GAP = 500;
const MORPH = 1100;
const HOLD = 3600;
const FADE = 450;
const LOOP = SWEEP + GAP + MORPH + HOLD + FADE;

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 4);
const easeInOut = (x: number) => (x < 0.5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2);

export function HeroTape({ data }: { data: HeroData }) {
  const reduce = useReducedMotion();
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const start = performance.now();
    const tick = (time: number) => {
      setNow((time - start) % LOOP);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  const clock = reduce ? LOOP - FADE - 1 : now;
  const sweep = clamp(clock / SWEEP);
  const morph = clamp((clock - SWEEP - GAP) / MORPH);
  const fade = 1 - clamp((clock - (LOOP - FADE)) / FADE);
  const t = sweep * data.duration;

  const total = data.recorded.at(-1)?.[1] ?? 1;
  const newTotal = data.repriced.at(-1)?.[1] ?? 0;
  const n = data.recorded.length;
  const stagger = 0.5 / Math.max(1, n);
  // Each step of the line drops to its new cost a little after the step before it.
  const mix = data.recorded.map(([, c], i) => {
    const local = easeInOut(clamp((morph - i * stagger) / (1 - (n - 1) * stagger)));
    return c + (data.repriced[i][1] - c) * local;
  });
  const y = (c: number) => 100 - (c / total) * 82;
  const x = (ms: number) => (ms / data.duration) * 1000;

  // A step line as points: flat until each call ends, then up to the new total.
  const points = (vals: number[]) => {
    const out: [number, number][] = [[0, 100]];
    let yy = 100;
    data.recorded.forEach(([ms], i) => {
      out.push([x(ms), yy]);
      yy = y(vals[i]);
      out.push([x(ms), yy]);
    });
    out.push([1000, yy]);
    return out;
  };
  const toPath = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(2)}`).join(" ");
  const recPts = points(data.recorded.map(([, c]) => c));
  const mixPts = points(mix);
  const recPath = toPath(recPts);
  const mixPath = toPath(mixPts);
  // The saved money: the area between the recorded line and the falling line.
  const savedArea = `${toPath(recPts)} ${[...mixPts]
    .reverse()
    .map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(2)}`)
    .join(" ")} Z`;

  const spentNow = data.recorded.reduce((c, [ms, v]) => (ms <= t ? v : c), 0);
  const shownTotal = morph > 0 ? total + (newTotal - total) * easeOut(morph) : spentNow;
  const maxInput = Math.max(1, ...data.calls.map((c) => c.input + c.cached));

  return (
    <div className="relative overflow-hidden rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--hair),0_40px_80px_-40px_rgba(0,0,0,0.9)]">
      <div className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)]">
        {/* Readout. */}
        <div className="flex items-end justify-between gap-4 border-b border-hair px-5 py-4 sm:flex-col sm:items-start sm:justify-between sm:border-b-0 sm:border-r sm:py-5">
          <div>
            <div className="text-[12px] text-ink-3">{morph > 0 ? `On ${data.model}` : "Spend"}</div>
            <div className={`mt-1 text-[30px] font-semibold leading-none tracking-[-0.03em] tnum ${morph > 0.02 ? "text-ink" : "text-rec"}`}>{usd(shownTotal)}</div>
          </div>
          <div className="text-right text-[12px] leading-snug text-ink-3 sm:text-left">
            {morph > 0.02 ? (
              <>
                was <span className="text-rec">{usd(total)}</span>
                <span className="block text-ink-2">{Math.round((1 - newTotal / total) * 100)}% less</span>
              </>
            ) : (
              <>
                {data.title}
                <span className="block">{(t / 1000).toFixed(1)} s of {(data.duration / 1000).toFixed(1)} s</span>
              </>
            )}
          </div>
        </div>

        {/* Tape. */}
        <div className="relative">
          <div className="relative h-[180px] sm:h-[220px]">
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
              <defs>
                <clipPath id="hero-played">
                  <rect x="0" y="-10" width={sweep * 1000} height="120" />
                </clipPath>
                {/* The saved band in 0..1 units, so the HTML hatch layer below can use it as its clip. */}
                <clipPath id="hero-saved" clipPathUnits="objectBoundingBox">
                  <path d={savedArea} transform="scale(0.001 0.01)" />
                </clipPath>
                <linearGradient id="hero-new-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ededef" stopOpacity="0.1" />
                  <stop offset="1" stopColor="#ededef" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={recPath} fill="none" stroke="rgba(255,95,31,0.2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <g clipPath="url(#hero-played)" opacity={fade}>
                <path d={`${recPath} L1000,100 Z`} fill="rgba(255,95,31,0.09)" opacity={1 - morph} />
                {morph > 0 && <path d={`${mixPath} L1000,100 Z`} fill="url(#hero-new-fill)" opacity={morph} />}
                {morph > 0 && <path d={savedArea} fill="rgba(255,95,31,0.08)" />}
                <path d={recPath} fill="none" stroke="#ff5f1f" strokeWidth="1.6" vectorEffect="non-scaling-stroke" opacity={1 - 0.45 * morph} />
                {morph > 0 && <path d={mixPath} fill="none" stroke="#ededef" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
              </g>
            </svg>
            {/* The money saved: the same fine orange hatch the replay uses, drawn in pixels. */}
            {morph > 0 && <div className="saved-hatch pointer-events-none absolute inset-0" style={{ clipPath: "url(#hero-saved)", opacity: fade }} aria-hidden />}
            {morph > 0.6 && (
              <span className="pointer-events-none absolute right-3 font-mono text-[11px] text-ink tnum" style={{ top: `calc(${y(mix.at(-1) ?? 0)}% - 18px)`, opacity: clamp((morph - 0.6) / 0.4) * fade }}>
                {usd(newTotal)}
              </span>
            )}
            <span className="pointer-events-none absolute right-3 font-mono text-[11px] text-rec tnum" style={{ top: `calc(${y(total)}% - 18px)`, opacity: sweep >= 1 ? (1 - 0.4 * morph) * fade : 0 }}>
              {usd(total)}
            </span>
            <span className="pointer-events-none absolute inset-y-0 w-px bg-ink" style={{ left: `${sweep * 100}%`, opacity: sweep >= 1 ? 0 : 1 }} />
          </div>
          <div className="relative h-14 border-t border-hair" aria-hidden>
            <span className="absolute left-3 top-1.5 text-[10.5px] text-ink-3">input per call</span>
            {data.calls.map((c, i) => {
              const total = c.input + c.cached;
              return (
                <span
                  key={i}
                  className={`absolute bottom-0 flex min-w-[3px] flex-col-reverse overflow-hidden rounded-t-[2px] ${c.start <= t ? "" : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]"}`}
                  style={{
                    left: `${(c.start / data.duration) * 100}%`,
                    width: `max(3px, calc(${(Math.max(c.end - c.start, data.duration / 400) / data.duration) * 100}% - 1px))`,
                    height: (total / maxInput) * 36,
                  }}
                >
                  {c.start <= t && (
                    <>
                      <span className="hatch" style={{ height: `${(c.cached / total) * 100}%` }} />
                      <span className="bg-white/[0.62]" style={{ height: `${(c.input / total) * 100}%` }} />
                    </>
                  )}
                </span>
              );
            })}
            <span className="pointer-events-none absolute inset-y-0 w-px bg-ink" style={{ left: `${sweep * 100}%`, opacity: sweep >= 1 ? 0 : 1 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
