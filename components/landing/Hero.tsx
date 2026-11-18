"use client";

// The hero. The whole page takes a dropped trace; the demos are files you drag in the same way.
// Every action also works with a click, a tap and the keyboard.

import { animate, motion, useMotionValue } from "motion/react";
import Link from "next/link";
import { useRef, useState } from "react";
import { usd } from "@/lib/cost";
import { useOpener } from "../Opener";
import { Key, Logo } from "../ui";
import type { FieldApi } from "./field/Field";
import { buildStatic, GALAXY, projectGalaxy, type FieldRun } from "./field/layout";

export type DemoChip = {
  slug: string;
  file: string;
  kb: number;
  cost: number;
  calls: number;
  /** What the run shows, from its biggest finding. */
  hook: string;
  /** All its findings combined, in USD. */
  saving: number;
};

const GITHUB = "https://github.com/DevSrijit/blackbox";

/** How long the dots take to fall into the drop point before the page changes. */
export const SINK_MS = 560;
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function Hero({
  run,
  chips,
  live,
  fieldReady,
  field,
  launching,
  onLaunch,
  tokenCount,
  total,
}: {
  run: FieldRun;
  chips: DemoChip[];
  live: boolean;
  fieldReady: boolean;
  field: FieldApi;
  launching: boolean;
  onLaunch: (href: string, x: number, y: number) => void;
  tokenCount: number;
  total: number;
}) {
  const { openFile } = useOpener();
  const fade = launching ? "opacity-0 blur-[6px] scale-[0.985]" : "opacity-100";

  return (
    <section className="relative isolate flex h-svh min-h-[600px] flex-col" aria-label="Open a trace">
      {/* The field's shape before WebGL runs, and with no JavaScript: the same galaxy, still. */}
      <Fallback run={run} hidden={fieldReady} />

      <nav className={`relative z-10 mx-auto flex h-14 w-full max-w-[1280px] items-center gap-6 px-5 transition-[opacity,filter,transform] duration-300 ease-out sm:px-8 ${fade}`} aria-label="Main">
        <Link href="/" className="-ml-1 flex items-center gap-2 rounded-md px-1 py-1 pointer-coarse:py-2.5">
          <Logo />
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Blackbox</span>
        </Link>
        <div className="ml-auto flex items-center gap-1 text-[13px]">
          <a href={GITHUB} target="_blank" rel="noreferrer" className="rounded-md px-2.5 py-1.5 text-ink-2 transition-colors hover:text-ink pointer-coarse:py-3">
            Source
          </a>
        </div>
      </nav>

      <div className={`relative z-10 mx-auto w-full max-w-[1280px] px-5 pt-[clamp(28px,9svh,104px)] transition-[opacity,filter,transform] duration-300 ease-out sm:px-8 ${fade}`}>
        {/* The galaxy's dots step back behind this box, so the type stays crisp over them. */}
        <div data-quiet className="w-fit">
          <h1 className="max-w-[12ch] text-balance text-[clamp(44px,7.4vw,96px)] font-semibold leading-[0.96] tracking-[-0.04em]" style={{ fontFamily: "var(--font-display)" }}>
            Know where every token goes.
          </h1>
          <p className="mt-6 max-w-[54ch] text-pretty text-[16px] leading-relaxed text-ink-2 sm:text-[18px]">
            Drop in one trace. Blackbox replays every LLM call, prices every token and shows you what to fix. The trace stays on your machine.
          </p>
        </div>
        {/* The demos are the main way in: one click and the visitor is inside the real tool. */}
        <p className="mt-8 text-[14px] font-medium text-ink">
          Open a demo run <span className="font-normal text-ink-3">· click one, or drag it into the field</span>
        </p>
        <ul className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap" aria-label="Demo runs">
          {chips.map((c, i) => (
            <li key={c.slug}>
              <Chip chip={c} live={live} field={field} onLaunch={onLaunch} story={i === 0} />
            </li>
          ))}
        </ul>
        {/* Your own trace is the second way in. It sits on its own frosted backing, since the field runs
            behind it. A phone cannot drag a file in, so there the hint about dropping goes away. */}
        <div className="mt-3 inline-flex items-center gap-3 rounded-xl bg-raised/85 p-1.5 text-[13px] text-ink-3 shadow-[inset_0_0_0_1px_var(--hair)] pointer-fine:backdrop-blur-md sm:pr-3.5">
          <button
            type="button"
            onClick={openFile}
            className="group flex cursor-pointer items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-1.5 text-ink transition-[background-color,color,transform] duration-150 ease-out hover:bg-ink hover:text-bg active:scale-[0.97] pointer-coarse:py-2.5"
          >
            Choose your own trace
            {/* The key cap inverts with the button on hover. */}
            <Key className="transition-colors duration-150 group-hover:bg-black/[0.08] group-hover:text-bg/75 group-hover:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]">⌘O</Key>
          </button>
          <span className="pointer-coarse:hidden max-sm:hidden">or drop it anywhere on this page.</span>
        </div>
      </div>

      <p
        className={`pointer-events-none absolute bottom-7 right-5 z-10 hidden max-w-[34ch] text-right text-[13px] leading-relaxed text-ink-2 transition-opacity duration-300 sm:right-8 md:block ${launching ? "opacity-0" : ""}`}
      >
        Each dot is one token of a sample support agent. Its run spirals out from the first call at the core to the last at the rim:{" "}
        <span className="text-ink tnum">{tokenCount.toLocaleString("en-US")}</span> tokens, {run.calls.length} LLM calls,{" "}
        <span className="font-mono text-rec">{usd(total)}</span>. Scroll to replay it.
      </p>
    </section>
  );
}

