"use client";

import { animate, useMotionValue, useMotionValueEvent } from "motion/react";
import { useEffect, useState } from "react";
import type { SpanKind } from "@/lib/types";
import { MarkAgent, MarkFailed, MarkLLM, MarkRetrieval, MarkTool } from "./icons";

/** A number that eases to each new value, so totals count instead of jumping. */
export function Num({ value, format, className, duration = 0.5 }: { value: number; format: (v: number) => string; className?: string; duration?: number }) {
  const mv = useMotionValue(value);
  const [shown, setShown] = useState(value);
  useMotionValueEvent(mv, "change", setShown);
  useEffect(() => {
    // Duration 0 means "track exactly": set the value now, with no frame of lag.
    if (duration === 0) {
      mv.jump(value);
      return;
    }
    const ctl = animate(mv, value, { duration, ease: [0.23, 1, 0.32, 1] });
    return () => ctl.stop();
  }, [value, mv, duration]);
  return <span className={`tnum ${className ?? ""}`}>{format(shown)}</span>;
}

export function Seg<T extends string>({ value, options, onChange, size = "md", label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: "sm" | "md"; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg bg-white/[0.03] p-0.5 shadow-[inset_0_0_0_1px_var(--hair)]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md font-medium tnum transition-[color,background-color] duration-150 active:scale-[0.96] ${size === "sm" ? "px-2 py-0.5 text-[11.5px] pointer-coarse:py-2" : "px-3 py-1 text-[12px] pointer-coarse:py-2"} ${value === o.value ? "bg-white/[0.1] text-ink" : "text-ink-3 hover:text-ink-2"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The mark for each span kind. Shapes, not colors, so orange stays free for money. */
export function KindMark({ kind, error, size = 16 }: { kind: SpanKind; error?: boolean; size?: number }) {
  const cls = "shrink-0";
  if (error) return <MarkFailed size={size} className={cls} />;
  if (kind === "llm") return <MarkLLM size={size} className={cls} />;
  if (kind === "tool") return <MarkTool size={size} className={cls} />;
  if (kind === "retrieval") return <MarkRetrieval size={size} className={cls} />;
  return <MarkAgent size={size} className={cls} />;
}

export const kindName: Record<SpanKind, string> = { llm: "LLM call", tool: "Tool call", agent: "Agent", retrieval: "Retrieval" };

export const clock = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

/** "anthropic/claude-sonnet-5.5" -> "claude-sonnet-5.5" */
export const shortModel = (id?: string) => (id ? id.split("/").pop()! : "unknown");

/**
 * A key cap, for keyboard hints. Hidden on touch screens, where there is no keyboard to press.
 * `light` is for a cap on a white button.
 */
export function Key({ children, className = "", light = false }: { children: React.ReactNode; className?: string; light?: boolean }) {
  const tone = light ? "bg-black/[0.08] text-bg/75 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]" : "bg-white/[0.06] text-ink-2 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06),inset_0_0_0_1px_var(--hair)]";
  return (
    <kbd className={`inline-grid h-[18px] min-w-[18px] place-items-center rounded-[5px] px-1 font-sans text-[11px] pointer-coarse:hidden ${tone} ${className}`}>
      {children}
    </kbd>
  );
}

/** The mark: a black box with a recording light. A solid light while a run replays, a ring when it is paused. */
export function Logo({ recording = false, size = 18 }: { recording?: boolean; size?: number }) {
  return (
    <span className="relative grid shrink-0 place-items-center rounded-[5px] bg-ink" style={{ width: size, height: size }} aria-hidden>
      <span className={`size-[5px] rounded-full ${recording ? "bg-rec" : "shadow-[inset_0_0_0_1.25px_var(--rec)]"}`} />
    </span>
  );
}
