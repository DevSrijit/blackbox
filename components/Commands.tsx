"use client";

// The keyboard layer: a command menu (⌘K), a shortcuts sheet (?), and tooltips that name keys.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconCommand, IconSearch } from "./icons";
import { Key, Logo } from "./ui";

export type Command = {
  id: string;
  group: string;
  label: string;
  /** Extra words that match a search, for example a model's provider. */
  keywords?: string;
  /** The key or keys, as shown on key caps: ["⇧", "→"]. */
  keys?: string[];
  /** A short value on the right, for example a price. */
  meta?: string;
  /** Quiet text after the label, for example a model's provider. */
  hint?: string;
  /** Shown only when the search matches it, never in the default list. */
  searchOnly?: boolean;
  icon?: React.ReactNode;
  run: () => void;
};

function Dialog({ open, onClose, label, children, top = "14vh", className = "w-[min(600px,calc(100vw-24px))] rounded-2xl" }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode; top?: string; className?: string }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
          <div className="absolute inset-0 bg-black/60" onPointerDown={onClose} aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={reduce ? false : { opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            style={{ top, transformOrigin: "top center" }}
            className={`absolute left-1/2 -translate-x-1/2 overflow-hidden bg-[#111114] shadow-[0_32px_80px_-16px_rgba(0,0,0,0.85),inset_0_0_0_1px_var(--hair-2)] ${className}`}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A forgiving match: every typed word must appear somewhere in the label, group or keywords. */
const matches = (c: Command, q: string) => {
  const hay = `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};

export function CommandMenu({ open, onClose, onShortcuts, commands }: { open: boolean; onClose: () => void; onShortcuts: () => void; commands: Command[] }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => commands.filter((c) => (q.trim() ? matches(c, q) : !c.searchOnly)).slice(0, 80), [commands, q]);
  const groups = useMemo(() => {
    const out: { group: string; items: { c: Command; i: number }[] }[] = [];
    shown.forEach((c, i) => {
      const g = out.find((x) => x.group === c.group);
      if (g) g.items.push({ c, i });
      else out.push({ group: c.group, items: [{ c, i }] });
    });
    return out;
  }, [shown]);

  const close = () => {
    setQ("");
    setActive(0);
    onClose();
  };
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Dialog open={open} onClose={close} label="Command menu" top="16vh" className="flex h-[min(476px,calc(100dvh-20vh))] w-[min(760px,calc(100vw-24px))] flex-col rounded-xl">
      <label className="flex h-14 shrink-0 items-center gap-3 border-b border-hair px-4">
        <IconSearch size={17} className="shrink-0 text-ink-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(shown.length - 1, a + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              run(shown[active]);
            }
            // "?" in an empty search opens the shortcut sheet. Inside a search, it is just a character.
            if (e.key === "?" && !q) {
              e.preventDefault();
              setQ("");
              setActive(0);
              onShortcuts();
            }
          }}
          placeholder="Search commands, models and steps…"
          aria-label="Search commands"
          className="h-full flex-1 bg-transparent text-[16px] text-ink placeholder:text-ink-3"
        />
        <Key>esc</Key>
      </label>
      <div ref={list} role="listbox" aria-label="Commands" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {shown.length === 0 && <p className="px-3 py-10 text-center text-[13px] text-ink-3">No command matches “{q}”.</p>}
        {groups.map((g) => (
          <div key={g.group}>
            <div className="px-2.5 pb-1.5 pt-3 text-[12px] font-medium text-ink-3">{g.group}</div>
            {g.items.map(({ c, i }) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === active}
                data-i={i}
                onPointerMove={() => setActive(i)}
                onClick={() => run(c)}
                className={`flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[13.5px] ${i === active ? "bg-white/[0.07] text-ink" : "text-ink-2"}`}
              >
                <span className={`grid size-5 shrink-0 place-items-center [&_svg]:size-4 ${i === active ? "text-ink" : "text-ink-3"}`}>{c.icon}</span>
                <span className="min-w-0 truncate text-ink">{c.label}</span>
                {c.hint && <span className="min-w-0 truncate text-ink-3">{c.hint}</span>}
                <span className="ml-auto flex shrink-0 items-center gap-3">
                  {c.meta && <span className="font-mono text-[12px] text-ink-3 tnum">{c.meta}</span>}
                  {c.keys && (
                    <span className="flex gap-1">
                      {c.keys.map((k) => (
                        <Key key={k}>{k}</Key>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {/* The action bar: what Enter does to the selected row, and the way to every shortcut. */}
      <div className="flex h-11 shrink-0 items-center gap-3 border-t border-hair bg-white/[0.015] pl-4 pr-2 text-[12px] text-ink-3">
        <span className="flex items-center gap-2 text-ink-2">
          <Logo />
          <span className="hidden sm:inline">Blackbox</span>
        </span>
        <button
          type="button"
          onClick={() => run(shown[active])}
          disabled={!shown[active]}
          className="ml-auto flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-ink transition-colors duration-150 hover:bg-white/[0.06] disabled:text-ink-3 disabled:hover:bg-transparent"
        >
          {shown[active]?.group === "Go to a step" ? "Go to step" : shown[active]?.group === "Price this run on" ? "Price the run" : "Run command"}
          <Key>↵</Key>
        </button>
        <span className="h-4 w-px bg-hair-2 pointer-coarse:hidden" aria-hidden />
        <button
          type="button"
          onClick={() => {
            setQ("");
            setActive(0);
            onShortcuts();
          }}
          className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 transition-colors duration-150 hover:bg-white/[0.06] hover:text-ink pointer-coarse:hidden"
        >
          All shortcuts
          <Key>?</Key>
        </button>
      </div>
    </Dialog>
  );
}

export function ShortcutsSheet({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const groups = useMemo(() => {
    const out = new Map<string, Command[]>();
    for (const c of commands) if (c.keys) out.set(c.group, [...(out.get(c.group) ?? []), c]);
    return [...out];
  }, [commands]);
  return (
    <Dialog open={open} onClose={onClose} label="Keyboard shortcuts" top="10vh">
      <div className="flex items-center gap-2.5 border-b border-hair px-5 py-3.5">
        <IconCommand className="text-ink-3" />
        <h2 className="text-[14px] font-medium text-ink">Keyboard shortcuts</h2>
        <span className="ml-auto">
          <Key>esc</Key>
        </span>
      </div>
      <div className="grid max-h-[70vh] gap-x-8 gap-y-5 overflow-y-auto px-5 py-4 sm:grid-cols-2">
        {groups.map(([g, items]) => (
          <section key={g}>
            <h3 className="mb-1.5 text-[11.5px] text-ink-3">{g}</h3>
            <ul>
              {items.map((c) => (
                <li key={c.id} className="flex h-8 items-center justify-between gap-4 border-b border-hair text-[13px] text-ink-2 last:border-0">
                  <span className="truncate">{c.label}</span>
                  <span className="flex shrink-0 gap-1">
                    {c.keys!.map((k) => (
                      <Key key={k}>{k}</Key>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** When the last tooltip closed. A new one within 600 ms opens at once, with no delay. */
let lastTipClose = 0;

/** A tooltip: a short delay the first time, instant after that. It names the key, when there is one. */
export function Tip({ label, keys, children, side = "bottom" }: { label: string; keys?: string[]; children: React.ReactElement; side?: "top" | "bottom" }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    const warm = performance.now() - lastTipClose < 600;
    timer.current = setTimeout(() => setOpen(true), warm ? 0 : 450);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    if (open) lastTipClose = performance.now();
    setOpen(false);
  };
  return (
    <span className="relative inline-flex" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide} onPointerDown={hide}>
      {children}
      {open && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-lg bg-[#1a1a1f] py-1 pl-2.5 pr-1.5 text-[12px] text-ink shadow-[0_8px_24px_-6px_rgba(0,0,0,0.7),inset_0_0_0_1px_var(--hair-2)] ${side === "bottom" ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]"} ${keys ? "" : "pr-2.5"}`}
        >
          {label}
          {keys && (
            <span className="flex gap-0.5">
              {keys.map((k) => (
                <Key key={k}>{k}</Key>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