/** A demo trace as a file you can pick up. Drag it into the field, click it, or press Enter. */
function Chip({ chip, live, field, onLaunch, story }: { chip: DemoChip; live: boolean; field: FieldApi; onLaunch: (href: string, x: number, y: number) => void; story: boolean }) {
  const href = `/demo/${chip.slug}`;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [held, setHeld] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

  const release = () => {
    animate(x, 0, { type: "spring", stiffness: 520, damping: 34 });
    animate(y, 0, { type: "spring", stiffness: 520, damping: 34 });
  };

  return (
    <motion.div style={{ x, y }} className={`relative ${held ? "z-30" : ""}`}>
      <Link
        href={href}
        draggable={false}
        onPointerDown={(e) => {
          if (!live || e.button !== 0) return;
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
          dragged.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved) {
            if (Math.hypot(dx, dy) < 6) return;
            d.moved = true;
            dragged.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            setHeld(true);
          }
          x.set(dx);
          y.set(dy);
          field.pull(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d?.moved) return;
          setHeld(false);
          field.pullOff();
          // A short drag puts the file back. A real throw opens it where it landed.
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 90) onLaunch(href, e.clientX, e.clientY);
          else release();
        }}
        onPointerCancel={() => {
          drag.current = null;
          setHeld(false);
          field.pullOff();
          release();
        }}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || !live) return;
          e.preventDefault();
          // The click that ends a drag is not a launch. The next click, or Enter, is.
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          onLaunch(href, r.left + r.width / 2, r.top + r.height / 2);
        }}
        className={`group flex touch-none select-none items-center gap-3 rounded-xl bg-raised/85 py-2.5 pl-3 pr-3 text-[13px] pointer-fine:backdrop-blur-md transition-[box-shadow,background-color,transform] duration-150 ease-out hover:-translate-y-px hover:bg-raised hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.9),inset_0_0_0_1px_rgba(255,255,255,0.26)] pointer-coarse:touch-pan-y sm:w-[340px] ${story ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]" : "shadow-[inset_0_0_0_1px_var(--hair-2)]"} ${
          live ? (held ? "cursor-grabbing shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9),inset_0_0_0_1px_rgba(255,255,255,0.3)]" : "cursor-grab") : ""
        } ${held ? "scale-[1.04]" : "active:scale-[0.98]"}`}
      >
        <FileMark />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[12.5px] text-ink">{chip.file}</span>
            {story && <span className="rounded-[5px] bg-white/[0.07] px-1.5 py-[1px] text-[10.5px] text-ink-2">The run below</span>}
          </span>
          <span className="mt-1 text-pretty text-[12px] leading-snug text-ink-2">{chip.hook}</span>
          <span className="mt-1 text-[11.5px] text-ink-3 tnum">
            {chip.calls} LLM calls · <span className="text-rec">{usd(chip.cost)}</span>
            {chip.saving > 0.0005 && <> · {Math.round((chip.saving / chip.cost) * 100)}% could be saved</>}
          </span>
        </span>
        <svg viewBox="0 0 12 12" className="size-3 shrink-0 self-center text-ink-3 transition-[transform,color] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M2.5 6h7M6.5 3l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </motion.div>
  );
}

