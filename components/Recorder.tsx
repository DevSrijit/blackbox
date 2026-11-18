"use client";

// The recording, in two parts that share one time axis and one state.
//   Tape   — Spend (cumulative cost, drawn like tape) and Input per call (what each LLM call
//            sent, cached and full-price). It stays pinned while the steps scroll.
//   Steps  — every agent, LLM call and tool call as a row.
// Hover, selection, waste highlights and the playhead show in both parts at once.

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { tokens, usd, maxOf } from "@/lib/cost";
import type { Span } from "@/lib/types";
import { clock, KindMark, Num, shortModel } from "./ui";

export type Row = { span: Span; depth: number };
type Pt = { t: number; c: number };

/** The label column width, shared by every row so the tracks line up. */
export const GRID = "grid grid-cols-[var(--label)_minmax(0,1fr)] [--label:min(48vw,190px)] sm:[--label:216px]";
const ROW_H = 30;
const SPEND_H = 150;
const CTX_H = 64;

export type Shared = {
  rows: Row[];
  costs: Map<string, number>;
  /** LLM calls with no known price under the current models. They show "no price", never $0. */
  noPrice: Set<string>;
  duration: number;
  t: number;
  selected: string | null;
  highlight: Set<string>;
  hoverSpan: string | null;
  setHoverSpan: (id: string | null) => void;
  hoverTime: number | null;
  setHoverTime: (t: number | null) => void;
  onSelect: (id: string) => void;
  onSeek: (t: number) => void;
};

const fracOf = (ms: number, duration: number) => Math.max(0, Math.min(1, ms / duration));

/** Seek by pointer on the tape: click to jump, drag to scrub. Hover shows where a click would land. */
function useScrub(s: Shared, callAt?: (t: number) => string | null) {
  const el = useRef<HTMLDivElement>(null);
  const timeAt = (x: number) => {
    const r = el.current!.getBoundingClientRect();
    return fracOf(((x - r.left) / r.width) * s.duration, s.duration) * s.duration;
  };
  return {
    ref: el,
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      s.onSeek(timeAt(e.clientX));
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const v = timeAt(e.clientX);
      if (e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId)) s.onSeek(v);
      s.setHoverTime(v);
      // Over an LLM call: highlight its row too, so the tape and the steps point at one thing.
      if (callAt) s.setHoverSpan(callAt(v));
    },
    onPointerLeave: () => {
      s.setHoverTime(null);
      if (callAt) s.setHoverSpan(null);
    },
  };
}

/** The playhead and the hover guide, drawn over a track. */
type Box = { x0: number; x1: number; y0: number; y1: number };
const TAG_W = 64;
const TAG_H = 20;
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Where a time tag goes, in pixels: right of its line, or left of it when it would pass the edge,
 * and at the top or the bottom of the chart, whichever is clear of the boxes to avoid.
 * Null when neither place is clear.
 */
function placeTag(x: number, width: number, avoid: Box[]): (Box & { left: boolean; bottom: boolean }) | null {
  const left = x + 6 + TAG_W > width - 2;
  const x0 = left ? x - 6 - TAG_W : x + 6;
  for (const bottom of [false, true]) {
    const y0 = bottom ? SPEND_H - 6 - TAG_H : 6;
    const box = { x0, x1: x0 + TAG_W, y0, y1: y0 + TAG_H };
    if (!avoid.some((b) => hits(box, b))) return { ...box, left, bottom };
  }
  return null;
}

