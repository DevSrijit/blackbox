"use client";

// The showcase scenes after the replay. Each one is a tall section with a pinned text layer; its
// scroll progress drives one part of the token field. Overlay draws what must line up with the
// dots (axis, failure band, labels) in the field's own pinned layer, so it never drifts.

import { motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { usd } from "@/lib/cost";
import { useOpener } from "../Opener";
import { Key, shortModel } from "../ui";
import type { CallMark, CallPrice, FieldApi } from "./field/Field";
import { REPLAY, tokensOf, type FieldRun } from "./field/layout";
import { at, PAD, ticks, type Failure } from "./Replay";

export type Showcase = {
  /** Recorded price per call, USD per token. */
  prices: CallPrice[];
  /** The models the run used, and which calls used each. */
  recorded: { id: string; pin: number; pout: number; calls: number[] }[];
  /** Models to price the whole run on, most expensive first. */
  sweep: { id: string; pin: number; pout: number; total: number }[];
  findings: { kind: string; title: string; saving: number }[];
  /** Finding groups per call, for the field. */
  marks: CallMark[];
  /** Every tool call of the run, in order. */
  tools: { name: string; ms: number; failed: boolean }[];
  /** All findings combined, without double counting. */
  saving: number;
  wasteTokens: number;
  modelCount: number;
};

type Props = { run: FieldRun; data: Showcase; total: number; field: FieldApi };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const per1M = (p: number) => `$${(p * 1e6).toFixed(p * 1e6 >= 10 ? 0 : 2)}`;
/** The color scale of the field: a dot's warmth is (price / reference) ^ 0.6. */
const warmth = (p: number, ref: number) => Math.pow(clamp01(p / ref), 0.6);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const display = { fontFamily: "var(--font-display)" };

/**
 * Progress of a scene while it is pinned, and the style of its text layer. While the section
 * scrolls in, the text is held at its pinned place, so it never slides across the chart; it only
 * sharpens in. It fades out before the pin lets go.
 */
export function useScene(ref: React.RefObject<HTMLElement | null>) {
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const { scrollYProgress: enter } = useScroll({ target: ref, offset: ["start end", "start start"] });
  const y = useTransform(enter, (e) => -(1 - e) * (typeof window === "undefined" ? 0 : window.innerHeight));
  const opacity = useTransform([enter, p] as MotionValue<number>[], ([e, q]: number[]) => Math.min(smooth((e - 0.45) / 0.5), 1 - smooth((q - 0.88) / 0.1)));
  const filter = useTransform(opacity, (o) => `blur(${((1 - o) * 12).toFixed(2)}px)`);
  return { p, style: { opacity, filter, y } };
}

function Heading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="max-w-[18ch] text-balance text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1] tracking-[-0.035em]" style={display}>
      {children}
    </h2>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 max-w-[48ch] text-pretty text-[15px] leading-relaxed text-ink-2 sm:text-[16px]">{children}</p>;
}

/* ───────────── Waiting: slow and failed tools ───────────── */

export function Waiting(props: Props & { live: boolean }) {
  return props.live ? <WaitingLive {...props} /> : <WaitingStill {...props} />;
}

const waitCopy = (d: Showcase) => {
  const worst = d.tools.reduce((a, t) => (t.ms > a.ms ? t : a), d.tools[0]);
  const s = Math.round(worst.ms / 1000);
  // The heading names the cost of the slowest tool in time, from the run itself.
  return { worst, title: `${s} seconds lost to one tool.`, line: `${worst.name} hangs for ${s} s${worst.failed ? " and fails" : ""}. The agent waits, then asks for it again.` };
};