/** A file: a page with the braces of JSON on it. Drawn, not a glyph. */
function FileMark() {
  return (
    <svg viewBox="0 0 24 28" className="h-7 w-6 shrink-0 text-ink-2 transition-colors group-hover:text-ink" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M5 1.75h9.5L20.25 7.5V24a2.25 2.25 0 0 1-2.25 2.25H5A2.25 2.25 0 0 1 2.75 24V4A2.25 2.25 0 0 1 5 1.75Z" strokeLinejoin="round" />
      <path d="M14.5 1.75V7.5h5.75" strokeLinejoin="round" opacity="0.6" />
      <path d="M10 13.5c-1.1 0-1.5.5-1.5 1.4v.9c0 .6-.35 1-1 1 .65 0 1 .4 1 1v.9c0 .9.4 1.4 1.5 1.4M14 13.5c1.1 0 1.5.5 1.5 1.4v.9c0 .6.35 1 1 1-.65 0-1 .4-1 1v.9c0 .9-.4 1.4-1.5 1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The galaxy as a still SVG: a sample of the same dots, projected the same way as the WebGL field
 * at its first frame, so the hand-off is seamless. It is also the hero with no WebGL, with reduced
 * motion, and with no JavaScript.
 */
function Fallback({ run, hidden }: { run: FieldRun; hidden: boolean }) {
  const { gal, count } = buildStatic(run);
  const dots: { x: number; y: number; o: number }[] = [];
  const step = Math.max(1, Math.floor(count / 1300));
  for (let k = 0; k < count; k += step) {
    const p = projectGalaxy(gal[k * 4], gal[k * 4 + 1], gal[k * 4 + 2], 0);
    const t = gal[k * 4 + 3];
    dots.push({ x: p.x, y: p.y, o: Math.min(0.9, 0.18 + 0.55 * t * t + (gal[k * 4] < 0.12 ? 0.35 : 0)) });
  }
  // The box spans 1.6 radii each way, the reach of the halo. Its place and size follow galaxyFrame:
  // the radius is the smaller of rW x width and rH x height. One SVG, placed by breakpoint.
  const d = GALAXY.desk;
  const m = GALAXY.phone;
  const vars = {
    ["--dl" as string]: `${d.cx * 100}%`,
    ["--dt" as string]: `${d.cy * 100}%`,
    ["--dw" as string]: `min(${d.rW * 320}vw, ${d.rH * 320}svh)`,
    ["--ml" as string]: `${m.cx * 100}%`,
    ["--mt" as string]: `${m.cy * 100}%`,
    ["--mw" as string]: `min(${m.rW * 320}vw, ${m.rH * 320}svh)`,
  };
  return (
    <div className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden transition-opacity duration-700 ease-out ${hidden ? "opacity-0" : ""}`} style={vars} aria-hidden>
      <svg
        viewBox="-1.6 -1.6 3.2 3.2"
        className="absolute left-[var(--ml)] top-[var(--mt)] aspect-square w-[var(--mw)] -translate-x-1/2 -translate-y-1/2 sm:left-[var(--dl)] sm:top-[var(--dt)] sm:w-[var(--dw)]"
      >
        {dots.map((p, i) => (
          <circle key={i} cx={p.x.toFixed(3)} cy={p.y.toFixed(3)} r="0.0038" fill="#ededef" fillOpacity={p.o.toFixed(2)} />
        ))}
      </svg>
    </div>
  );
}
