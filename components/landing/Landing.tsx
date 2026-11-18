"use client";

// The landing page. The hero takes a trace or a demo. Below it, one token field runs through the
// scroll scenes: one WebGL canvas, pinned behind the content, driven by scroll and the pointer.

import { AnimatePresence, motion, useMotionValue, useMotionValueEvent, useScroll } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useOpener } from "../Opener";
import { Field, makeField } from "./field/Field";
import type { FieldRun } from "./field/layout";
import { Hero, SINK_MS, wait, type DemoChip } from "./Hero";
import { Replay, type Failure } from "./Replay";
import { Leaks, Models, Outro, Overlay, Price, Waiting, type Showcase } from "./Scenes";

export type { DemoChip, Failure, FieldRun, Showcase };

const GITHUB = "https://github.com/DevSrijit/blackbox";

// The field runs only with WebGL2 and with motion allowed. Otherwise every scene is a still frame.
const REDUCE = "(prefers-reduced-motion: reduce)";
let webgl: boolean | null = null;
function canRun() {
  if (window.matchMedia(REDUCE).matches) return false;
  if (webgl === null) {
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return webgl;
}
function onMotionChange(cb: () => void) {
  const m = window.matchMedia(REDUCE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

export function Landing({
  run,
  chips,
  failure,
  total,
  tokenCount,
  showcase,
}: {
  run: FieldRun;
  chips: DemoChip[];
  failure: Failure | null;
  total: number;
  tokenCount: number;
  showcase: Showcase;
}) {
  const router = useRouter();
  const { load, registerDropTarget } = useOpener();
  const [{ ctrl, api }] = useState(makeField);

  const capable = useSyncExternalStore(onMotionChange, canRun, () => false);
  const [failed, setFailed] = useState(false);
  const live = capable && !failed;
  const [ready, setReady] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const labelX = useMotionValue(0);
  const labelY = useMotionValue(0);

  // Scrolling the hero away moves the field from the hero columns into the replay scene.
  const hero = useRef<HTMLDivElement>(null);
  const { scrollYProgress: heroOut } = useScroll({ target: hero, offset: ["start start", "end start"] });
  useMotionValueEvent(heroOut, "change", (p) => {
    api.scene(p);
  });

  const launch = (href: string, x: number, y: number) => {
    if (!live) {
      router.push(href);
      return;
    }
    setLaunching(true);
    api.pullOff();
    api.sink(x, y);
    router.prefetch(href);
    setTimeout(() => router.push(href), SINK_MS);
  };

  // A file dragged over the page pulls the field toward the pointer. A drop sinks it there.
  // Opening a demo leaves this page in its launch state: copy faded, dots sunk into one point.
  // Next.js keeps the page mounted in the background, so the state resets when the page is put
  // away, and the visitor finds the landing whole when they come back.
  useEffect(
    () => () => {
      setLaunching(false);
      setFileOver(false);
      api.sinkOff();
      api.pullOff();
      api.mouseOff();
    },
    [api],
  );

  useEffect(() => {
    if (!live) return;
    return registerDropTarget({
      enter: () => setFileOver(true),
      over: (x, y) => {
        api.pull(x, y);
        labelX.set(x);
        labelY.set(y);
      },
      leave: () => {
        api.pullOff();
        setFileOver(false);
      },
      drop: async (file, x, y) => {
        api.pullOff();
        setFileOver(false);
        api.sink(x, y);
        setLaunching(true);
        const ok = await load(file, () => wait(SINK_MS));
        if (!ok) {
          api.sinkOff();
          setLaunching(false);
        }
      },
    });
  }, [live, load, registerDropTarget, labelX, labelY, api]);

  return (
    <div className="min-h-dvh">
      {/* The pointer pushes the dots wherever the field allows it: the hero and the ring. */}
      <div
        className="relative"
        onPointerMove={(e) => {
          if (e.pointerType === "mouse" && live) api.mouse(e.clientX, e.clientY);
        }}
        onPointerLeave={api.mouseOff}
      >
        {live && (
          // The layer spans the whole stage, so the pinned canvas lets go exactly where the last scene ends.
          <div className="pointer-events-none absolute inset-0">
            <div className="sticky top-0 h-svh">
              <Field run={run} prices={showcase.prices} marks={showcase.marks} ctrl={ctrl} onReady={(ok) => (ok ? setReady(true) : setFailed(true))} />
              <Overlay run={run} data={showcase} failure={failure} field={api} />
            </div>
          </div>
        )}
        <div ref={hero}>
          <Hero run={run} chips={chips} live={live} fieldReady={live && ready} field={api} launching={launching} onLaunch={launch} tokenCount={tokenCount} total={total} />
        </div>
        <Replay run={run} failure={failure} total={total} live={live} field={api} />
        <Waiting run={run} data={showcase} total={total} field={api} live={live} />
        <Price run={run} data={showcase} total={total} field={api} live={live} />
        <Models run={run} data={showcase} total={total} field={api} live={live} />
        <Leaks run={run} data={showcase} total={total} field={api} live={live} />
        <Outro live={live} field={api} chips={chips} />
      </div>

      <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
        <p className="max-w-[64ch] pb-10 pt-16 text-pretty text-[13px] leading-relaxed text-ink-3">
          Blackbox reads OpenTelemetry JSON (GenAI or OpenInference attributes), JSON lines of OpenAI or OpenRouter calls, and its own format, up to 50 MB. It reads the file in your browser and stores nothing. It prices runs on {showcase.modelCount} OpenRouter models, and re-pricing always keeps the recorded tokens.
        </p>
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

      {/* The drop label rides with the pointer while a file is over the page. */}
      <AnimatePresence>
        {fileOver && (
          <motion.div
            className="pointer-events-none fixed left-0 top-0 z-50"
            style={{ x: labelX, y: labelY }}
            initial={{ opacity: 0, scale: 0.9, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="ml-5 mt-5 w-max rounded-xl bg-raised/85 px-3.5 py-2.5 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9),inset_0_0_0_1px_var(--hair-2)] backdrop-blur-md">
              <div className="text-[14px] font-medium text-ink">Release to replay</div>
              <div className="mt-0.5 text-[12px] text-ink-3">The file stays in your browser.</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