function WaitingLive({ data, field }: Props) {
  const section = useRef<HTMLElement>(null);
  const { p, style } = useScene(section);
  useMotionValueEvent(p, "change", (v) => field.dim(smooth(v / 0.12) * (1 - smooth((v - 0.84) / 0.14))));
  const { title, line } = waitCopy(data);
  return (
    <section ref={section} className="relative h-[170svh]" aria-labelledby="wait-title">
      <motion.div className="pointer-events-none sticky top-0 h-svh" style={style}>
        <div className="mx-auto grid max-w-[1280px] gap-x-10 gap-y-8 px-5 pt-[clamp(72px,12svh,120px)] sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
          <div>
            <Heading id="wait-title">{title}</Heading>
            <Lead>{line} Blackbox puts every tool call on the same timeline, so a slow tool has nowhere to hide.</Lead>
          </div>
          <ToolTimes tools={data.tools} p={p} className="hidden lg:block" />
        </div>
      </motion.div>
    </section>
  );
}

/** Every tool call and how long it took. The bars fill as the scene plays. */
function ToolTimes({ tools, p, className = "" }: { tools: Showcase["tools"]; p: MotionValue<number>; className?: string }) {
  const most = Math.max(...tools.map((t) => t.ms));
  return (
    <ol className={`self-start ${className}`} aria-label="Tool calls and their duration">
      {tools.map((t, i) => (
        <ToolRow key={i} tool={t} share={t.ms / most} p={p} index={i} />
      ))}
    </ol>
  );
}

function ToolRow({ tool, share, p, index }: { tool: Showcase["tools"][number]; share: number; p: MotionValue<number>; index: number }) {
  const grow = useTransform(p, (v) => smooth((v - 0.06 - index * 0.02) / 0.3) * share);
  return (
    <li className="grid grid-cols-[132px_minmax(0,1fr)_64px] items-center gap-3 py-[5px] text-[12.5px]">
      <span className={`truncate font-mono ${tool.failed ? "text-ink" : "text-ink-2"}`}>{tool.name}</span>
      <span className="relative h-2 overflow-hidden rounded-[2px] bg-white/[0.04]">
        <motion.span className={`absolute inset-y-0 left-0 w-full origin-left rounded-[2px] ${tool.failed ? "hatch" : "bg-ink-4"}`} style={{ scaleX: grow }} />
      </span>
      <span className="text-right font-mono text-ink-3 tnum">
        {secs(tool.ms)}
        {tool.failed && <span className="sr-only">, failed</span>}
      </span>
    </li>
  );
}

function WaitingStill({ data }: Props) {
  const { title, line } = waitCopy(data);
  const done = useMotionValue(1);
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8" aria-labelledby="wait-title">
      <Heading id="wait-title">{title}</Heading>
      <Lead>{line}</Lead>
      <div className="mt-8 max-w-[480px]">
        <ToolTimes tools={data.tools} p={done} />
      </div>
    </section>
  );
}

/* ───────────── Price ───────────── */

export function Price(props: Props & { live: boolean }) {
  return props.live ? <PriceLive {...props} /> : <PriceStill {...props} />;
}

function PriceLive({ data, field }: Props) {
  const section = useRef<HTMLElement>(null);
  const { p, style } = useScene(section);
  useMotionValueEvent(p, "change", (v) => {
    field.ignite(smooth((v - 0.04) / 0.36));
    // The model labels leave with this scene's text, before the model strip arrives.
    field.labels(1 - smooth((v - 0.78) / 0.12));
  });
  const ref = Math.max(...data.prices.map((x) => x.pin));
  const outRatio = data.recorded[0] ? Math.round(data.recorded[0].pout / data.recorded[0].pin) : 0;

  return (
    <section ref={section} className="relative h-[190svh]" aria-labelledby="price-title">
      <motion.div className="pointer-events-none sticky top-0 h-svh" style={style}>
        {/* The scale sits in its own column on wide screens, above the bars, like the replay readout. */}
        <div className="mx-auto grid max-w-[1280px] gap-x-10 px-5 pt-[clamp(72px,12svh,120px)] sm:px-8 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          <div>
            <Heading id="price-title">Every token has a price tag.</Heading>
            <Lead>
              Orange is money. The brighter the dot, the more it cost.{outRatio > 1 ? ` Output tokens cost ${outRatio} times as much as input, so the top of each bar burns hottest.` : ""}
            </Lead>
          </div>
          <Legend recorded={data.recorded} refPrice={ref} className="mt-8 md:mt-2" />
        </div>
      </motion.div>
    </section>
  );
}