function Heads({ s, tag, width = 0, avoid = [] }: { s: Shared; tag?: boolean; width?: number; avoid?: Box[] }) {
  const f = fracOf(s.t, s.duration);
  const h = s.hoverTime === null ? null : fracOf(s.hoverTime, s.duration);
  const showHover = h !== null && Math.abs(h - f) > 1 / 150;
  // At the end of the run the transport clock already shows the time.
  const atEnd = s.t >= s.duration * 0.999;
  // The pointer's tag is placed first and wins. The playhead tag then avoids it and the end prices,
  // and hides when it has no clear place.
  const hoverTag = tag && width && showHover ? placeTag(h * width, width, avoid) : null;
  const headTag = tag && width && !atEnd ? placeTag(f * width, width, hoverTag ? [...avoid, hoverTag] : avoid) : null;
  const pos = (p: { left: boolean; bottom: boolean }) => `${p.left ? "right-1.5" : "left-1.5"} ${p.bottom ? "bottom-1.5" : "top-1.5"}`;
  return (
    <>
      <span className="pointer-events-none absolute inset-y-0 z-[1] w-px bg-ink" style={{ left: `${f * 100}%` }}>
        {headTag && <span className={`absolute whitespace-nowrap rounded-[5px] bg-ink px-1.5 py-0.5 font-mono text-[11px] font-medium text-bg tnum ${pos(headTag)}`}>{clock(s.t)}</span>}
      </span>
      {showHover && (
        <span className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-white/[0.16]" style={{ left: `${h * 100}%` }}>
          {hoverTag && <span className={`absolute whitespace-nowrap rounded-[5px] bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hair-2)] tnum ${pos(hoverTag)}`}>{clock(s.hoverTime!)}</span>}
        </span>
      )}
    </>
  );
}

/** The width of an element in pixels, kept current as it resizes. */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** A faint band over the time range of the hovered or selected step. */
function Bands({ s }: { s: Shared }) {
  const out = [];
  for (const id of new Set([s.selected, s.hoverSpan])) {
    if (!id) continue;
    const span = s.rows.find((r) => r.span.id === id)?.span;
    if (!span || span.kind === "agent") continue;
    const a = fracOf(span.start, s.duration);
    const b = fracOf(span.end, s.duration);
    out.push(
      <span
        key={id}
        className={`pointer-events-none absolute inset-y-0 ${id === s.selected ? "bg-white/[0.06]" : "bg-white/[0.035]"}`}
        style={{ left: `${a * 100}%`, width: `max(2px, ${(b - a) * 100}%)` }}
      />,
    );
  }
  return <>{out}</>;
}

/**
 * The re-price morph. When the what-if line appears, changes, or goes away, each step moves to its
 * new cost over 520 ms, left to right, with a small stagger. It always starts from what is on
 * screen now, so a fast second click retargets instead of jumping.
 */
