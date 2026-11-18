"use client";

// Scene one of the showcase: scroll is the playhead. Each LLM call pulls its tokens out of the
// cloud into a bar while the playhead crosses it. Width is time, height is tokens.

import { motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { usePinnedText } from "./pinned";
import { useRef } from "react";
import { usd } from "@/lib/cost";
import { clock, shortModel } from "../ui";
import type { FieldApi } from "./field/Field";
import { REPLAY, tokensOf, type FieldRun } from "./field/layout";

export type Failure = { name: string; start: number; end: number };

/** The chart's left and right inset. Same rule as the WebGL layout: max(20px, 6vw). */
export const PAD = `max(${REPLAY.padMin}px, ${REPLAY.pad * 100}vw)`;
export const at = (share: number) => `calc(${PAD} + ${share} * (100% - 2 * ${PAD}))`;

type Props = { run: FieldRun; failure: Failure | null; total: number; field: FieldApi };

export function Replay({ live, ...props }: Props & { live: boolean }) {
  return live ? <ReplayLive {...props} /> : <ReplayStill {...props} />;
}

function ReplayLive({ run, total, field }: Props) {
  const section = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  // A short lead-in and a hold at the end. The field's playhead runs a little past the end of the
  // run, so the tokens of the last call finish their flight; the readout stops at the end.
  const over = useTransform(scrollYProgress, [0.04, 0.86], [0, 1.06], { clamp: true });
  const play = useTransform(over, (p) => Math.min(1, p));

  const time = useRef<HTMLSpanElement>(null);
  const name = useRef<HTMLSpanElement>(null);
  const model = useRef<HTMLSpanElement>(null);
  const toks = useRef<HTMLSpanElement>(null);
  const cost = useRef<HTMLSpanElement>(null);
  const calls = useRef<HTMLSpanElement>(null);

  // Text follows the playhead by direct DOM writes. No React render per scroll frame.
  useMotionValueEvent(over, "change", (p) => field.play(p));
  useMotionValueEvent(play, "change", (p) => {
    const t = p * run.duration;
    let spent = 0;
    let done = 0;
    let cur = run.calls[0];
    for (const c of run.calls) {
      if (c.start <= t) cur = c;
      if (c.end <= t) {
        spent += c.cost;
        done++;
      }
    }
    if (time.current) time.current.textContent = clock(t);
    if (name.current) name.current.textContent = cur.name;
    if (model.current) model.current.textContent = shortModel(cur.model);
    if (toks.current) toks.current.textContent = tokensOf(cur).toLocaleString("en-US");
    if (cost.current) cost.current.textContent = usd(spent);
    if (calls.current) calls.current.textContent = String(done);
  });

  const playLeft = useTransform(play, (p) => at(p));
  const playFade = useTransform(scrollYProgress, [0.9, 1], [1, 0]);
  // The text layer shows only while pinned, and never moves by script (see pinned.ts).
  const text = usePinnedText(scrollYProgress, 0.04);
  const last = run.calls[run.calls.length - 1];

  return (
    <section ref={section} className="relative h-[260svh]" aria-labelledby="replay-title">
      <motion.div className="pointer-events-none sticky top-0 h-svh overflow-clip" style={text}>
        <div className="mx-auto grid max-w-[1280px] gap-6 px-5 pt-[clamp(72px,12svh,120px)] sm:px-8 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <h2 id="replay-title" className="max-w-[16ch] text-balance text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1] tracking-[-0.035em]" style={{ fontFamily: "var(--font-display)" }}>
              Follow one refund, call by call.
            </h2>
            <p className="mt-4 max-w-[46ch] text-pretty text-[15px] leading-relaxed text-ink-2 sm:text-[16px]">
              A sample support agent finds a duplicate charge and refunds it. Scroll to play the run. Each LLM call pulls its tokens into a bar, and the bars keep growing: every call resends the whole conversation.
            </p>
          </div>
          {/* The readout: the same facts the replay shows for the step under the playhead. */}
          <dl className="grid w-fit grid-cols-[auto_auto] gap-x-6 gap-y-1.5 self-start rounded-xl bg-raised/70 px-4 py-3 text-[13px] shadow-[inset_0_0_0_1px_var(--hair)] pointer-fine:backdrop-blur-md md:min-w-[280px]">
            <dt className="text-ink-3">Time</dt>
            <dd className="text-right font-mono text-ink tnum">
              <span ref={time}>00:00.0</span>
            </dd>
            <dt className="text-ink-3">Call</dt>
            <dd className="max-w-[22ch] truncate text-right text-ink">
              <span ref={name}>{run.calls[0].name}</span>
            </dd>
            <dt className="hidden text-ink-3 sm:block">Model</dt>
            <dd className="hidden text-right font-mono text-[12px] text-ink-2 sm:block">
              <span ref={model}>{shortModel(run.calls[0].model)}</span>
            </dd>
            <dt className="hidden text-ink-3 sm:block">Tokens in the call</dt>
            <dd className="hidden text-right font-mono text-ink tnum sm:block">
              <span ref={toks}>{tokensOf(run.calls[0]).toLocaleString("en-US")}</span>
            </dd>
            <dt className="text-ink-3">
              Spent, <span ref={calls}>0</span> of {run.calls.length} calls
            </dt>
            <dd className="text-right font-mono text-rec tnum">
              <span ref={cost}>$0.00</span>
            </dd>
          </dl>
        </div>

        <motion.div
          className="pointer-events-none absolute top-[46svh] h-[38svh] w-px bg-ink sm:top-[36svh] sm:h-[48svh]"
          style={{ left: playLeft, opacity: playFade }}
          aria-hidden
        >
          <span className="absolute -top-1 left-1/2 size-[7px] -translate-x-1/2 rounded-full bg-ink" />
        </motion.div>
        <p className="absolute inset-x-0 bottom-5 mx-auto max-w-[1280px] px-5 text-[13px] text-ink-3 sm:px-8">
          A sample run that ships with Blackbox, not real customer data. {run.calls.length} calls in {Math.round(run.duration / 1000)} s, ending with{" "}
          <span className="text-ink-2">{last.name}</span> and <span className="font-mono text-rec">{usd(total)}</span> spent.
        </p>
      </motion.div>
    </section>
  );
}