/** The color scale, with the run's own models marked on it. */
function Legend({ recorded, refPrice, className = "mt-8" }: { recorded: Showcase["recorded"]; refPrice: number; className?: string }) {
  return (
    <div className={`w-full max-w-[420px] self-start ${className}`} aria-label="Color scale: price per 1M input tokens">
      <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, rgb(237 237 239 / 0.28), rgb(190 110 80) 45%, #ff5f1f 100%)" }}>
        {recorded.map((r) => (
          <span key={r.id} className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg shadow-[inset_0_0_0_2px_var(--ink)]" style={{ left: `${warmth(r.pin, refPrice) * 100}%` }} />
        ))}
      </div>
      <div className="relative mt-2 h-6 text-[12px] text-ink-3">
        <span className="absolute left-0 tnum">$0</span>
        {recorded.map((r) => (
          <span key={r.id} className="absolute -translate-x-1/2 whitespace-nowrap tnum" style={{ left: `${warmth(r.pin, refPrice) * 100}%` }}>
            {per1M(r.pin)}
          </span>
        ))}
      </div>
      <p className="-mt-3 text-[12px] text-ink-3">Price per 1M input tokens</p>
    </div>
  );
}

function PriceStill({ run, data }: Props) {
  const ref = Math.max(...data.prices.map((x) => x.pin));
  const most = Math.max(...run.calls.map(tokensOf));
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8" aria-labelledby="price-title">
      <Heading id="price-title">Every token has a price tag.</Heading>
      <Lead>Orange is money. The brighter the bar, the more each of its tokens cost.</Lead>
      <Legend recorded={data.recorded} refPrice={ref} />
      <div className="relative mt-8 h-[min(36svh,300px)] border-b border-hair-2" aria-hidden>
        {run.calls.map((c, i) => (
          <div
            key={i}
            className="absolute bottom-0 rounded-t-[2px] bg-rec"
            style={{ left: `${(c.start / run.duration) * 100}%`, width: `max(3px, ${((c.end - c.start) / run.duration) * 100}%)`, height: `${(tokensOf(c) / most) * 100}%`, opacity: 0.25 + 0.75 * warmth(data.prices[i]?.pin ?? 0, ref) }}
          />
        ))}
      </div>
    </section>
  );
}

/* ───────────── Any model ───────────── */

export function Models(props: Props & { live: boolean }) {
  return props.live ? <ModelsLive {...props} /> : <ModelsStill {...props} />;
}

type Item = { key: string; label: string; sub: string; total: number; pin: number; pout: number };

function items(data: Showcase, total: number): Item[] {
  return [
    { key: "recorded", label: "As recorded", sub: data.recorded.map((r) => shortModel(r.id)).join(" and "), total, pin: 0, pout: 0 },
    ...data.sweep.map((m) => ({ key: m.id, label: shortModel(m.id), sub: m.id.split("/")[0], total: m.total, pin: m.pin, pout: m.pout })),
  ];
}

const delta = (v: number, base: number) => {
  const d = Math.round((1 - v / base) * 100);
  return d === 0 ? "the same price" : d > 0 ? `${d}% less` : `${-d}% more`;
};