function useMorph(curve: Pt[], target: Pt[] | null, reduce: boolean) {
  const [vals, setVals] = useState<number[] | null>(target ? target.map((p) => p.c) : null);
  const shown = useRef<number[] | null>(vals);
  useEffect(() => {
    const goal = (target ?? curve).map((p) => p.c);
    const from = shown.current ?? curve.map((p) => p.c);
    const n = goal.length;
    const stagger = n > 1 ? 0.4 / n : 0;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = reduce ? 1 : Math.min(1, (now - t0) / 520);
      const out = goal.map((g, i) => {
        const local = Math.min(1, Math.max(0, (p - i * stagger) / (1 - (n - 1) * stagger)));
        const e = 1 - Math.pow(1 - local, 4);
        return (from[i] ?? g) + (g - (from[i] ?? g)) * e;
      });
      const done = p >= 1;
      shown.current = done && !target ? null : out;
      setVals(shown.current);
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [curve, target, reduce]);
  return vals ? curve.map((p, i) => ({ t: p.t, c: vals[i] ?? p.c })) : null;
}

export type Sort = "time" | "cost";

export function Tape({
  s,
  curve,
  whatIf,
  changed,
  recorded,
  unpriced = 0,
  playing,
  pricedOn,
  sort,
  setSort,
}: {
  s: Shared;
  curve: Pt[];
  whatIf: Pt[] | null;
  changed: boolean;
  recorded: number;
  /** LLM calls with no known price. Their cost counts as nothing, so the readout says so. */
  unpriced?: number;
  playing: boolean;
  pricedOn: string | null;
  sort: Sort;
  setSort: (s: Sort) => void;
}) {
  // The LLM call under the pointer, with a little slack so thin bars are easy to hit.
  const scrub = useScrub(s, (v) => {
    const tol = s.duration / 300;
    const hit = s.rows.find((r) => r.span.kind === "llm" && v >= r.span.start - tol && v <= Math.max(r.span.end, r.span.start + s.duration / 400) + tol);
    return hit ? hit.span.id : null;
  });
  const reduce = !!useReducedMotion();
  const shownAlt = useMorph(curve, whatIf, reduce);
  const { duration, t } = s;
  const frac = (ms: number) => fracOf(ms, duration);
  const max = Math.max(1e-9, curve.at(-1)?.c ?? 0, whatIf?.at(-1)?.c ?? 0);
  const active = whatIf ?? curve;
  const at = (pts: Pt[], ms: number) => pts.reduce((c, p) => (p.t <= ms ? p.c : c), 0);
  const spent = at(active, t);
  const final = active.at(-1)?.c ?? 0;
  const done = t >= duration;
  const y = (c: number) => 100 - (c / max) * 80;
  const llm = s.rows.filter((r) => r.span.kind === "llm" && r.span.usage).map((r) => r.span);
  const prompt = (sp: Span) => sp.usage!.input + sp.usage!.cacheRead + sp.usage!.cacheWrite;
  const maxPrompt = maxOf(llm.map(prompt), 1);
  const lastCall = [...llm].reverse().find((sp) => sp.start <= t);
  const ticks = niceTicks(duration);

  // The end prices. Two close together would stack, so the lower price moves under its own line.
  // Their boxes, in pixels, are what the time tags must stay clear of.
  const spendRef = useRef<HTMLDivElement>(null);
  const spendW = useWidth(spendRef);
  const recTop = y(curve.at(-1)?.c ?? 0);
  const altTop = whatIf ? y(whatIf.at(-1)?.c ?? 0) : null;
  const closeLabels = altTop !== null && Math.abs(recTop - altTop) < (26 / SPEND_H) * 100;
  const recBelow = closeLabels && recTop >= altTop!;
  const altBelow = closeLabels && altTop! > recTop;
  const showRecLabel = !(recorded === 0 && unpriced > 0);
  const labelBox = (topPct: number, below: boolean, text: string): Box => {
    const yPx = (topPct / 100) * SPEND_H;
    const w = text.length * 6.7 + 14;
    return { x0: spendW - 8 - w, x1: spendW - 8, y0: below ? yPx + 3 : yPx - 3 - TAG_H, y1: below ? yPx + 3 + TAG_H : yPx - 3 };
  };
  const labelBoxes: Box[] = [
    ...(showRecLabel ? [labelBox(recTop, recBelow, usd(curve.at(-1)?.c ?? 0))] : []),
    ...(whatIf && altTop !== null ? [labelBox(altTop, altBelow, usd(whatIf.at(-1)?.c ?? 0))] : []),
  ];

  // A step line as points: flat until each LLM call ends, then up to the new total.
  const steps = (pts: Pt[]) => {
    const out: [number, number][] = [[0, 100]];
    let yy = 100;
    for (const p of pts) {
      const x = frac(p.t) * 1000;
      out.push([x, yy]);
      yy = y(p.c);
      out.push([x, yy]);
    }
    out.push([1000, yy]);
    return out;
  };
  const toPath = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(2)}`).join(" ");
  const linePts = steps(curve);
  const line = toPath(linePts);
  const altPts = shownAlt ? steps(shownAlt) : null;
  const alt = altPts ? toPath(altPts) : null;
  // The money saved: the area between the recorded line and the re-priced line.
  const saved = altPts ? `${line} ${[...altPts].reverse().map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(2)}`).join(" ")} Z` : null;

  return (
    <div className={GRID}>
      {/* Readouts. */}
      <div className="border-r border-hair">
        <div className="flex flex-col justify-between px-3 py-4 sm:px-5" style={{ height: SPEND_H }}>
          <div>
            <h2 className="truncate text-[12px] text-ink-3">{changed && pricedOn ? `Spend on ${pricedOn}` : changed ? "Spend, re-priced" : "Spend"}</h2>
            {!changed && unpriced > 0 && recorded === 0 ? (
              <span className="mt-1 block text-[22px] font-semibold leading-none tracking-[-0.03em] text-ink-2 sm:text-[30px]">No price</span>
            ) : (
              <Num value={spent} format={usd} duration={playing ? 0 : 0.5} className={`mt-1 block text-[22px] font-semibold leading-none tracking-[-0.03em] sm:text-[30px] ${changed ? "text-ink" : "text-rec"}`} />
            )}
          </div>
          <p className="text-[12px] leading-snug text-ink-3">
            {changed && (recorded === 0 || unpriced > 0) ? (
              // With calls that have no recorded price, a percentage would compare different sets of calls.
              <>recorded: {recorded === 0 ? "no price" : <><span className="text-rec">{usd(recorded)}</span> for the priced calls</>}</>
            ) : changed ? (
              <>
                recorded <span className="text-rec">{usd(recorded)}</span>{" "}
                <span className="text-ink-2">
                  {final < recorded ? "−" : "+"}
                  {Math.round(Math.abs(final / recorded - 1) * 100)}%
                </span>
              </>
            ) : unpriced > 0 && recorded === 0 ? (
              "Blackbox has no price for these models. Pick one in Compare models."
            ) : unpriced > 0 ? (
              <>
                {done ? "the whole run" : <>of {usd(final)}</>}, not counting {unpriced} {unpriced === 1 ? "call" : "calls"} with no price
              </>
            ) : done ? (
              "the whole run"
            ) : (
              <>of {usd(final)}</>
            )}
          </p>
        </div>
        {/* What the bars are: the input each LLM call sent, split by how it was billed. */}
        <div className="flex flex-col justify-center gap-1.5 border-t border-hair px-3 sm:px-5" style={{ height: CTX_H }}>
          <h2 className="flex items-baseline gap-1.5 text-[12px] text-ink-3">
            <span className="sm:hidden">Input per call</span>
            <span className="hidden sm:inline">Input sent per call</span>
            <span className="hidden text-ink tnum sm:inline">{lastCall ? tokens(prompt(lastCall)) : ""}</span>
          </h2>
          <div className="hidden flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-3 sm:flex">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-white/[0.66]" aria-hidden />
              full price
            </span>
            <span className="flex items-center gap-1.5">
              {/* Finer stripes than the bars: at this size the bar hatch shows one lone slash. */}
              <span className="size-2.5 rounded-[2px] bg-white/[0.06] bg-[repeating-linear-gradient(-55deg,rgb(255_255_255/0.5)_0_1px,transparent_1px_3px)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" aria-hidden />
              from cache
            </span>
            {llm.some((sp) => sp.usage!.cacheWrite > 0) && (
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-white/[0.34]" aria-hidden />
                cache write
              </span>
            )}
          </div>
        </div>
        {/* Step order: by time, or by cost with the most expensive call first. */}
        <div role="group" aria-label="Order the steps" className="flex h-7 items-center gap-0.5 border-t border-hair px-2 sm:px-3.5">
          <span className="mr-1.5 hidden text-[11.5px] text-ink-3 sm:inline">Order</span>
          {(["time", "cost"] as Sort[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={sort === k}
              onClick={() => setSort(k)}
              className={`rounded-[5px] px-1.5 py-px text-[11.5px] capitalize transition-colors duration-150 ${sort === k ? "bg-white/[0.09] text-ink" : "text-ink-3 hover:text-ink-2"}`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Tracks: the whole tape is one slider. */}
      <div
        {...scrub}
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${clock(t)}, ${usd(spent)} spent`}
        onKeyDown={(e) => {
          if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            s.onSeek(e.key === "Home" ? 0 : duration);
          }
        }}
        className="relative cursor-crosshair touch-none select-none outline-offset-[-2px]"
      >
        <div ref={spendRef} className="relative overflow-hidden" style={{ height: SPEND_H }}>
          <Bands s={s} />
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              <linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ff5f1f" stopOpacity="0.24" />
                <stop offset="1" stopColor="#ff5f1f" stopOpacity="0" />
              </linearGradient>
              {/* The re-priced run gets the same fade as the recorded one, in its own color. */}
              <linearGradient id="alt-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ededef" stopOpacity="0.11" />
                <stop offset="1" stopColor="#ededef" stopOpacity="0" />
              </linearGradient>
              {/* The saved band: a warm fade with a fine diagonal hatch, the same mark as a failed step's bar. */}
              <linearGradient id="saved-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ff5f1f" stopOpacity="0.2" />
                <stop offset="1" stopColor="#ff5f1f" stopOpacity="0.07" />
              </linearGradient>
              {/* The saved band in 0..1 units, so an HTML layer can use it as its clip. */}
              {saved && (
                <clipPath id="saved-clip" clipPathUnits="objectBoundingBox">
                  <path d={saved} transform="scale(0.001 0.01)" />
                </clipPath>
              )}
              <clipPath id="spend-played">
                <rect x="0" y="-10" width={frac(t) * 1000} height="120" />
              </clipPath>
            </defs>
            <path d={line} fill="none" stroke="rgba(255,95,31,0.22)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {alt && <path d={alt} fill="none" stroke="rgba(237,237,239,0.18)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
            <g clipPath="url(#spend-played)">
              {saved ? (
                <>
                  <path d={`${alt} L1000,100 Z`} fill="url(#alt-fill)" />
                  <path d={saved} fill="url(#saved-fill)" />
                </>
              ) : (
                <path d={`${line} L1000,100 Z`} fill="url(#spend-fill)" />
              )}
              <path d={line} fill="none" stroke="#ff5f1f" strokeWidth="1.5" vectorEffect="non-scaling-stroke" opacity={alt ? 0.5 : 1} />
              {alt && <path d={alt} fill="none" stroke="#ededef" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
            </g>
          </svg>
          {/* The hatch on the saved band. It is drawn in CSS pixels, so the stripes keep one angle and
              one spacing at every chart width. The outer box reveals it as the replay plays. */}
          {saved && t > 0 && (
            <div className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${frac(t) * 100}%` }} aria-hidden>
              <div className="saved-hatch absolute inset-y-0 left-0" style={{ width: `${100 / frac(t)}%`, clipPath: "url(#saved-clip)" }} />
            </div>
          )}
          {showRecLabel && <EndLabel top={recTop} text={usd(curve.at(-1)?.c ?? 0)} tone="rec" dim={!!alt} below={recBelow} />}
          {whatIf && altTop !== null && <EndLabel top={altTop} text={usd(whatIf.at(-1)?.c ?? 0)} tone="ink" below={altBelow} />}
          <span
            className={`pointer-events-none absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg ${alt ? "bg-ink" : "bg-rec"}`}
            // Kept 4 px inside the track, so the dot is never cut in half at the end of the run.
            style={{ left: `min(${frac(t) * 100}%, calc(100% - 4px))`, top: `${y(spent)}%` }}
          />
          <Heads s={s} tag width={spendW} avoid={labelBoxes} />
        </div>

        <div className="relative overflow-hidden border-t border-hair" style={{ height: CTX_H }}>
          <Bands s={s} />
          {llm.map((sp) => {
            const u = sp.usage!;
            const total = prompt(sp);
            const lit = s.highlight.has(sp.id);
            const focus = sp.id === s.hoverSpan || sp.id === s.selected;
            return (
              <span
                key={sp.id}
                className={`absolute bottom-0 flex min-w-[3px] flex-col-reverse overflow-hidden rounded-t-[2px] ${focus ? "shadow-[0_0_0_1px_rgba(255,255,255,0.75)]" : sp.start > t ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]" : ""}`}
                style={{
                  left: `${frac(sp.start) * 100}%`,
                  // 1 px less than the call, so calls that touch stay separate bars.
                  width: `max(3px, calc(${frac(Math.max(sp.end - sp.start, duration / 400)) * 100}% - 1px))`,
                  height: (total / maxPrompt) * (CTX_H - 22),
                }}
              >
                {/* A call that has not happened yet is an outline only, so it never reads as cached input. */}
                {sp.start <= t && (
                  <>
                    <span className="hatch" style={{ height: `${(u.cacheRead / total) * 100}%` }} />
                    <span className="bg-white/[0.34]" style={{ height: `${(u.cacheWrite / total) * 100}%` }} />
                    <span className={lit ? "bg-rec" : "bg-white/[0.66]"} style={{ height: `${(u.input / total) * 100}%` }} />
                  </>
                )}
              </span>
            );
          })}
          {/* The scale: a faint line at the tallest bar, with its value above the line, clear of every bar. */}
          <span className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/[0.08]" style={{ top: 22 }} aria-hidden />
          <span className="pointer-events-none absolute right-2 top-[5px] font-mono text-[11px] leading-none text-ink-3 tnum">max {tokens(maxPrompt)}</span>
          {(() => {
            const h = s.hoverSpan && s.hoverTime !== null ? llm.find((sp) => sp.id === s.hoverSpan) : null;
            if (!h) return null;
            const u = h.usage!;
            const f = frac(h.start);
            return (
              <span
                className={`pointer-events-none absolute top-1.5 z-10 flex items-center gap-2 whitespace-nowrap rounded-md bg-raised px-2 py-1 text-[11px] text-ink-3 shadow-[0_8px_20px_-6px_rgba(0,0,0,0.7),inset_0_0_0_1px_var(--hair-2)] ${f > 0.55 ? "-translate-x-[calc(100%+6px)]" : "translate-x-[6px]"}`}
                style={{ left: `${f * 100}%` }}
              >
                <span className="max-w-[160px] truncate text-ink">{h.name}</span>
                <span>
                  <span className="font-mono text-ink-2 tnum">{tokens(u.input + u.cacheWrite)}</span> full price
                </span>
                <span>
                  <span className="font-mono text-ink-2 tnum">{tokens(u.cacheRead)}</span> cached
                </span>
              </span>
            );
          })()}
          <Heads s={s} />
        </div>

        <div className="relative h-7 overflow-hidden border-t border-hair">
          {ticks.map((v, i) => (
            <span key={v} className={`absolute top-[7px] font-mono text-[11px] text-ink-3 tnum ${i === 0 ? "pl-1.5" : "-translate-x-1/2"}`} style={{ left: `${frac(v) * 100}%` }}>
              {tickLabel(v)}
            </span>
          ))}
          <Heads s={s} />
        </div>
      </div>
    </div>
  );
}

