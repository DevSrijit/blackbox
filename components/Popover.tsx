"use client";

// Our own popover, select and model combobox. No native dropdowns: they look different on every
// platform and cannot show prices or keys. The popover is fixed-positioned from its trigger, so a
// scrolling panel never clips it. It opens from the trigger edge and closes faster than it opens.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevron, IconSearch, IconUndo } from "./icons";
import { Key } from "./ui";

type Place = { left: number; top: number; width: number; up: boolean; maxH: number };

function usePopover() {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 260 && above > below;
    setPlace({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: r.width, up, maxH: Math.min(360, (up ? above : below) - 8) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    // Close when anything around it scrolls or the window resizes: the anchor moved.
    const close = (e: Event) => {
      if (panel.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, measure]);

  const shut = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  return { open, setOpen, shut, place, trigger, panel };
}

function Panel({ open, place, panelRef, children, minWidth = 0, label }: { open: boolean; place: Place | null; panelRef: React.RefObject<HTMLDivElement | null>; children: React.ReactNode; minWidth?: number; label: string }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open && place && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label={label}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: place.up ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1, ease: "easeIn" } }}
          transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
          style={{
            position: "fixed",
            left: Math.min(place.left, innerWidth - Math.max(place.width, minWidth) - 8),
            top: place.up ? undefined : place.top,
            bottom: place.up ? innerHeight - place.top : undefined,
            width: Math.max(place.width, minWidth),
            transformOrigin: place.up ? "bottom left" : "top left",
          }}
          className="z-50 overflow-hidden rounded-xl bg-[#131317] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8),0_2px_6px_rgba(0,0,0,0.4),inset_0_0_0_1px_var(--hair-2)]"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const triggerCls =
  "group flex h-8 w-full items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 text-left text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--hair)] outline-offset-2 transition-[background-color,box-shadow] duration-150 hover:bg-white/[0.06] aria-expanded:bg-white/[0.07] aria-expanded:shadow-[inset_0_0_0_1px_var(--hair-2)]";

/** A small select. Arrow keys move, Enter picks, Escape closes. */
export function Select<T extends string | number>({ value, options, onChange, label, width }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; width?: number }) {
  const { open, setOpen, shut, place, trigger, panel } = usePopover();
  const [active, setActive] = useState(0);
  const current = options.find((o) => o.value === value);
  const pick = (v: T) => {
    onChange(v);
    shut();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        style={width ? { width } : undefined}
        onClick={() => {
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setActive(Math.max(0, options.findIndex((o) => o.value === value)));
            setOpen(true);
            return;
          }
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(options.length - 1, a + 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            pick(options[active].value);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            shut();
          }
        }}
        className={triggerCls}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label}</span>
        <IconChevron size={13} className={`shrink-0 text-ink-3 transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`} />
      </button>
      <Panel open={open} place={place} panelRef={panel} label={label} minWidth={140}>
        <ul role="listbox" aria-label={label} className="p-1">
          {options.map((o, i) => (
            <li key={String(o.value)}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] ${i === active ? "bg-white/[0.07] text-ink" : "text-ink-2"}`}
              >
                <span className="flex-1">{o.label}</span>
                {o.value === value && <IconCheck size={13} className="text-ink" />}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

export type ModelOption = { id: string; name: string; cost: number | null };

/**
 * The model for one step. Search every OpenRouter model, see this step's cost on each, or type
 * any model id. A typed id that has no price stays selectable and says so.
 */
export function ModelPicker({ value, recorded, options, onChange }: { value: string; recorded: string; options: ModelOption[]; onChange: (id: string) => void }) {
  const { open, setOpen, shut, place, trigger, panel } = usePopover();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Focus the search as soon as the panel mounts, so typing never reaches the page shortcuts.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  const query = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const hit = query ? options.filter((o) => `${o.id} ${o.name}`.toLowerCase().includes(query)) : options;
    const out = hit.slice(0, 60);
    // Any OpenRouter id is allowed, even one Blackbox has no price for.
    if (query && /^[\w.-]+\/[\w.:-]+$/.test(query) && !options.some((o) => o.id === query)) out.push({ id: query, name: "Use this model id", cost: null });
    return out;
  }, [options, query]);
  const current = options.find((o) => o.id === value);

  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (id: string) => {
    onChange(id);
    setQ("");
    shut();
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Model for this step"
        onClick={() => {
          setActive(0);
          setOpen(!open);
        }}
        className={triggerCls}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{value.split("/").pop()}</span>
        {value === recorded ? <span className="shrink-0 text-[11px] text-ink-3">recorded</span> : <span className="shrink-0 text-[11px] text-ink-3">{value.split("/")[0]}</span>}
        <IconChevron size={13} className={`shrink-0 text-ink-3 transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`} />
      </button>
      {/* Back to the recorded model in one click. It shows only when the step uses another model. */}
      <AnimatePresence initial={false}>
        {recorded && value !== recorded && (
          <motion.button
            type="button"
            onClick={() => onChange(recorded)}
            aria-label={`Use the recorded model, ${recorded.split("/").pop()}`}
            title={`Use the recorded model, ${recorded.split("/").pop()}`}
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 32 }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="grid h-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.04] text-ink-2 shadow-[inset_0_0_0_1px_var(--hair)] transition-colors duration-150 hover:bg-white/[0.07] hover:text-ink active:scale-[0.96]"
          >
            <IconUndo size={14} />
          </motion.button>
        )}
      </AnimatePresence>
      </div>
      <Panel open={open} place={place} panelRef={panel} label="Choose a model" minWidth={360}>
        <label className="flex items-center gap-2 border-b border-hair px-3">
          <IconSearch size={14} className="shrink-0 text-ink-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(rows.length - 1, a + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              }
              if (e.key === "Enter" && rows[active]) {
                e.preventDefault();
                pick(rows[active].id);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                if (q) setQ("");
                else shut();
              }
            }}
            placeholder="Search models, or type provider/model"
            aria-label="Search models"
            className="h-10 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          <Key>esc</Key>
        </label>
        <div ref={list} role="listbox" aria-label="Models" className="overflow-y-auto overscroll-contain p-1" style={{ maxHeight: (place?.maxH ?? 320) - 44 }}>
          {rows.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-ink-3">No model matches “{q}”. Type a full id, like provider/model.</p>}
          {rows.map((o, i) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              data-i={i}
              onPointerMove={() => setActive(i)}
              onClick={() => pick(o.id)}
              className={`flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left ${i === active ? "bg-white/[0.07]" : ""}`}
            >
              <span className="grid size-3.5 shrink-0 place-items-center">{o.id === value && <IconCheck size={13} className="text-ink" />}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{o.id.split("/").pop()}</span>
              <span className="shrink-0 text-[11px] text-ink-3">{o.id === recorded ? (value === recorded ? "recorded" : "recorded · reset") : o.cost === null ? o.name : o.id.split("/")[0]}</span>
              <span className={`w-16 shrink-0 text-right font-mono text-[11.5px] tnum ${o.cost === null ? "text-ink-3" : "text-ink-2"}`}>{o.cost === null ? "no price" : fmt(o.cost)}</span>
            </button>
          ))}
        </div>
      </Panel>
      {current === undefined && value !== recorded && <p className="mt-1.5 text-[12px] text-ink-3">Blackbox has no price for this model id, so this step shows the recorded cost.</p>}
    </>
  );
}

const fmt = (v: number) => (v === 0 ? "$0.00" : v < 0.01 ? `$${v.toFixed(4)}` : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);