function ModelsLive({ data, total, field }: Props) {
  const section = useRef<HTMLElement>(null);
  const { p, style } = useScene(section);
  const list = items(data, total);
  const n = list.length;
  // Scroll walks the list with a soft hold on each model. A spring carries the strip, so a
  // wheel's steps turn into one gliding motion.
  const eff = useTransform(p, (v) => {
    const f = clamp01((v - 0.06) / 0.86) * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    return Math.min(n - 1, i + smooth((f - i - 0.1) / 0.8));
  });
  const glide = useSpring(eff, { stiffness: 90, damping: 22, mass: 0.6, restDelta: 0.0005 });
  useMotionValueEvent(glide, "change", (e) => {
    if (e <= 1) {
      field.model(Math.max(0, e), list[1].pin, list[1].pout);
      return;
    }
    const i = Math.floor(e);
    const f = e - i;
    const a = list[i];
    const b = list[Math.min(n - 1, i + 1)];
    field.model(1, a.pin + (b.pin - a.pin) * f, a.pout + (b.pout - a.pout) * f);
  });
  const x = useTransform(glide, (e) => `calc(${-e} * var(--item))`);

  return (
    <section ref={section} className="relative h-[330svh]" aria-labelledby="models-title">
      <motion.div className="pointer-events-none sticky top-0 h-svh overflow-clip [--item:224px] sm:[--item:300px]" style={style}>
        <div className="mx-auto max-w-[1280px] px-5 pt-[clamp(64px,10svh,104px)] sm:px-8">
          <Heading id="models-title">Try the run on another model.</Heading>
          {/* On a short screen the strip needs this room; the sentence moves to the note at the bottom. */}
          <div className="max-lg:[@media(max-height:820px)]:hidden">
            <Lead>The tokens stay the same. Only the price moves, so the dots glow or dim.</Lead>
          </div>
        </div>
        {/* Below lg it sits between the text and the bars. On wide screens it takes its own column,
            level with the heading, and fades out at both edges, so text, strip and bars each have room. */}
        <div className="absolute inset-x-0 top-[calc(50svh-150px)] sm:top-[calc(42svh-150px)] lg:left-[48%] lg:top-[clamp(72px,12svh,120px)] lg:[mask-image:linear-gradient(90deg,transparent,#000_18%,#000_82%,transparent)]">
          <div className="relative h-[124px]">
            <motion.ol className="absolute left-[calc(50%-var(--item)/2)] top-0 flex will-change-transform" style={{ x }} aria-label="Run cost by model">
              {list.map((it, i) => (
                <Ticket key={it.key} item={it} index={i} eff={glide} base={total} />
              ))}
            </motion.ol>
          </div>
          <div className="mx-auto mt-2 h-3 w-px bg-ink" aria-hidden />
        </div>
        <p className="absolute inset-x-0 bottom-5 mx-auto max-w-[1280px] px-5 text-[13px] text-ink-3 sm:px-8">
          <span className="hidden max-lg:[@media(max-height:820px)]:inline">The tokens stay the same. Only the price moves. </span>The run&apos;s own models, then the most used models on OpenRouter in the last 4 weeks, priced on this run.
        </p>
      </motion.div>
    </section>
  );
}

function Ticket({ item, index, eff, base }: { item: Item; index: number; eff: MotionValue<number>; base: number }) {
  const near = useTransform(eff, (e) => clamp01(1 - Math.abs(e - index) * 0.9));
  const opacity = useTransform(near, (v) => 0.22 + 0.78 * v * v);
  const scale = useTransform(near, (v) => 0.84 + 0.16 * v);
  return (
    <motion.li className="flex w-[var(--item)] shrink-0 origin-bottom flex-col items-center text-center will-change-transform" style={{ opacity, scale }}>
      <span className="max-w-full truncate font-mono text-[13px] text-ink">{item.label}</span>
      <span className="mt-0.5 max-w-full truncate text-[12px] text-ink-3">{item.sub}</span>
      <span className="mt-2 text-[clamp(30px,3.6vw,46px)] font-semibold leading-none tracking-[-0.03em] text-rec tnum" style={display}>
        {usd(item.total)}
      </span>
      <span className="mt-1.5 text-[12px] text-ink-3 tnum">{index === 0 ? "per run" : `per run, ${delta(item.total, base)}`}</span>
    </motion.li>
  );
}