/** Rows past this count render as a window around the screen, not all at once. */
const WINDOW_AT = 400;

/** The rows to render for a long list: the ones on screen, plus a margin above and below. */
function useRowWindow(list: React.RefObject<HTMLDivElement | null>, on: boolean, count: number): [number, number] {
  const [range, setRange] = useState<[number, number]>([0, 80]);
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = list.current;
      if (!el) return;
      const rowH = parseFloat(getComputedStyle(el).getPropertyValue("--row-h")) || ROW_H;
      const r = el.getBoundingClientRect();
      const first = Math.max(0, Math.floor(-r.top / rowH) - 30);
      const last = Math.min(count, Math.ceil((innerHeight - r.top) / rowH) + 30);
      setRange((p) => (p[0] === first && p[1] === last ? p : [first, last]));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    schedule();
    addEventListener("scroll", schedule, true);
    addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", schedule, true);
      removeEventListener("resize", schedule);
    };
  }, [list, on, count]);
  return range;
}

export function Steps({ s, assign, sort, applied }: { s: Shared; assign: Record<string, string>; sort: Sort; applied: string | null }) {
  const list = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // By cost: every LLM call and tool call, most expensive first, with no tree indent.
  const ordered =
    sort === "cost"
      ? s.rows
          .filter((r) => r.span.kind !== "agent")
          .map((r) => ({ span: r.span, depth: 0 }))
          .sort((a, b) => (s.costs.get(b.span.id) ?? 0) - (s.costs.get(a.span.id) ?? 0) || b.span.end - b.span.start - (a.span.end - a.span.start))
      : s.rows;
  const { duration, t } = s;
  const frac = (ms: number) => fracOf(ms, duration);
  const top = maxOf(s.costs.values(), 1e-9);
  const ticks = niceTicks(duration);
  const focusable = s.selected ?? ordered[0]?.span.id;
  // A long trace renders only the rows near the screen. Below WINDOW_AT rows every row renders,
  // so the reorder animation still runs.
  const windowed = ordered.length > WINDOW_AT;
  const range = useRowWindow(list, windowed, ordered.length);
  const shown = windowed ? ordered.slice(range[0], range[1]) : ordered;

  const move = (from: number, dir: 1 | -1) => {
    const next = ordered[from + dir];
    if (!next) return;
    s.onSelect(next.span.id);
    const sel = `[data-row="${CSS.escape(next.span.id)}"]`;
    const row = list.current?.querySelector<HTMLButtonElement>(sel);
    if (row) {
      row.focus();
      return;
    }
    // In a windowed list the next row may not be rendered yet: scroll to it, then focus it.
    const el = list.current;
    if (!el) return;
    const rowH = parseFloat(getComputedStyle(el).getPropertyValue("--row-h")) || ROW_H;
    const y = el.getBoundingClientRect().top + (from + dir) * rowH - innerHeight / 2;
    const main = el.closest("main");
    if (main && main.scrollHeight > main.clientHeight) main.scrollBy({ top: y });
    else scrollBy({ top: y });
    requestAnimationFrame(() => requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(sel)?.focus()));
  };

  return (
    <div ref={list} className="relative" role="listbox" aria-label="Steps of the run" onMouseLeave={() => s.setHoverSpan(null)}>
      {/* Grid lines in the track column, behind the rows. */}
      <div className={`${GRID} pointer-events-none absolute inset-0`} aria-hidden>
        <span className="border-r border-hair" />
        <div className="relative">
          {ticks.map((v) => (
            <span key={v} className="absolute inset-y-0 w-px bg-white/[0.03]" style={{ left: `${frac(v) * 100}%` }} />
          ))}
        </div>
      </div>
      {windowed && <div style={{ height: `calc(var(--row-h, ${ROW_H}px) * ${ordered.length})` }} aria-hidden />}
      {shown.map(({ span, depth }, k) => {
        const i = windowed ? range[0] + k : k;
        const cost = s.costs.get(span.id) ?? 0;
        const len = span.end - span.start;
        const played = Math.max(0, Math.min(span.end, t) - span.start);
        const future = span.start > t;
        const err = span.status === "error";
        const on = s.selected === span.id;
        const hot = s.highlight.has(span.id);
        const hovered = s.hoverSpan === span.id;
        // A row names its model only when it differs from the baseline: the run-wide model the header
        // chip names, or else the recorded model.
        const moved = span.kind === "llm" && assign[span.id] && assign[span.id] !== (applied ?? span.model);
        const fill = span.kind === "llm" ? `rgba(237,237,239,${0.34 + 0.6 * Math.sqrt(cost / top)})` : err ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.3)";
        const endFrac = frac(span.end);
        const flip = endFrac > 0.8;
        return (
          <motion.button
            key={span.id}
            layout={reduce || windowed ? false : "position"}
            transition={{ duration: 0.32, ease: [0.77, 0, 0.175, 1] }}
            type="button"
            role="option"
            aria-selected={on}
            data-row={span.id}
            tabIndex={span.id === focusable ? 0 : -1}
            onClick={() => s.onSelect(span.id)}
            onMouseEnter={() => s.setHoverSpan(span.id)}
            onFocus={() => s.setHoverSpan(span.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                move(i, e.key === "ArrowDown" ? 1 : -1);
              }
            }}
            className={`${GRID} relative w-full text-left outline-offset-[-2px] ${on ? "bg-white/[0.06]" : hot ? "bg-rec/[0.07]" : hovered ? "bg-white/[0.03]" : ""}`}
            // 30 px with a mouse, 40 px on a touch screen, so a finger can hit one row.
            style={windowed ? { position: "absolute", left: 0, top: `calc(var(--row-h, ${ROW_H}px) * ${i})`, height: `var(--row-h, ${ROW_H}px)` } : { height: `var(--row-h, ${ROW_H}px)` }}
          >
            <span className="relative flex min-w-0 items-center gap-2 pr-3 text-[12.5px]" style={{ paddingLeft: 12 + depth * 12 }}>
              {hot && <span className="absolute inset-y-[6px] left-0 w-px bg-rec" />}
              <span className={span.kind === "agent" ? "text-ink-3" : "text-ink-2"}>
                <KindMark kind={span.kind} error={err} />
              </span>
              {/* The step name keeps its room. The model name takes what is left and truncates first. */}
              <span className={`min-w-0 truncate ${span.kind === "agent" ? "font-medium text-ink" : on || hovered ? "text-ink" : "text-ink-2"}`}>{span.name}</span>
              {moved && <span className="ml-auto min-w-0 shrink-[999] overflow-hidden whitespace-nowrap font-mono text-[11px] text-ink-3 [mask-image:linear-gradient(to_right,#000_calc(100%-14px),transparent)]" title={assign[span.id]}>{shortModel(assign[span.id])}</span>}
            </span>
            <span className="relative block h-full overflow-hidden">
              {span.kind === "agent" ? (
                <span className="absolute top-1/2 h-[6px] -translate-y-1/2 border-x border-t border-white/25" style={{ left: `${frac(span.start) * 100}%`, width: `${frac(len) * 100}%`, opacity: future ? 0.35 : 1 }} />
              ) : (
                <span
                  className={`absolute top-1/2 h-3 min-w-[3px] -translate-y-1/2 overflow-hidden rounded-[3px] bg-white/[0.07] ${err ? "outline outline-1 -outline-offset-1 outline-dashed outline-white/40" : on ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.85)]" : ""}`}
                  style={{ left: `${frac(span.start) * 100}%`, width: `${frac(len) * 100}%` }}
                >
                  <span className={`absolute inset-y-0 left-0 ${err ? "hatch" : ""}`} style={{ width: len > 0 ? `${(played / len) * 100}%` : future ? "0%" : "100%", background: err ? undefined : fill }} />
                </span>
              )}
              {(span.kind === "llm" || err) && span.end <= t && (
                <span
                  className={`pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] tnum ${err ? "text-ink-2" : "font-mono text-ink-3"} ${flip ? "pr-2" : "pl-2"}`}
                  style={flip ? { right: `${(1 - frac(span.start)) * 100}%` } : { left: `${endFrac * 100}%` }}
                >
                  {err ? "failed" : s.noPrice.has(span.id) ? "no price" : usd(cost)}
                </span>
              )}
            </span>
          </motion.button>
        );
      })}
      {/* The playhead and hover guide over the track column. */}
      <div className={`${GRID} pointer-events-none absolute inset-0`} aria-hidden>
        <span />
        <div className="relative">
          <Heads s={s} />
        </div>
      </div>
    </div>
  );
}