export function ticks(duration: number) {
  const s = duration / 1000;
  const step = s > 120 ? 30 : s > 40 ? 10 : 5;
  const out: number[] = [];
  for (let v = 0; v <= s; v += step) out.push(v);
  return out;
}

/** The finished frame, for reduced motion and for no JavaScript. Same chart, no pin. */
function ReplayStill({ run, failure, total }: Props) {
  const most = Math.max(...run.calls.map(tokensOf));
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8" aria-labelledby="replay-title">
      <h2 id="replay-title" className="max-w-[16ch] text-balance text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1] tracking-[-0.035em]" style={{ fontFamily: "var(--font-display)" }}>
        Follow one refund, call by call.
      </h2>
      <p className="mt-4 max-w-[52ch] text-pretty text-[15px] leading-relaxed text-ink-2 sm:text-[16px]">
        A sample support agent finds a duplicate charge and refunds it. Each bar is one LLM call. A wide bar took longer. A tall bar sent more tokens. This sample run ships with Blackbox: {run.calls.length} calls in{" "}
        {Math.round(run.duration / 1000)} s, and <span className="font-mono text-rec">{usd(total)}</span> spent.
      </p>
      <div className="relative mt-10 h-[min(42svh,360px)] border-b border-hair-2" aria-hidden>
        {failure && (
          <div className="hatch absolute bottom-0 h-[60%] rounded-t-[3px]" style={{ left: `${(failure.start / run.duration) * 100}%`, width: `${((failure.end - failure.start) / run.duration) * 100}%` }} />
        )}
        {run.calls.map((c, i) => (
          <div
            key={i}
            className="field-dots absolute bottom-0 rounded-t-[2px]"
            style={{ left: `${(c.start / run.duration) * 100}%`, width: `max(3px, ${((c.end - c.start) / run.duration) * 100}%)`, height: `${(tokensOf(c) / most) * 100}%` }}
          />
        ))}
      </div>
      {failure && (
        <p className="mt-3 text-[13px] text-ink-3">
          The striped band: <span className="text-ink-2">{failure.name}</span> failed after {Math.round((failure.end - failure.start) / 1000)} s.
        </p>
      )}
    </section>
  );
}
