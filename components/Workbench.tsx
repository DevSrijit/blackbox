"use client";

// The replay of one run. An app shell: the header, then on wide screens two columns that
// scroll on their own. The tape stays pinned (opaque, never translucent) while the steps scroll.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allOn, costCurve, priceMap, spanCost, tokens, totals, traceCost, usd, type Assignment, unpricedCalls } from "@/lib/cost";
import { combinedSaving, findings as findWaste } from "@/lib/findings";
import type { FeaturedList } from "@/lib/featured";
import type { Model, Span, Trace } from "@/lib/types";
import { CommandMenu, ShortcutsSheet, Tip, type Command } from "./Commands";
import {
  IconArrowRight,
  IconClose,
  IconCommand,
  IconCompare,
  IconCopy,
  IconCost,
  IconKeyboard,
  IconLLM,
  IconOpen,
  IconPause,
  IconPlay,
  IconReplay,
  IconSearch,
  IconStep,
  IconTime,
  IconWaste,
  IconFaster,
  IconUndo,
  IconSlower,
} from "./icons";
import { useOpener } from "./Opener";
import { Panel, StepDetails, type Tab } from "./Panel";
import { Steps, Tape, type Row, type Shared, type Sort } from "./Recorder";
import { RunMenu, type RunItem } from "./RunMenu";
import { clock, Key, KindMark, kindName, Logo, Seg, shortModel } from "./ui";

const SPEEDS = ["1", "5", "10", "25"] as const;
const NO_COMMANDS: Command[] = [];
type Speed = (typeof SPEEDS)[number];