function ModelsStill({ data, total }: Props) {
  const list = items(data, total);
  const most = Math.max(...list.map((i) => i.total));
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8" aria-labelledby="models-title">
      <Heading id="models-title">Try the run on another model.</Heading>
      <Lead>The tokens stay the same. Only the price moves.</Lead>
      <ol className="mt-8 max-w-[640px] divide-y divide-hair border-y border-hair">
        {list.map((it, i) => (
          <li key={it.key} className="grid grid-cols-[minmax(0,1fr)_120px_80px] items-center gap-4 py-2.5 text-[13px]">
            <span className="truncate font-mono text-ink">{it.label}</span>
            <span className="h-1.5 rounded-full bg-rec/80" style={{ width: `${Math.max(2, (it.total / most) * 100)}%` }} aria-hidden />
            <span className="text-right font-mono text-rec tnum" title={i ? delta(it.total, total) : undefined}>
              {usd(it.total)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ───────────── Leaks: the findings, one at a time ───────────── */

/** The field's finding groups, in shader order. */
const GROUP: Record<string, number> = { cache: 0, loop: 1, retry: 2, premium: 3, tools: 4 };

/** Why each kind of finding costs money. The same for every trace; the titles come from the run. */
const WHY: Record<string, string> = {
  cache: "Each call sends the earlier conversation again at full price. With prompt caching, those tokens bill at the cache price.",
  loop: "The same tool runs again with the same arguments. Each repeat costs one more LLM call.",
  retry: "A step fails, and you still pay for the LLM call that asked for it.",
  premium: "Short answers come from an expensive model. A small model of the same provider gives the same few tokens for less.",
  tools: "Every call carries the full tool definitions. Shorter schemas, or fewer tools for each step, cut the input.",
};

/** The closing line of the leaks scene, true to the share the run could save. */
const verdict = (saving: number, total: number) => (total > 0 && saving / total > 0.5 ? "Most of this bill could be saved." : "Part of this bill could be saved.");

const OVERLAP = "The fixes overlap, so Blackbox applies them one after another. It never adds them up.";

export function Leaks(props: Props & { live: boolean }) {
  return props.live ? <LeaksLive {...props} /> : <LeaksStill {...props} />;
}

/** Where each finding's step starts and ends in the scene's progress; the fall comes after. */
const STEP0 = 0.05;
const STEP = 0.13;

function LeaksLive({ data, total, field }: Props) {
  const section = useRef<HTMLElement>(null);
  const { p, style } = useScene(section);
  const count = data.findings.length;
  const fall = STEP0 + count * STEP + 0.02;
  useMotionValueEvent(p, "change", (v) => {
    const w = [0, 0, 0, 0, 0];
    data.findings.forEach((f, i) => {
      const a = STEP0 + i * STEP;
      const g = GROUP[f.kind];
      if (g !== undefined) w[g] = Math.max(w[g], smooth((v - a) / 0.03) * (1 - smooth((v - (a + STEP) + 0.03) / 0.03)));
    });
    field.focus(w);
    field.waste(smooth((v - fall) / 0.16));
  });
  const first = useTransform(p, [fall - 0.02, fall + 0.03], [1, 0]);
  const second = useTransform(p, [fall + 0.04, fall + 0.1], [0, 1]);

  return (
    <section ref={section} className="relative h-[400svh]" aria-labelledby="leaks-title">
      <motion.div className="pointer-events-none sticky top-0 h-svh" style={style}>
        <div className="mx-auto grid max-w-[1280px] gap-x-10 gap-y-6 px-5 pt-[clamp(64px,10svh,104px)] sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
          {/* Two headings share one place: the walk through the findings, then the total. */}
          <div className="grid">
            <motion.div className="[grid-area:1/1]" style={{ opacity: first }}>
              <Heading id="leaks-title">Now find the leaks.</Heading>
              <Lead>Blackbox runs five checks on every trace. Scroll through them. Each one lights up the exact tokens it flags.</Lead>
            </motion.div>
            <motion.div className="[grid-area:1/1]" style={{ opacity: second }}>
              <Heading>{verdict(data.saving, total)}</Heading>
              <Saved saving={data.saving} total={total} />
              <p className="mt-3 max-w-[48ch] text-pretty text-[14px] leading-relaxed text-ink-3">{OVERLAP}</p>
            </motion.div>
          </div>
          <ol className="grid self-start lg:block" aria-label="Findings">
            {data.findings.map((f, i) => (
              <Leak key={f.title} index={i} p={p} finding={f} />
            ))}
          </ol>
        </div>
      </motion.div>
    </section>
  );
}

/** One finding. On wide screens all of them stack and the current one is bright; below lg only the current one shows. */
function Leak({ index, p, finding }: { index: number; p: MotionValue<number>; finding: Showcase["findings"][number] }) {
  const a = STEP0 + index * STEP;
  const on = useTransform(p, (v) => smooth((v - a) / 0.03) * (1 - smooth((v - (a + STEP) + 0.03) / 0.03)));
  const seen = useTransform(p, (v) => smooth((v - a) / 0.03));
  const opacity = useTransform([on, seen] as MotionValue<number>[], ([o, s]: number[]) => (typeof window !== "undefined" && window.innerWidth < 1024 ? o : 0.3 * s + 0.7 * o));
  const x = useTransform(seen, (s) => (1 - s) * 18);
  // Only the current finding opens its explanation; the others stay one line tall, so the list
  // keeps an even rhythm and never grows down into the chart.
  const rows = useTransform(on, (o) => `${o.toFixed(3)}fr`);
  return (
    <motion.li className="border-b border-hair py-2.5 [grid-area:1/1] lg:[grid-area:auto]" style={{ opacity, x }}>
      <div className="flex items-baseline justify-between gap-6 text-[13.5px]">
        <span className="text-pretty text-ink">{finding.title}</span>
        <span className="shrink-0 font-mono text-rec tnum">{usd(finding.saving)}</span>
      </div>
      <motion.div className="grid" style={{ gridTemplateRows: rows, opacity: on }}>
        <p className="min-h-0 overflow-hidden pt-1 text-pretty text-[12.5px] leading-snug text-ink-3">{WHY[finding.kind] ?? ""}</p>
      </motion.div>
    </motion.li>
  );
}

function Saved({ saving, total }: { saving: number; total: number }) {
  return (
    <p className="mt-3 text-[clamp(22px,2.6vw,32px)] font-semibold leading-tight tracking-[-0.025em] text-ink" style={display}>
      <span className="text-rec">{usd(saving)}</span> of the {usd(total)} it spent.
    </p>
  );
}

function LeaksStill({ data, total }: Props) {
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8" aria-labelledby="leaks-title">
      <Heading id="leaks-title">{verdict(data.saving, total)}</Heading>
      <Saved saving={data.saving} total={total} />
      <ol className="mt-8 max-w-[600px]" aria-label="Findings">
        {data.findings.map((f) => (
          <li key={f.title} className="border-b border-hair py-3">
            <div className="flex items-baseline justify-between gap-6 text-[13.5px]">
              <span className="text-pretty text-ink">{f.title}</span>
              <span className="shrink-0 font-mono text-rec tnum">{usd(f.saving)}</span>
            </div>
            <p className="mt-1 text-pretty text-[12.5px] leading-snug text-ink-3">{WHY[f.kind] ?? ""}</p>
          </li>
        ))}
        <li className="pt-2.5 text-[12px] text-ink-3">{OVERLAP}</li>
      </ol>
    </section>
  );
}

/* ───────────── Outro ───────────── */

export function Outro({ live, field, chips }: { live: boolean; field: FieldApi; chips: { slug: string; file: string }[] }) {
  const section = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: section, offset: ["start start", "end end"] });
  useMotionValueEvent(p, "change", (v) => {
    if (!live) return;
    // A short dark beat: the last scene fades out, the dots gather unseen into one point at the
    // center, the point lights, and the dots stream out of it into the ring.
    field.hide(v < 0.1 ? smooth(v / 0.07) : 1 - smooth((v - 0.12) / 0.06));
    field.origin(smooth((v - 0.075) / 0.03));
    field.ring(smooth((v - 0.17) / 0.42));
  });
  const opacity = useTransform(p, (q) => (live ? smooth((q - 0.36) / 0.2) : 1));
  const scale = useTransform(opacity, [0, 1], [0.94, 1]);
  return (
    <section ref={section} className={`relative ${live ? "h-[200svh]" : ""}`} aria-labelledby="outro-title">
      <motion.div className={`${live ? "sticky top-0 h-svh" : "py-28"} grid place-items-center px-5`} style={live ? { opacity, scale } : undefined}>
        <OutroBody chips={chips} />
      </motion.div>
    </section>
  );
}

function OutroBody({ chips }: { chips: { slug: string; file: string }[] }) {
  const { openFile } = useOpener();
  return (
    <div className="flex max-w-[30ch] flex-col items-center text-center sm:max-w-[34ch]">
      <h2 id="outro-title" className="text-balance text-[clamp(34px,4.6vw,60px)] font-semibold leading-[1] tracking-[-0.035em]" style={display}>
        Bring your own run.
      </h2>
      <p className="mt-4 text-pretty text-[15px] leading-relaxed text-ink-2">Drop its trace anywhere on this page. You get the same replay, prices and findings in seconds. The file stays on your machine.</p>
      <button
        type="button"
        onClick={openFile}
        className="mt-6 flex cursor-pointer items-center gap-2.5 rounded-xl bg-ink px-4 py-3 text-[14px] font-medium text-bg shadow-[0_10px_30px_-12px_rgba(255,255,255,0.45)] transition-[background-color,transform] duration-150 ease-out hover:bg-white active:scale-[0.97]"
      >
        Choose a trace file
        <Key light>⌘O</Key>
      </button>
      <p className="mt-5 text-[13px] text-ink-3">
        Or open a demo:{" "}
        {chips.map((c, i) => (
          <span key={c.slug}>
            {i > 0 && ", "}
            <Link href={`/demo/${c.slug}`} className="text-ink-2 underline decoration-white/20 underline-offset-[3px] transition-colors hover:text-ink hover:decoration-white/60">
              {c.slug.replace("-", " ")}
            </Link>
          </span>
        ))}
      </p>
    </div>
  );
}

/* ───────────── The pinned overlay ───────────── */

/** Marks that line up with the dots. They live in the field's pinned layer and follow its scenes. */
export function Overlay({ run, data, failure, field }: { run: FieldRun; data: Showcase; failure: Failure | null; field: FieldApi }) {
  const { scene, play, ignite, model, waste, ring, dim, hide, origin } = field.mv;
  // The chart's marks leave with the field, and stay away once its dots have gathered for the ring.
  const chart = useTransform([scene, ring, hide, origin] as MotionValue<number>[], ([s, r, h, o]: number[]) => smooth((s - 0.6) / 0.4) * (1 - smooth(r / 0.25)) * (1 - h) * (1 - o));
  const tickOp = useTransform([chart, waste] as MotionValue<number>[], ([c, w]: number[]) => c * (1 - smooth(w / 0.08)));
  const labels = useTransform([ignite, field.mv.labels, model, waste] as MotionValue<number>[], ([i, l, m, w]: number[]) => i * l * (1 - m) * (1 - smooth(w / 0.1)));
  const heap = useTransform([waste, ring, hide, origin] as MotionValue<number>[], ([w, r, h, o]: number[]) => smooth((w - 0.55) / 0.3) * (1 - smooth(r / 0.2)) * (1 - h) * (1 - o));

  const failStart = failure ? failure.start / run.duration : 0;
  const failEnd = failure ? failure.end / run.duration : 0;
  const failOp = useTransform([play, chart] as MotionValue<number>[], ([p, c]: number[]) => smooth((p - failStart) / 0.02) * c);
  const failWidth = useTransform(play, (p) => clamp01((Math.min(p, failEnd) - failStart) / Math.max(1e-6, failEnd - failStart)));
  // The waiting scene: the dead time, counted up inside its band, while the tokens step back.
  const waitMs = failure ? failure.end - failure.start : 0;
  const waitText = useTransform(dim, (d) => secs(waitMs * smooth(d)));
  const waitScale = useTransform(dim, (d) => 0.92 + 0.08 * d);

  const most = Math.max(...run.calls.map(tokensOf));
  return (
    <div className="pointer-events-none absolute inset-0 [--mh:34svh] sm:[--mh:42svh]" aria-hidden>
      <motion.div className="absolute inset-x-0" style={{ top: `${REPLAY.base * 100}svh`, opacity: chart }}>
        <div className="absolute h-px bg-hair-2" style={{ left: PAD, right: PAD }} />
        <motion.div style={{ opacity: tickOp }}>
          {ticks(run.duration).map((s) => (
            <span key={s} className="absolute top-2 -translate-x-1/2 font-mono text-[11px] text-ink-3 tnum" style={{ left: at((s * 1000) / run.duration) }}>
              {s} s
            </span>
          ))}
        </motion.div>
        {failure && (
          <motion.div className="absolute bottom-0" style={{ left: at(failStart), width: `calc(${failEnd - failStart} * (100% - 2 * ${PAD}))`, opacity: failOp }}>
            <motion.div className="hatch h-[22svh] origin-left rounded-t-[3px] sm:h-[28svh]" style={{ scaleX: failWidth }} />
            <div className="absolute bottom-full left-1/2 mb-2 w-max max-w-[min(44ch,80vw)] -translate-x-1/2 text-balance text-center text-[12.5px] leading-snug text-ink-2">
              <span className="text-ink">{failure.name}</span> failed after {Math.round((failure.end - failure.start) / 1000)} s. The agent waited, then asked again.
            </div>
            <motion.div className="absolute inset-x-0 bottom-[calc(11svh-0.5em)] text-center sm:bottom-[calc(14svh-0.5em)]" style={{ opacity: dim, scale: waitScale }}>
              <motion.span className="rounded-lg bg-bg/80 px-3 py-1 text-[clamp(36px,5vw,72px)] font-semibold tracking-[-0.03em] text-ink tnum" style={display}>
                {waitText}
              </motion.span>
            </motion.div>
          </motion.div>
        )}
      </motion.div>

      {/* The run's own models, over their calls, while the price scene owns the field. */}
      <motion.div className="absolute inset-0 hidden sm:block" style={{ opacity: labels }}>
        {data.recorded.map((r) => {
          const top = r.calls.reduce((a, i) => (tokensOf(run.calls[i]) > tokensOf(run.calls[a]) ? i : a), r.calls[0]);
          const c = run.calls[top];
          const share = (c.start + c.end) / 2 / run.duration;
          return (
            <span
              key={r.id}
              className={`absolute w-max -translate-y-full rounded-md bg-bg/80 px-1.5 py-1 text-[12px] leading-tight text-ink-2 ${share > 0.6 ? "-translate-x-full text-right" : ""}`}
              style={{ left: at(share > 0.6 ? c.end / run.duration : c.start / run.duration), top: `calc(${REPLAY.base * 100}svh - var(--mh) * ${tokensOf(c) / most} - 10px)` }}
            >
              <span className="block font-mono text-ink">{shortModel(r.id)}</span>
              <span className="tnum">
                {per1M(r.pin)} in, {per1M(r.pout)} out, per 1M tokens
              </span>
            </span>
          );
        })}
      </motion.div>

      <motion.p className="absolute left-1/2 w-max max-w-[90vw] -translate-x-1/2 rounded-md bg-bg/85 px-2 py-1 text-center text-[12.5px] text-ink-2" style={{ bottom: `calc(${(1 - REPLAY.base) * 100}svh + 10px)`, opacity: heap }}>
        <span className="font-mono text-rec tnum">{data.wasteTokens.toLocaleString("en-US")}</span> of {run.calls.reduce((a, c) => a + tokensOf(c), 0).toLocaleString("en-US")} tokens sent again or spent on repeated calls
      </motion.p>
    </div>
  );
}
