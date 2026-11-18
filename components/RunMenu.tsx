"use client";

// The run switcher: one button with the current run, and a menu that opens from it.

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type RunItem = { key: string; title: string; description?: string; demo: boolean; href: string };

export function RunMenu({ runs, current, onOpenFile }: { runs: RunItem[]; current: string; onOpenFile: () => void }) {
  const router = useRouter();
  const traces = runs;
  const idx = Math.max(0, runs.findIndex((r) => r.key === current));
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const items = traces.length + 1;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const choose = (i: number) => {
    setOpen(false);
    if (i < traces.length) {
      if (i !== idx) router.push(traces[i].href);
    } else onOpenFile();
  };

  return (
    <div ref={root} className="relative flex min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setFocus(idx);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setFocus(idx);
            setOpen(true);
          }
        }}
        className="group flex min-w-0 max-w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150 hover:bg-white/[0.05] aria-expanded:bg-white/[0.06]"
      >
        <span className="min-w-0 truncate text-ink">{traces[idx].title}</span>
        <svg viewBox="0 0 12 12" className={`size-3 shrink-0 text-ink-3 transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: "top left" }}
            className="absolute left-0 top-[calc(100%+6px)] z-40 w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-xl border border-hair-2 bg-[#121215] p-1 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75),0_2px_6px_rgba(0,0,0,0.4)]"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setFocus((f) => (f + 1) % items);
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setFocus((f) => (f - 1 + items) % items);
              }
            }}
          >
            {traces.map((tr, i) => (
              <MenuItem key={tr.key} active={i === idx} focused={focus === i} onFocusMe={() => setFocus(i)} onChoose={() => choose(i)}>
                <span className="flex items-baseline gap-2">
                  <span className="text-[13px] text-ink">{tr.title}</span>
                  {tr.demo && <span className="text-[11px] text-ink-3">demo</span>}
                </span>
                {tr.description && <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3">{tr.description}</span>}
              </MenuItem>
            ))}
            <div className="mx-2 my-1 h-px bg-hair" />
            <MenuItem focused={focus === traces.length} onFocusMe={() => setFocus(traces.length)} onChoose={() => choose(traces.length)}>
              <span className="flex items-center gap-2 text-[13px] text-ink">
                Open a trace
                <kbd className="ml-auto font-sans text-[11px] text-ink-3">⌘O</kbd>
              </span>
              <span className="mt-0.5 text-[12px] leading-snug text-ink-3">OpenTelemetry, OpenAI or OpenRouter logs. The file stays in your browser.</span>
            </MenuItem>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({ children, active, focused, onFocusMe, onChoose }: { children: React.ReactNode; active?: boolean; focused: boolean; onFocusMe: () => void; onChoose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focused) ref.current?.focus();
  }, [focused]);
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      onPointerEnter={onFocusMe}
      onClick={onChoose}
      className="relative flex w-full flex-col rounded-lg py-2 pl-7 pr-3 text-left outline-none focus:bg-white/[0.06]"
    >
      {active && (
        <svg viewBox="0 0 12 12" className="absolute left-2 top-[11px] size-3 text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="m2.5 6.2 2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {children}
    </button>
  );
}
