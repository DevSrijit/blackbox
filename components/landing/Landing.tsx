"use client";

import Link from "next/link";
import { usd } from "@/lib/cost";
import { useOpener } from "../Opener";
import { Key, Logo } from "../ui";
import { HeroTape, type HeroData } from "./HeroTape";

export type { HeroData };

export type DemoCard = {
  slug: string;
  title: string;
  description: string;
  cost: number;
  saving: number;
  calls: number;
  seconds: number;
  cached: number;
  /** The spend line, normalised: [time 0..1, share of total 0..1]. */
  curve: [number, number][];
};

const GITHUB = "https://github.com/DevSrijit/blackbox";

export function Landing({ demos, hero, modelCount }: { demos: DemoCard[]; hero: HeroData; modelCount: number }) {
  const { openFile } = useOpener();

  return (
    <div className="min-h-dvh">
      <nav className="mx-auto flex h-14 max-w-[1120px] items-center gap-6 px-5 sm:px-8" aria-label="Main">
        <Link href="/" className="-ml-1 flex items-center gap-2 rounded-md px-1 py-1">
          <Logo />
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Blackbox</span>
        </Link>
        <div className="ml-auto flex items-center gap-1 text-[13px]">
          <a href="#demos" className="hidden rounded-md px-2.5 py-1.5 text-ink-2 transition-colors hover:text-ink sm:block">
            Demos
          </a>
          <a href={GITHUB} target="_blank" rel="noreferrer" className="rounded-md px-2.5 py-1.5 text-ink-2 transition-colors hover:text-ink">
            Source
          </a>
          <button type="button" onClick={openFile} className="ml-2 rounded-lg px-3 py-1.5 text-ink shadow-[inset_0_0_0_1px_var(--hair-2)] transition-[background-color,transform] duration-150 ease-out hover:bg-white/[0.05] active:scale-[0.97]">
            Open a trace
          </button>
        </div>
      </nav>

      <main>
        <section className="mx-auto max-w-[1120px] px-5 pb-10 pt-12 sm:px-8 sm:pt-16">
          <h1 className="max-w-[15ch] text-balance text-[42px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[64px]" style={{ fontFamily: "var(--font-display)" }}>
            A flight recorder for AI agents.
          </h1>
          <p className="mt-5 max-w-[54ch] text-pretty text-[16px] leading-relaxed text-ink-2 sm:text-[18px]">
            Replay one agent run, step by step. See the cost of each LLM call. Find the waste. Price the same run on any of {modelCount} OpenRouter models.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={`/demo/${hero.slug}`}
              className="group flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-[14px] font-medium text-bg transition-[background-color,transform] duration-150 ease-out hover:bg-white active:scale-[0.97]"
            >
              Watch a demo
              <svg viewBox="0 0 12 12" className="size-3 transition-transform duration-200 ease-out group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path d="M2.5 6h7M6.5 3l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <button
              type="button"
              onClick={openFile}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[14px] text-ink shadow-[inset_0_0_0_1px_var(--hair-2)] transition-[background-color,transform] duration-150 ease-out hover:bg-white/[0.05] active:scale-[0.97]"
            >
              Open a trace
              <Key>⌘O</Key>
            </button>
          </div>
          <p className="mt-4 text-[13px] text-ink-3">Runs in your browser. No account. Your trace stays on your machine.</p>
        </section>

        <section className="mx-auto max-w-[1120px] px-5 sm:px-8" aria-label="A replay of the billing agent demo">
          <HeroTape data={hero} />
          <p className="mt-3 text-pretty text-[13px] text-ink-3">
            The billing agent demo: the run as it happened, then the same calls priced on {hero.model}.{" "}
            <Link href={`/demo/${hero.slug}`} className="text-ink-2 underline decoration-white/20 underline-offset-[3px] transition-colors hover:text-ink">
              Open it
            </Link>
          </p>
        </section>

        <section id="demos" className="mx-auto max-w-[1120px] scroll-mt-8 px-5 pb-24 pt-24 sm:px-8 sm:pt-32">
          <h2 className="text-[24px] font-semibold tracking-[-0.025em] sm:text-[28px]">Recorded runs</h2>
          <p className="mt-2 max-w-[56ch] text-pretty text-[15px] leading-relaxed text-ink-2">Two agents that waste money, and one that does not. Open one to replay it, find the waste, and price it on another model.</p>
          <ul className="mt-8 border-t border-hair">
            {demos.map((d) => (
              <li key={d.slug} className="border-b border-hair">
                <Link
                  href={`/demo/${d.slug}`}
                  className="group -mx-3 grid grid-cols-1 items-center gap-x-8 gap-y-4 rounded-xl px-3 py-6 transition-colors duration-150 hover:bg-white/[0.025] sm:grid-cols-[180px_minmax(0,1fr)_auto]"
                >
                  <Thumb curve={d.curve} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[16px] font-medium text-ink">
                      {d.title}
                      <svg viewBox="0 0 12 12" className="size-3 text-ink-3 transition-[transform,color] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                        <path d="M2.5 6h7M6.5 3l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="mt-1 block max-w-[62ch] text-pretty text-[14px] leading-relaxed text-ink-2">{d.description}</span>
                  </span>
                  <span className="flex gap-6 text-[13px] text-ink-3 tnum sm:flex-col sm:gap-1 sm:text-right">
                    <span>
                      <span className="font-mono text-rec">{usd(d.cost)}</span> per run
                    </span>
                    <span>{d.saving > 0.0005 ? <>about {Math.round((d.saving / d.cost) * 100)}% waste</> : <>{Math.round(d.cached * 100)}% cached input</>}</span>
                    <span>
                      {d.calls} LLM calls, {d.seconds.toFixed(0)} s
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-10 max-w-[64ch] text-pretty text-[14px] leading-relaxed text-ink-2">
            Use your own run: Blackbox reads OpenTelemetry JSON (GenAI or OpenInference attributes) and JSON lines of OpenAI or OpenRouter chat calls.{" "}
            <button type="button" onClick={openFile} className="text-ink underline decoration-white/25 underline-offset-[3px] transition-colors hover:decoration-white/60">
              Open a trace
            </button>{" "}
            or drop a file anywhere on this page.
          </p>
        </section>
      </main>

      {/* The rule spans the content width, not the padding around it. */}
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8">
      <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-hair py-6 text-[13px] text-ink-3">
        <span>
          Built by{" "}
          <a href="https://github.com/DevSrijit" target="_blank" rel="noreferrer" className="text-ink-2 transition-colors hover:text-ink">
            Srijit Ghosh
          </a>
        </span>
        <a href={GITHUB} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
          Source
        </a>
        <span className="ml-auto">Prices from OpenRouter, refreshed every hour</span>
      </footer>
      </div>
    </div>
  );
}

/** A demo's spend line, small. The real curve of that run, not a decoration. */
function Thumb({ curve }: { curve: [number, number][] }) {
  let d = "M0,40";
  let y = 40;
  for (const [t, c] of curve) {
    const x = (t * 180).toFixed(1);
    d += ` L${x},${y.toFixed(1)}`;
    y = 40 - c * 32;
    d += ` L${x},${y.toFixed(1)}`;
  }
  d += ` L180,${y.toFixed(1)}`;
  return (
    <svg viewBox="0 0 180 44" className="h-11 w-[180px] overflow-visible" aria-hidden>
      <path d={`M0,40 L180,40`} stroke="var(--hair-2)" strokeWidth="1" />
      <path d={d} fill="none" stroke="#ff5f1f" strokeWidth="1.5" strokeLinejoin="round" className="opacity-70 transition-opacity duration-200 group-hover:opacity-100" />
    </svg>
  );
}