function EndLabel({ top, text, tone, dim, below }: { top: number; text: string; tone: "rec" | "ink"; dim?: boolean; below?: boolean }) {
  return (
    <span
      // A dark backing, so the price stays readable over the hatched band and the lines.
      className={`pointer-events-none absolute right-2 z-[2] ${below ? "translate-y-[3px]" : "-translate-y-[calc(100%+3px)]"} rounded-[5px] bg-bg/85 px-1.5 py-0.5 font-mono text-[11px] tnum shadow-[0_0_0_1px_var(--hair),0_4px_12px_-4px_rgba(0,0,0,0.8)] ${tone === "rec" ? (dim ? "text-rec/75" : "text-rec") : "text-ink"}`}
      style={{ top: `${top}%` }}
    >
      {text}
    </span>
  );
}

/** A tick time in the largest unit that keeps it short: "45s", "12m", "3h", "2d". */
function tickLabel(ms: number) {
  if (ms === 0) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 120) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** About 8 round ticks for any run length, from a second to a week. */
function niceTicks(duration: number) {
  const m = 60_000;
  const hr = 60 * m;
  const steps = [1000, 2000, 5000, 10000, 15000, 30000, m, 2 * m, 5 * m, 10 * m, 15 * m, 30 * m, hr, 2 * hr, 3 * hr, 6 * hr, 12 * hr, 24 * hr];
  const step = steps.find((x) => duration / x <= 8) ?? 24 * hr;
  const out: number[] = [];
  for (let v = 0; v <= duration - step * 0.4; v += step) out.push(v);
  return out;
}