export function Workbench({ trace, models, runs, current, pricesAt, pricesLive, featured }: { trace: Trace; models: Model[]; runs: RunItem[]; current: string; pricesAt: string; pricesLive: boolean; featured: FeaturedList }) {
  const { openFile } = useOpener();
  const reduce = useReducedMotion();
  const prices = useMemo(() => priceMap(models), [models]);

  const [applied, setApplied] = useState<string | null>(null);
  const [stepModels, setStepModels] = useState<Assignment>({});
  const assign = useMemo<Assignment>(() => ({ ...(applied ? allOn(trace, applied) : {}), ...stepModels }), [applied, stepModels, trace]);
  // A step counts as changed only when its cost changes. A model id with no price keeps the
  // recorded price, so it changes nothing and must not make the run read as re-priced.
  const changed = Object.keys(assign).some((id) => {
    const span = trace.spans.find((s) => s.id === id);
    return !!span && assign[id] !== span.model && Math.abs(spanCost(span, prices, assign) - spanCost(span, prices)) > 1e-12;
  });

  const tot = useMemo(() => totals(trace), [trace]);
  const duration = Math.max(1, tot.duration);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>("10");
  const [scale, setScale] = useState(1);
  const [tab, setTab] = useState<Tab>("whatif");
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [hoverSpan, setHoverSpan] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("time");

  const rows = useMemo(() => order(trace.spans), [trace]);
  const costs = useMemo(() => new Map(trace.spans.map((s) => [s.id, spanCost(s, prices, assign)])), [trace, prices, assign]);
  const curve = useMemo(() => costCurve(trace, prices), [trace, prices]);
  const whatIf = useMemo(() => (changed ? costCurve(trace, prices, assign) : null), [changed, trace, prices, assign]);
  const waste = useMemo(() => findWaste(trace, prices), [trace, prices]);
  const recorded = useMemo(() => traceCost(trace, prices), [trace, prices]);
  const unpriced = useMemo(() => unpricedCalls(trace, prices).length, [trace, prices]);
  const noPrice = useMemo(() => new Set(unpricedCalls(trace, prices, assign).map((s) => s.id)), [trace, prices, assign]);
  const saving = combinedSaving(waste, recorded);
  const done = t >= duration;
  const calls = useMemo(() => trace.spans.filter((s) => s.kind === "llm").sort((a, b) => a.end - b.end), [trace]);
  const pricedOn = applied && !Object.keys(stepModels).length ? shortModel(applied) : null;

  // With reduced motion, open on the finished run instead of replaying it.
  useEffect(() => {
    if (!reduce) return;
    const id = requestAnimationFrame(() => {
      setT(duration);
      setPlaying(false);
    });
    return () => cancelAnimationFrame(id);
  }, [reduce, duration]);

  // The replay clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      setT((v) => {
        const next = v + dt * Number(speed);
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration]);

  const togglePlay = useCallback(() => {
    if (done) {
      setT(0);
      setPlaying(true);
    } else setPlaying((p) => !p);
  }, [done]);

  const seek = useCallback((v: number) => {
    setT(v);
    setPlaying(false);
  }, []);

  // On a narrow screen the side panel sits far below the steps, so a picked step opens in a sheet.
  const [sheet, setSheet] = useState(false);
  const select = useCallback((id: string) => {
    setSelected(id);
    setTab("step");
    if (window.matchMedia("(max-width: 1023px)").matches) setSheet(true);
  }, [setSheet]);

  const [menu, setMenu] = useState<"commands" | "keys" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const flash = useCallback((msg: string) => {
    setNote(msg);
    setTimeout(() => setNote((n) => (n === msg ? null : n)), 1800);
  }, []);

  const stepCall = useCallback(
    (dir: 1 | -1) => {
      const next = dir > 0 ? calls.find((s) => s.end > t + 1) : [...calls].reverse().find((s) => s.end < t - 1);
      if (!next) return;
      seek(next.end);
      setSelected(next.id);
      document.querySelector(`[data-row="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" });
    },
    [calls, t, seek],
  );
  const stepRow = useCallback(
    (dir: 1 | -1) => {
      const list = sort === "cost" ? rows.filter((r) => r.span.kind !== "agent").sort((a, b) => (costs.get(b.span.id) ?? 0) - (costs.get(a.span.id) ?? 0)) : rows;
      const i = list.findIndex((r) => r.span.id === selected);
      const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + dir))];
      if (!next) return;
      select(next.span.id);
      document.querySelector(`[data-row="${CSS.escape(next.span.id)}"]`)?.scrollIntoView({ block: "nearest" });
    },
    [rows, sort, costs, selected, select],
  );
  const changeSpeed = useCallback((dir: 1 | -1) => {
    setSpeed((s) => SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + dir))]);
  }, []);
  const clearWhatIf = useCallback(() => {
    setApplied(null);
    setStepModels({});
  }, []);
  const copyStep = useCallback(() => {
    const span = trace.spans.find((s) => s.id === selected);
    if (!span) return flash("Select a step first");
    navigator.clipboard?.writeText(JSON.stringify(span, null, 2)).then(
      () => flash(`Copied ${span.name} as JSON`),
      () => flash("The browser blocked the clipboard"),
    );
  }, [trace, selected, flash]);
  const focusSearch = useCallback(() => {
    setTab("whatif");
    requestAnimationFrame(() => document.getElementById("model-search")?.focus());
  }, []);

  const runIndex = runs.findIndex((r) => r.key === current);
  const goRun = useCallback((dir: 1 | -1) => {
    const next = runs[(runIndex + dir + runs.length) % runs.length];
    if (next && next.key !== current) window.location.assign(next.href);
  }, [runs, runIndex, current]);

  /** Every action, once: the keymap, the command menu and the shortcuts sheet all read this list. */
  // The cost of this run on each model, once per trace. The command menu reads it.
  const modelCosts = useMemo(() => new Map(models.filter((m) => !m.id.includes(":")).map((m) => [m.id, traceCost(trace, prices, allOn(trace, m.id))])), [models, trace, prices]);

  const buildCommands = (): Command[] => {
    const replay = "Replay";
    const view = "View";
    const out: Command[] = [
      { id: "play", group: replay, label: playing ? "Pause" : done ? "Replay from the start" : "Play", keys: ["Space"], icon: playing ? <IconPause size={14} /> : <IconPlay size={14} />, run: togglePlay },
      { id: "restart", group: replay, label: "Restart the replay", keys: ["R"], icon: <IconReplay size={14} />, run: () => { setT(0); setPlaying(true); } },
      { id: "next-call", group: replay, label: "Next LLM call", keys: ["→"], icon: <IconLLM size={14} />, run: () => stepCall(1) },
      { id: "prev-call", group: replay, label: "Previous LLM call", keys: ["←"], icon: <IconLLM size={14} />, run: () => stepCall(-1) },
      { id: "fwd", group: replay, label: "Forward 5 seconds", keys: ["⇧", "→"], icon: <IconTime size={14} />, run: () => seek(Math.min(duration, t + 5000)) },
      { id: "back", group: replay, label: "Back 5 seconds", keys: ["⇧", "←"], icon: <IconTime size={14} />, run: () => seek(Math.max(0, t - 5000)) },
      { id: "start", group: replay, label: "Go to the start", keys: ["Home"], icon: <IconTime size={14} />, run: () => seek(0) },
      { id: "end", group: replay, label: "Go to the end", keys: ["End"], icon: <IconTime size={14} />, run: () => seek(duration) },
      { id: "faster", group: replay, label: "Faster", keys: ["]"], icon: <IconFaster size={14} />, meta: `${speed}×`, run: () => changeSpeed(1) },
      { id: "slower", group: replay, label: "Slower", keys: ["["], icon: <IconSlower size={14} />, meta: `${speed}×`, run: () => changeSpeed(-1) },
      { id: "next-step", group: "Steps", label: "Next step", keys: ["J"], icon: <IconStep size={14} />, run: () => stepRow(1) },
      { id: "prev-step", group: "Steps", label: "Previous step", keys: ["K"], icon: <IconStep size={14} />, run: () => stepRow(-1) },
      { id: "sort", group: "Steps", label: sort === "time" ? "Order steps by cost" : "Order steps by time", keys: ["O"], icon: sort === "time" ? <IconCost size={14} /> : <IconTime size={14} />, run: () => setSort((x) => (x === "time" ? "cost" : "time")) },
      { id: "copy", group: "Steps", label: "Copy the selected step as JSON", keys: ["C"], icon: <IconCopy size={14} />, run: copyStep },
      { id: "clear", group: "Steps", label: "Clear the selection", keys: ["Esc"], icon: <IconClose size={14} />, run: () => setSelected(null) },
      ...(selectedSpan?.kind === "llm" && selectedSpan.model && assign[selectedSpan.id] && assign[selectedSpan.id] !== selectedSpan.model
        ? [{ id: "reset-step", group: "Steps", label: "Use the recorded model for this step", hint: shortModel(selectedSpan.model), icon: <IconUndo size={14} />, run: () => setStepModel(selectedSpan.id, selectedSpan.model!) }]
        : []),
      { id: "tab-compare", group: view, label: "Compare models", keys: ["1"], icon: <IconCompare size={14} />, run: () => setTab("whatif") },
      { id: "tab-waste", group: view, label: "Waste", keys: ["2"], icon: <IconWaste size={14} />, run: () => setTab("findings") },
      { id: "tab-step", group: view, label: "Step details", keys: ["3"], icon: <IconStep size={14} />, run: () => setTab("step") },
      { id: "search", group: view, label: "Search models", keys: ["/"], icon: <IconSearch size={14} />, run: focusSearch },
      { id: "recorded", group: view, label: "Show the recorded models", keys: ["X"], icon: <IconClose size={14} />, run: clearWhatIf },
      { id: "commands", group: "App", label: "Open the command menu", keys: ["⌘", "K"], icon: <IconCommand size={14} />, run: () => { setPlaying(false); setMenu("commands"); } },
      { id: "shortcuts", group: "App", label: "Keyboard shortcuts", keys: ["?"], icon: <IconKeyboard size={14} />, run: () => setMenu("keys") },
      { id: "open", group: "App", label: "Open a trace", keys: ["⌘", "O"], icon: <IconOpen size={14} />, run: openFile },
      { id: "next-run", group: "App", label: "Next run", keys: ["N"], icon: <IconArrowRight size={14} />, run: () => goRun(1) },
      { id: "prev-run", group: "App", label: "Previous run", keys: ["⇧", "N"], icon: <IconArrowRight size={14} className="rotate-180" />, run: () => goRun(-1) },
    ];
    for (const r of runs) if (r.key !== current) out.push({ id: `run:${r.key}`, group: "Runs", label: `Open ${r.title}`, hint: "Demo", keywords: r.description, icon: <KindMark kind="agent" />, run: () => window.location.assign(r.href) });
    // The curated models show first, cheapest first. Every other model appears only for a search.
    const shown = new Set(featured.models.map((f) => f.id));
    const priceable = models
      .filter((m) => !m.id.includes(":"))
      .sort((a, b) => Number(shown.has(b.id)) - Number(shown.has(a.id)) || (modelCosts.get(a.id) ?? 0) - (modelCosts.get(b.id) ?? 0));
    for (const m of priceable) {
      out.push({ id: `price:${m.id}`, searchOnly: !shown.has(m.id), group: "Price this run on", label: shortModel(m.id), hint: m.id.split("/")[0], keywords: `${m.id} ${m.name} model price`, meta: usd(modelCosts.get(m.id) ?? 0), icon: <IconLLM size={14} />, run: () => { setApplied(m.id); setStepModels({}); setTab("whatif"); seek(duration); } });
    }
    for (const r of rows) out.push({ id: `step:${r.span.id}`, group: "Go to a step", label: r.span.name, hint: r.span.kind === "llm" ? shortModel(r.span.model ?? "") : kindName[r.span.kind], keywords: `${r.span.kind} ${r.span.model ?? ""}`, meta: r.span.kind === "llm" ? usd(costs.get(r.span.id) ?? 0) : undefined, icon: <KindMark kind={r.span.kind} error={r.span.status === "error"} />, run: () => { seek(r.span.end); select(r.span.id); document.querySelector(`[data-row="${CSS.escape(r.span.id)}"]`)?.scrollIntoView({ block: "center" }); } });
    return out;
  };
  // Built only while a menu is open. The replay pauses then, so the list does not rebuild every frame.

  // One keymap. Single keys only work outside text fields. Space plays and pauses unless a
  // keyboard user has focused a button, so a mouse click never leaves Space pressing that button.
  const pointer = useRef(false);
  useEffect(() => {
    const down = () => (pointer.current = true);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Tab") pointer.current = false;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (menu === "commands") setMenu(null);
        else {
          setPlaying(false);
          setMenu("commands");
        }
        return;
      }
      const target = e.target instanceof Element ? e.target : document.body;
      if (menu || e.metaKey || e.ctrlKey || e.altKey || target.closest("input, select, textarea, [contenteditable], [role=menu], [role=dialog]")) return;
      if (e.code === "Space") {
        if (target.closest("button, a") && !pointer.current) return;
        e.preventDefault();
        togglePlay();
        return;
      }
      if (target.closest("[role=listbox]") && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;
      const k = e.key;
      const map: Record<string, () => void> = {
        ArrowRight: () => (e.shiftKey ? seek(Math.min(duration, t + 5000)) : stepCall(1)),
        ArrowLeft: () => (e.shiftKey ? seek(Math.max(0, t - 5000)) : stepCall(-1)),
        Home: () => seek(0),
        End: () => seek(duration),
        r: () => { setT(0); setPlaying(true); },
        j: () => stepRow(1),
        k: () => stepRow(-1),
        o: () => setSort((x) => (x === "time" ? "cost" : "time")),
        c: copyStep,
        x: clearWhatIf,
        "]": () => changeSpeed(1),
        "[": () => changeSpeed(-1),
        "1": () => setTab("whatif"),
        "2": () => setTab("findings"),
        "3": () => setTab("step"),
        "/": focusSearch,
        "?": () => setMenu("keys"),
        n: () => goRun(1),
        N: () => goRun(-1),
        // Esc only clears the selection. Clearing a model comparison is X, so a stray Esc never loses work.
        Escape: () => setSelected(null),
      };
      const run = map[k] ?? map[k.toLowerCase()];
      if (k === "N" && e.shiftKey) {
        e.preventDefault();
        return map.N();
      }
      if (!run || (target.closest("[role=slider]") && (k === "Home" || k === "End"))) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [menu, togglePlay, seek, duration, t, stepCall, stepRow, copyStep, clearWhatIf, changeSpeed, focusSearch, goRun, selected]);

  const shared: Shared = { rows, costs, noPrice, duration, t, selected, highlight, hoverSpan, setHoverSpan, hoverTime, setHoverTime, onSelect: select, onSeek: seek };
  const selectedSpan = trace.spans.find((s) => s.id === selected) ?? null;

  // Stable callbacks for the side panel. The panel is memoized, so a replay frame does not re-render it.
  const applyModel = useCallback(
    (id: string | null) => {
      setApplied(id);
      setStepModels({});
      if (!done) seek(duration);
    },
    [done, seek, duration],
  );
  // A step set back to its recorded model drops its override, unless a run-wide model is on.
  // Then the override stays, so this one step keeps its recorded price.
  const setStepModel = useCallback(
    (id: string, m: string | null) =>
      setStepModels((s) => {
        const next = { ...s };
        const recorded = trace.spans.find((x) => x.id === id)?.model;
        if (m && !(m === recorded && !applied)) next[id] = m;
        else delete next[id];
        return next;
      }),
    [trace, applied],
  );
  const hoverFinding = useCallback((ids: string[]) => setHighlight(new Set(ids)), []);
  const selectFromPanel = useCallback(
    (id: string) => {
      setSelected(id);
      document.querySelector(`[data-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    },
    [reduce],
  );
  const panelProps = {
    featured,
    tab,
    setTab,
    trace,
    prices,
    models,
    assign,
    applied,
    apply: applyModel,
    setStepModel,
    scale,
    setScale,
    findings: waste,
    onHoverFinding: hoverFinding,
    selected: selectedSpan,
    onSelect: selectFromPanel,
  };
  const commands = menu ? buildCommands() : NO_COMMANDS;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-hair bg-bg px-3 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md py-1 pl-1 pr-1.5" aria-label="Blackbox home">
          <Logo recording={playing} />
          <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Blackbox</span>
        </Link>
        <span className="h-4 w-px shrink-0 bg-hair-2" aria-hidden />
        <div className="min-w-0 flex-1">
          <RunMenu runs={runs} current={current} onOpenFile={openFile} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setMenu("commands");
            }}
            aria-label="Open the command menu"
            aria-keyshortcuts="Meta+K"
            className="flex h-8 items-center gap-2 rounded-lg px-2 text-[12.5px] text-ink-3 shadow-[inset_0_0_0_1px_var(--hair)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-white/[0.04] hover:text-ink-2 active:scale-[0.97] md:w-[220px] md:pl-2.5 md:pr-1.5"
          >
            <IconSearch size={14} />
            <span className="hidden truncate whitespace-nowrap md:inline">Search commands</span>
            <span className="ml-auto hidden gap-0.5 md:flex" aria-hidden>
              <Key>⌘</Key>
              <Key>K</Key>
            </span>
          </button>
          {/* Secondary, then primary: the shortcut sheet sits beside search, and "Open a trace" holds the right edge. */}
          <Tip label="Keyboard shortcuts" keys={["?"]}>
            <button
              type="button"
              onClick={() => setMenu("keys")}
              aria-label="Keyboard shortcuts"
              className="hidden size-8 place-items-center rounded-lg text-ink-3 shadow-[inset_0_0_0_1px_var(--hair)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-white/[0.04] hover:text-ink-2 active:scale-[0.97] sm:grid"
            >
              <IconKeyboard size={15} />
            </button>
          </Tip>
          <button
            type="button"
            onClick={openFile}
            aria-label="Open a trace"
            aria-keyshortcuts="Meta+O"
            className="flex h-8 items-center gap-2 rounded-lg bg-white/[0.05] px-2 text-[12.5px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--hair-2)] transition-[background-color,transform] duration-150 ease-out hover:bg-white/[0.08] active:scale-[0.97] sm:pl-2.5 sm:pr-1.5"
          >
            <IconOpen size={15} className="text-ink-2" />
            <span className="hidden sm:inline">Open a trace</span>
            <span className="hidden gap-0.5 md:flex" aria-hidden>
              <Key>⌘</Key>
              <Key>O</Key>
            </span>
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_392px]">
        <main className="min-w-0 overflow-x-clip overscroll-none lg:overflow-y-auto">
          {/* The run, in one line of plain facts. */}
          <section className="border-b border-hair px-4 pb-5 pt-6 sm:px-6">
            <h1 className="text-balance text-[21px] font-semibold tracking-[-0.022em] text-ink" style={{ fontFamily: "var(--font-display)" }}>
              {trace.title}
            </h1>
            {trace.description && <p className="mt-1 max-w-[64ch] text-pretty text-[13.5px] leading-relaxed text-ink-2">{trace.description}</p>}
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-3 tnum">
              <Fact v={(duration / 1000).toFixed(1)}>s</Fact>
              <Fact v={tot.llmCalls} sep>LLM calls</Fact>
              <Fact v={tot.toolCalls} sep>tool calls</Fact>
              <Fact v={tokens(tot.prompt)} sep>input tokens</Fact>
              <Fact v={`${Math.round(tot.cacheHit * 100)}%`} warn={tot.cacheHit < 0.2 && tot.llmCalls > 3} sep>
                cached input
              </Fact>
              {tot.errors > 0 && (
                <Fact v={tot.errors} warn sep>
                  failed {tot.errors === 1 ? "step" : "steps"}
                </Fact>
              )}
              {unpriced > 0 && (
                <Fact v={unpriced === tot.llmCalls ? "No" : `${unpriced} of ${tot.llmCalls}`} warn sep>
                  {unpriced === tot.llmCalls ? "LLM call has a price" : "LLM calls have no price"}
                </Fact>
              )}
              {saving > 0 && (
                <span className="whitespace-nowrap">
                  <button type="button" onClick={() => setTab("findings")} className="rounded text-ink-2 underline decoration-white/20 underline-offset-[3px] transition-colors hover:text-ink hover:decoration-white/50">
                    you can save about <span className="text-rec">{usd(saving)}</span>
                  </button>
                </span>
              )}
            </p>
          </section>

          {/* Transport and tape: pinned and opaque while the steps scroll under them. */}
          <div className="z-20 bg-bg lg:sticky lg:top-0">
            <div className="flex h-12 items-center gap-3 border-b border-hair px-3 sm:px-4">
              <div className="flex shrink-0 items-center gap-1">
                <Tip label="Previous LLM call" keys={["←"]}>
                  <button type="button" onClick={() => stepCall(-1)} aria-label="Previous LLM call" className="grid size-8 place-items-center rounded-full text-ink-3 transition-[color,background-color,transform] pointer-coarse:size-10 duration-150 hover:bg-white/[0.06] hover:text-ink active:scale-[0.94]">
                    <IconArrowRight size={14} className="rotate-180" />
                  </button>
                </Tip>
                <Tip label={playing ? "Pause" : done ? "Replay from the start" : "Play"} keys={["Space"]}>
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={playing ? "Pause" : done ? "Replay from the start" : "Play"}
                    className="relative grid size-8 place-items-center rounded-full bg-ink text-bg pointer-coarse:size-11 transition-[transform,background-color] duration-150 ease-out hover:bg-white active:scale-[0.94]"
                  >
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span
                        key={playing ? "pause" : done ? "again" : "play"}
                        initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                        transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                        className="grid place-items-center"
                      >
                        {playing ? <IconPause size={14} /> : done ? <IconReplay size={15} /> : <IconPlay size={14} className="translate-x-px" />}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                </Tip>
                <Tip label="Next LLM call" keys={["→"]}>
                  <button type="button" onClick={() => stepCall(1)} aria-label="Next LLM call" className="grid size-8 place-items-center rounded-full text-ink-3 transition-[color,background-color,transform] pointer-coarse:size-10 duration-150 hover:bg-white/[0.06] hover:text-ink active:scale-[0.94]">
                    <IconArrowRight size={14} />
                  </button>
                </Tip>
              </div>
              <span className="shrink-0 font-mono text-[12px] text-ink-2 tnum">
                {clock(t)} <span className="hidden text-ink-3 sm:inline">/ {clock(duration)}</span>
              </span>
              {/* The end of the run: what it cost and where the biggest waste is. */}
              <AnimatePresence initial={false}>
                {done && !changed && waste[0] && (
                  <motion.button
                    type="button"
                    initial={{ opacity: 0, x: -4, filter: "blur(2px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
                    onClick={() => {
                      setTab("findings");
                      setHighlight(new Set(waste[0].spans));
                      setTimeout(() => setHighlight(new Set()), 2200);
                    }}
                    className="group hidden min-w-0 items-center gap-2 rounded-full py-1 pl-2.5 pr-2 text-[12px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hair)] transition-colors hover:bg-white/[0.04] hover:text-ink xl:flex"
                  >
                    <IconWaste size={13} className="shrink-0 text-rec" />
                    <span className="truncate">Biggest waste: {waste[0].title}</span>
                    <span className="shrink-0 font-mono text-rec tnum">−{usd(waste[0].saving)}</span>
                    <IconArrowRight size={12} className="shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink" />
                  </motion.button>
                )}
              </AnimatePresence>
              {/* The what-if state, visible where the replay is. */}
              <AnimatePresence initial={false}>
                {changed && (
                  <motion.span
                    initial={{ opacity: 0, x: -4, filter: "blur(2px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                    className="hidden min-w-0 items-center gap-1 rounded-full bg-white/[0.07] py-0.5 pl-2.5 pr-0.5 text-[12px] text-ink md:flex"
                  >
                    <span className="truncate">{pricedOn
                        ? `Priced on ${pricedOn}`
                        : applied
                          ? `Priced on ${shortModel(applied)}, ${Object.keys(stepModels).length} ${Object.keys(stepModels).length === 1 ? "step" : "steps"} changed`
                          : "Re-priced steps"}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setApplied(null);
                        setStepModels({});
                      }}
                      aria-label="Show the recorded models again"
                      className="grid size-5 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-white/[0.1] hover:text-ink"
                    >
                      <IconClose size={11} />
                    </button>
                  </motion.span>
                )}
              </AnimatePresence>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <span className="hidden text-[12px] text-ink-3 sm:inline">Speed</span>
                <Seg value={speed} onChange={setSpeed} size="sm" label="Replay speed" options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} />
              </div>
            </div>
            <Tape s={shared} curve={curve} whatIf={whatIf} changed={changed} recorded={recorded} unpriced={unpriced} playing={playing} pricedOn={pricedOn} sort={sort} setSort={setSort} />
            <div className="h-px bg-hair" />
          </div>

          <Steps s={shared} assign={assign} sort={sort} applied={applied} />

          <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hair px-4 py-4 text-[12px] text-ink-3 sm:px-6">
            <span className="flex items-center gap-1.5 pointer-coarse:hidden">
              <Key>Space</Key> play or pause
            </span>
            <span className="flex items-center gap-1.5 pointer-coarse:hidden">
              <Key>←</Key>
              <Key>→</Key> next or previous LLM call
            </span>
            <span className="flex items-center gap-1.5 pointer-coarse:hidden">
              <Key>J</Key>
              <Key>K</Key> next or previous step
            </span>
            <span className="ml-auto">OpenRouter list prices{pricesLive ? ", refreshed every hour" : `, snapshot from ${pricesAt}`}</span>
          </footer>
        </main>

        <aside className="min-h-0 min-w-0 overflow-x-clip overscroll-none border-t border-hair bg-surface lg:overflow-y-auto lg:border-l lg:border-t-0" aria-label="Analysis">
          <Panel {...panelProps} />
        </aside>
      </div>
      {/* Narrow screens: the picked step in a bottom sheet, right where the tap happened. */}
      <AnimatePresence>
        {sheet && selectedSpan && (
          <>
            <motion.div
              key="scrim"
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setSheet(false)}
              aria-hidden
            />
            <motion.div
              key="sheet"
              role="dialog"
              aria-label="Step details"
              className="fixed inset-x-0 bottom-0 z-40 max-h-[78dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.85),inset_0_1px_0_var(--hair-2)] lg:hidden"
              initial={reduce ? { opacity: 0 } : { y: "100%" }}
              animate={reduce ? { opacity: 1 } : { y: 0 }}
              exit={reduce ? { opacity: 0 } : { y: "100%" }}
              transition={{ type: "spring", duration: 0.38, bounce: 0 }}
            >
              <div className="sticky top-0 z-10 flex items-center bg-surface px-4 pb-1 pt-2">
                <span className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-white/15" aria-hidden />
                <button type="button" onClick={() => setSheet(false)} aria-label="Close step details" className="ml-auto mt-1 grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink">
                  <IconClose size={15} />
                </button>
              </div>
              <StepDetails {...panelProps} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <CommandMenu open={menu === "commands"} onClose={() => setMenu(null)} onShortcuts={() => setMenu("keys")} commands={commands} />
      <ShortcutsSheet open={menu === "keys"} onClose={() => setMenu(null)} commands={commands.filter((c) => !c.id.includes(":"))} />
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center">
        <AnimatePresence>
          {note && (
            <motion.div
              key={note}
              initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 2, transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="flex items-center gap-2 rounded-full bg-raised px-3.5 py-1.5 text-[12.5px] text-ink shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7),inset_0_0_0_1px_var(--hair-2)]"
            >
              {note}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div aria-live="polite" className="sr-only">
        {done ? `Replay finished. The run cost ${usd(recorded)}.` : ""}
      </div>
    </div>
  );
}

/** One fact in the run summary: the value in full ink, then its unit in muted ink. */
/**
 * One fact in the summary line. Facts are set apart by space, not dots, so a wrapped line never
 * starts or ends with a stray dot. A fact worth a second look is set in medium weight with a dotted
 * underline, not in orange: orange means money.
 */
function Fact({ v, children, warn }: { v?: string | number; children: React.ReactNode; warn?: boolean; sep?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      {v !== undefined && <span className={warn ? "font-medium text-ink underline decoration-white/25 decoration-dotted underline-offset-[3px]" : "text-ink"}>{v}</span>} {children}
    </span>
  );
}


/** Spans in tree order: each parent, then its children by start time. */
function order(spans: Span[]): Row[] {
  const ids = new Set(spans.map((s) => s.id));
  const kids = new Map<string | null, Span[]>();
  for (const s of spans) {
    const p = s.parentId && ids.has(s.parentId) ? s.parentId : null;
    const arr = kids.get(p) ?? [];
    arr.push(s);
    kids.set(p, arr);
  }
  const out: Row[] = [];
  const seen = new Set<string>();
  const walk = (p: string | null, depth: number) => {
    for (const s of (kids.get(p) ?? []).sort((a, b) => a.start - b.start || (a.kind === "agent" ? -1 : 1))) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ span: s, depth: Math.min(depth, 6) });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
