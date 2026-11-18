"use client";

import { AnimatePresence, motion } from "motion/react";
import { memo, useMemo, useState } from "react";
import { allOn, costParts, unpricedCalls, findModel, perMillion, spanCost, tokens, traceCost, usageCost, usd, type Assignment, type Prices } from "@/lib/cost";
import { combinedSaving, type Finding } from "@/lib/findings";
import type { FeaturedList } from "@/lib/featured";
import type { Model, Span, Trace } from "@/lib/types";
import { IconArrowRight, IconChevron, MarkFailed } from "./icons";
import { ModelPicker, Select } from "./Popover";
import { clock, KindMark, kindName, Num, Seg, shortModel } from "./ui";

export type Tab = "whatif" | "findings" | "step";

export const Panel = memo(function Panel(props: {
  /** The models the Compare list shows first, ranked by OpenRouter usage when the data exists. */
  featured: FeaturedList;
  tab: Tab;
  setTab: (t: Tab) => void;
  trace: Trace;
  prices: Prices;
  models: Model[];
  assign: Assignment;
  applied: string | null;
  apply: (id: string | null) => void;
  setStepModel: (spanId: string, model: string | null) => void;
  scale: number;
  setScale: (k: number) => void;
  findings: Finding[];
  onHoverFinding: (ids: string[]) => void;
  selected: Span | null;
  onSelect: (id: string) => void;
}) {
  const { tab, setTab, findings } = props;
  const tabs: [Tab, string, string | null][] = [
    ["whatif", "Compare models", null],
    ["findings", "Waste", findings.length ? String(findings.length) : null],
    ["step", "Step", null],
  ];
  return (
    <div>
      {/* Tabs: pinned at the top of the panel, opaque. The line under the active tab slides. */}
      <div role="tablist" aria-label="Analysis" className="sticky top-0 z-10 flex gap-5 border-b border-hair bg-surface px-4">
        {tabs.map(([k, label, count]) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`panel-${k}`}
            // One tab stop for the whole tab list. The arrow keys, Home and End move between tabs.
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            onKeyDown={(e) => {
              const keys = tabs.map(([key]) => key);
              const i = keys.indexOf(k);
              const next = e.key === "ArrowRight" ? keys[(i + 1) % keys.length] : e.key === "ArrowLeft" ? keys[(i - 1 + keys.length) % keys.length] : e.key === "Home" ? keys[0] : e.key === "End" ? keys[keys.length - 1] : null;
              if (!next) return;
              e.preventDefault();
              e.stopPropagation();
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
            className={`relative flex h-11 items-center gap-1.5 text-[13px] transition-colors duration-150 ${tab === k ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
          >
            {label}
            {count && <span className={`rounded-full px-1.5 text-[11px] leading-[18px] tnum ${tab === k ? "bg-rec/15 text-rec" : "bg-white/[0.06] text-ink-3"}`}>{count}</span>}
            {tab === k && <motion.span layoutId="tab-line" className="absolute inset-x-0 -bottom-px h-px bg-ink" transition={{ type: "spring", duration: 0.3, bounce: 0 }} />}
          </button>
        ))}
      </div>
      {/* No fade on the first paint: the server HTML shows the panel at once. Later tab changes fade in. */}
      <AnimatePresence initial={false} mode="wait">
      <motion.div key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12, ease: "easeOut" }}>
        {tab === "whatif" && <WhatIf {...props} />}
        {tab === "findings" && <Findings {...props} />}
        {tab === "step" && <Step {...props} />}
      </motion.div>
      </AnimatePresence>
    </div>
  );
});

const SCALES = [1, 1000, 100000];
const scaleName = (k: number) => (k === 1 ? "run" : k === 1000 ? "1K runs" : "100K runs");

type SortKey = "cost" | "used" | "new";

/** "4.1T" style token counts for the usage note. */
const big = (n: number) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : `${Math.round(n / 1e3)}K`);

function WhatIf({ trace, prices, models, applied, apply, scale, setScale, featured }: Parameters<typeof Panel>[0]) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("cost");
  const usage = useMemo(() => new Map(featured.models.map((f) => [f.id, f.tokens])), [featured]);
  const hasUsage = featured.models.some((f) => f.tokens !== null);
  // "New" is measured from the newest model on the price list, not the clock, so server and browser agree.
  const newest = useMemo(() => Math.max(0, ...models.map((m) => m.created)), [models]);
  const isNew = (m: Model) => m.created > newest - 21 * 86_400;
  // While the pointer is over the list, only the hovered row shows its prices. A row that keeps
  // keyboard focus after a click must not show them at the same time.
  const [pointerIn, setPointerIn] = useState(false);
  const recorded = traceCost(trace, prices);
  const recordedIds = useMemo(() => [...new Set(trace.spans.filter((s) => s.kind === "llm").map((s) => s.model ?? ""))], [trace]);
  const recordedModels = recordedIds.map((id) => shortModel(id));
  const llmCount = trace.spans.filter((s) => s.kind === "llm").length;
  const unpriced = unpricedCalls(trace, prices).length;
  // With no price at all there is nothing to compare against, so the rows show no percentages.
  const noBase = recorded === 0;
  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    const pool = query
      ? models.filter((m) => !m.id.includes(":") && (m.id + " " + m.name).toLowerCase().includes(query)).slice(0, 40)
      : // A run on one featured model already shows as the recorded row, so the list leaves it out.
        (featured.models.filter((f) => !(recordedIds.length === 1 && recordedIds[0] === f.id)).map((f) => prices.get(f.id)).filter(Boolean) as Model[]);
    const priced = pool.map((m) => ({ m, cost: traceCost(trace, prices, allOn(trace, m.id)) }));
    const by: Record<SortKey, (a: (typeof priced)[number], b: (typeof priced)[number]) => number> = {
      cost: (a, b) => a.cost - b.cost,
      used: (a, b) => (usage.get(b.m.id) ?? -1) - (usage.get(a.m.id) ?? -1) || a.cost - b.cost,
      new: (a, b) => b.m.created - a.m.created,
    };
    return priced.sort(by[sort === "used" && !hasUsage ? "cost" : sort]);
  }, [q, models, prices, trace, recordedIds, featured, sort, usage, hasUsage]);
  // The recorded run is the reference, so it stays on top. The models follow in the chosen order.
  const ladder: ({ kind: "model"; m: Model; cost: number } | { kind: "recorded"; cost: number })[] = [{ kind: "recorded", cost: recorded }, ...rows.map((r) => ({ kind: "model" as const, ...r }))];
  // Every bar is measured against the recorded run: the recorded bar is full, and a model's bar
  // is its share of that cost. A model that costs more fills the bar, and its "+%" says by how much.
  // The scale never changes with the search or the sort.
  const share = (c: number) => (noBase ? 0 : Math.min(1, c / recorded));

  return (
    <div className="p-4">
      <p className="text-pretty text-[13px] leading-relaxed text-ink-2">See what this run costs if every LLM call uses one model. Blackbox keeps the token counts the same. It does not check answer quality.</p>
      {unpriced > 0 && (
        <p className="mt-3 rounded-lg px-3 py-2.5 text-pretty text-[12.5px] leading-relaxed text-ink-2 shadow-[inset_0_0_0_1px_var(--hair-2)]">
          <span className="font-medium text-ink">{unpriced === llmCount ? "No LLM call in this run has a price." : `${unpriced} of ${llmCount} LLM calls have no price.`}</span> Blackbox does not know {unpriced === 1 ? "its model" : "their models"}, so the recorded cost leaves {unpriced === 1 ? "it" : "them"} out. Pick a model below, or set one for a step in the Step tab.
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search models</span>
          <svg viewBox="0 0 16 16" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <circle cx="7" cy="7" r="4.25" />
            <path d="m10.2 10.2 3.3 3.3" strokeLinecap="round" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            id="model-search"
            placeholder={`Search ${models.length} models`}
            className="w-full rounded-lg bg-white/[0.04] py-[7px] pl-8 pr-3 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--hair)] outline-none transition-shadow duration-150 placeholder:text-ink-3 focus:shadow-[inset_0_0_0_1px_var(--ink-3)]"
          />
        </label>
        <div className="w-[118px] shrink-0">
          <Select label="Show cost for" value={scale} onChange={setScale} options={SCALES.map((k) => ({ value: k, label: `per ${scaleName(k)}` }))} />
        </div>
      </div>

      {/* How the list is ordered. Where the list comes from shows on hover. */}
      <div
        className="mt-4 flex"
        title={featured.source === "rankings" ? "Featured: the most used models on OpenRouter in the last 4 weeks" : featured.asOf ? `Featured: the most used models on OpenRouter, as of ${featured.asOf.slice(0, 10)}` : "Featured: picked by hand"}
      >
        <Seg
          size="sm"
          label="Order models by"
          value={sort === "used" && !hasUsage ? "cost" : sort}
          onChange={setSort}
          options={[{ value: "cost" as const, label: "Cheapest" }, ...(hasUsage ? [{ value: "used" as const, label: "Most used" }] : []), { value: "new" as const, label: "Newest" }]}
        />
      </div>
      <ul className="relative -mx-1 mt-2 flex flex-col gap-1" onPointerEnter={() => setPointerIn(true)} onPointerLeave={() => setPointerIn(false)}>
        {rows.length === 0 && q.trim() && <li className="order-last px-3 py-6 text-center text-[13px] text-ink-3">No model matches “{q}”.</li>}
        {ladder.map((row) => {
          if (row.kind === "recorded")
            return (
              <li key="recorded" className="rounded-lg bg-rec/[0.07] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,95,31,0.22)]">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-[13px] text-ink">{recordedIds.length === 1 ? "Recorded model" : "Recorded models"}</span>
                  <span className="sr-only">This bar is full. Each model bar shows its share of this cost.</span>
                  <span className="min-w-0 truncate text-[11.5px] text-ink-3">{recordedModels.join(", ")}</span>
                  <span className={`ml-auto shrink-0 font-mono text-[12.5px] tnum ${noBase ? "text-ink-3" : "text-rec"}`}>{noBase ? "no price" : usd(row.cost * scale)}</span>
                </div>
                {/* The same track width as the model rows, so a full model bar ends where this one ends. */}
                <div className="mt-1.5 flex h-4 items-center gap-3">
                  <Bar value={noBase ? 0 : 1} tone="rec" />
                  <span className="w-11 shrink-0" aria-hidden />
                </div>
              </li>
            );
          const { m, cost } = row;
          const on = applied === m.id;
          // With unpriced calls, the recorded cost leaves them out, so a percentage would compare different calls.
          const delta = noBase || unpriced > 0 ? null : cost / recorded - 1;
          return (
            <li key={m.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => apply(on ? null : m.id)}
                className={`group w-full rounded-lg px-3 py-2.5 text-left outline-offset-[-2px] transition-[background-color] duration-150 ease-out active:scale-[0.99] ${on ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-[13px] text-ink">{shortModel(m.id)}</span>
                  <span className="shrink-0 text-[11.5px] text-ink-3">{m.id.split("/")[0]}</span>
                  {isNew(m) && <span className="shrink-0 rounded-[4px] px-1 text-[11px] font-medium leading-[16px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hair-2)]">New</span>}
                  {sort === "used" && usage.get(m.id) != null && <span className="shrink-0 font-mono text-[11px] text-ink-3 tnum">{big(usage.get(m.id)!)} tokens</span>}
                  <span className="ml-auto shrink-0 font-mono text-[12.5px] text-ink tnum">{usd(cost * scale)}</span>
                </div>
                {/* One fixed-height line: the cost bar, or on hover the prices behind it. No layout shift. */}
                <div className="relative mt-1.5 h-4">
                  <div className={`absolute inset-0 flex items-center gap-3 transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-1 group-hover:opacity-0 ${pointerIn ? "" : "group-focus-visible:-translate-y-1 group-focus-visible:opacity-0"}`}>
                    <Bar value={share(cost)} tone={on ? "ink" : "dim"} />
                    <span className={`w-11 shrink-0 text-right font-mono text-[11px] tnum ${delta !== null && delta > 0.005 ? "text-rec" : "text-ink-3"}`}>
                      {delta === null ? "—" : Math.abs(delta) < 0.005 ? "same" : `${delta < 0 ? "−" : "+"}${Math.round(Math.abs(delta) * 100)}%`}
                    </span>
                  </div>
                  <div className={`absolute inset-0 flex translate-y-1 items-center gap-3 font-mono text-[11px] text-ink-3 opacity-0 transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] tnum group-hover:translate-y-0 group-hover:opacity-100 ${pointerIn ? "" : "group-focus-visible:translate-y-0 group-focus-visible:opacity-100"}`}>
                    <span>
                      in <span className="text-ink-2">{perMillion(m.prompt)}</span>
                    </span>
                    <span>
                      out <span className="text-ink-2">{perMillion(m.completion)}</span>
                    </span>
                    <span>{m.cacheRead != null ? <>cached <span className="text-ink-2">{perMillion(m.cacheRead)}</span></> : "no cache price"}</span>
                    <span className="ml-auto font-sans">per 1M tokens</span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {applied && (
        <button type="button" onClick={() => apply(null)} className="mt-3 w-full rounded-lg py-2 text-[12.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hair)] transition-[background-color,color] duration-150 hover:bg-white/[0.04] hover:text-ink">
          Show the recorded models again
        </button>
      )}
      <p className="mt-4 text-pretty text-[12px] leading-relaxed text-ink-3">OpenRouter list prices. Cached tokens bill at the cache price when the model has one. Tokenizers differ between model families, so real token counts can change.</p>
    </div>
  );
}

/** A cost bar. `value` is this cost as a share of the recorded run, from 0 to 1. */
function Bar({ value, tone }: { value: number; tone: "rec" | "ink" | "dim" }) {
  return (
    <div className="relative flex h-2.5 flex-1 items-center">
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.05]">
        <motion.div
          className={`h-full rounded-full ${tone === "rec" ? "bg-rec" : tone === "ink" ? "bg-ink" : "bg-white/35"}`}
          initial={false}
          animate={{ width: `${Math.max(0.6, value * 100)}%` }}
          transition={{ type: "spring", duration: 0.45, bounce: 0 }}
        />
      </div>
    </div>
  );
}

function Findings({ findings, trace, prices, scale, onHoverFinding, onSelect }: Parameters<typeof Panel>[0]) {
  const [hot, setHot] = useState<string | null>(null);
  const total = traceCost(trace, prices);
  const saving = combinedSaving(findings, total);
  if (!findings.length)
    return (
      <div className="p-5">
        <p className="text-[13px] leading-relaxed text-ink">No waste found in this run.</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">Prompt caching is on, no step failed, no tool call repeats, and no short answer comes from a premium model.</p>
      </div>
    );
  // Each fix takes its part of the cost that is left after the fixes before it, so the parts add up to the combined saving.
  const parts = findings.reduce<{ f: Finding; part: number; rest: number }[]>((acc, f) => {
    const before = acc.length ? acc[acc.length - 1].rest : total;
    const part = total > 0 ? before * Math.min(0.95, f.saving / total) : 0;
    return [...acc, { f, part, rest: before - part }];
  }, []);
  const left = parts.length ? parts[parts.length - 1].rest : total;
  const enter = (f: Finding) => {
    setHot(f.id);
    onHoverFinding(f.spans);
  };
  const leave = () => {
    setHot(null);
    onHoverFinding([]);
  };

  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[12px] text-ink-3">Fixable {scale === 1 ? "in this run" : `over ${scale === 1000 ? "1K" : "100K"} runs`}</div>
          <Num value={saving * scale} format={usd} className="mt-0.5 block text-[24px] font-semibold tracking-[-0.02em] text-rec" />
        </div>
        <div className="text-right text-[12px] text-ink-3">
          {total > 0 ? (
            <>
              <span className="text-ink">{Math.round((saving / total) * 100)}%</span> of {usd(total * scale)}
            </>
          ) : (
            "no priced cost to measure"
          )}
        </div>
      </div>

      {/* The waste map: the run's cost as one bar, split into what each fix saves and what is left. */}
      <div className="mt-3 flex h-2.5 gap-px overflow-hidden rounded-[3px]" onMouseLeave={leave}>
        {parts.map(({ f, part }) => (
          <button
            key={f.id}
            type="button"
            tabIndex={-1}
            aria-label={f.title}
            onMouseEnter={() => enter(f)}
            onClick={() => onSelect(f.spans[0])}
            className="h-full transition-opacity duration-150"
            style={{ width: `${total > 0 ? (part / total) * 100 : 0}%`, background: "var(--rec)", opacity: hot && hot !== f.id ? 0.3 : 1 - parts.findIndex((p) => p.f.id === f.id) * 0.13 }}
          />
        ))}
        <span className="h-full flex-1 bg-white/[0.12]" title="Cost with every fix applied" />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-3">
        <span>waste</span>
        <span>left after every fix · {usd(left * scale)}</span>
      </div>

      <ul className="mt-5 flex flex-col gap-1 border-t border-hair pt-2">
        {parts.map(({ f }, i) => (
          <li
            key={f.id}
            onMouseEnter={() => enter(f)}
            onMouseLeave={leave}
            className={`-mx-2 rounded-lg px-2 py-3.5 transition-colors duration-150 ease-out ${hot === f.id ? "bg-white/[0.035]" : ""}`}
          >
            <div className="flex items-start gap-3">
              <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-rec" style={{ opacity: 1 - i * 0.13 }} aria-hidden />
              <h3 className="text-pretty text-[13px] font-medium leading-snug text-ink [overflow-wrap:anywhere]">{f.title}</h3>
              <span className="ml-auto shrink-0 font-mono text-[12.5px] text-rec tnum">−{usd(f.saving * scale)}</span>
            </div>
            <p className="mt-1.5 pl-[18px] text-pretty text-[12.5px] leading-relaxed text-ink-2">{f.detail}</p>
            <button
              type="button"
              onClick={() => onSelect(f.spans[0])}
              onFocus={() => enter(f)}
              onBlur={leave}
              className="group/link mt-2 ml-3 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] text-ink-2 transition-[color,background-color] duration-150 hover:bg-white/[0.05] hover:text-ink active:scale-[0.98]"
            >
              Show {f.spans.length} {f.spans.length === 1 ? "step" : "steps"} in the timeline
              <IconArrowRight size={12} className="text-ink-3 transition-transform duration-200 ease-out group-hover/link:translate-x-0.5 group-hover/link:text-ink" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-pretty text-[12px] leading-relaxed text-ink-3">Fixes overlap. The total applies each fix to the cost that is left after the others, so it is less than the sum of the list.</p>
    </div>
  );
}

/** The step details, also used on its own in the bottom sheet on narrow screens. */
export function StepDetails(props: Parameters<typeof Panel>[0]) {
  return <Step {...props} />;
}

function Step({ selected, prices, assign, setStepModel, scale, models, featured }: Parameters<typeof Panel>[0]) {
  if (!selected) return <p className="p-5 text-[13px] text-ink-2">Select a step in the timeline, or press ← or → to move between LLM calls.</p>;
  const s = selected;
  const modelId = assign[s.id] ?? s.model;
  const m = findModel(prices, modelId);
  const parts = s.usage && m ? costParts(s.usage, m) : null;
  const order = [...new Set([s.model ?? "", ...featured.models.map((f) => f.id), ...models.filter((x) => !x.id.includes(":")).map((x) => x.id)])].filter(Boolean);
  const stepOptions = order.map((id) => {
    const model = findModel(prices, id);
    return { id, name: model?.name ?? id, cost: model && s.usage ? usageCost(s.usage, model) : null };
  });
  return (
    <div className="min-w-0 space-y-5 p-4">
      <div>
        <div className="flex items-center gap-2 text-ink-2">
          <KindMark kind={s.kind} error={s.status === "error"} />
          <span className="text-[12px] text-ink-3">{kindName[s.kind]}</span>
          <span className="ml-auto font-mono text-[11px] text-ink-3">
            {clock(s.start)} → {clock(s.end)} · {((s.end - s.start) / 1000).toFixed(2)}s
          </span>
        </div>
        <h3 className="mt-2 text-[16px] font-medium text-ink [overflow-wrap:anywhere]">{s.name}</h3>
        {s.error && (
          <div className="mt-2 rounded-lg bg-white/[0.03] px-3 py-2 shadow-[inset_0_0_0_1px_var(--hair-2)]">
            <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
              <MarkFailed size={13} className="text-ink-2" />
              Error
            </div>
            <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{s.error}</p>
          </div>
        )}
      </div>

      {s.kind === "llm" && s.usage && (
        <div className="rounded-xl border border-hair bg-raised/60 p-3.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <ModelPicker
                value={modelId ?? ""}
                recorded={s.model ?? ""}
                options={stepOptions}
                onChange={(id) => setStepModel(s.id, id)}
              />
            </div>
            <Num value={spanCost(s, prices, assign) * scale} format={usd} className="shrink-0 font-mono text-[15px] text-rec" />
          </div>
          {parts && (
            <>
              <TokenBar usage={s.usage} />
              <dl className="mt-3 space-y-1.5 font-mono text-[11.5px]">
                <Line k="input" n={s.usage.input} v={parts.input * scale} />
                <Line k="cache read" n={s.usage.cacheRead} v={parts.cacheRead * scale} />
                <Line k="cache write" n={s.usage.cacheWrite} v={parts.cacheWrite * scale} />
                <Line k="output" n={s.usage.output} v={parts.output * scale} />
              </dl>
            </>
          )}
        </div>
      )}

      {s.tool && (
        <div className="space-y-3">
          <Code label="Arguments" value={s.tool.args} />
          {s.tool.result !== undefined && s.tool.result !== null && <Code label="Result" value={s.tool.result} />}
        </div>
      )}

      {s.output && (s.output.content || s.output.toolCalls?.length) && (
        <div>
          <div className="mb-1.5 text-[12px] text-ink-3">Output</div>
          {s.output.content && <p className="whitespace-pre-wrap text-pretty text-[13px] leading-relaxed text-ink [overflow-wrap:anywhere]">{s.output.content}</p>}
          {s.output.toolCalls?.map((c, i) => (
            <div key={i} className="mt-2 rounded-lg px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2 shadow-[inset_0_0_0_1px_var(--hair)] [overflow-wrap:anywhere]">
              <span className="text-ink">{c.name}</span>({truncate(JSON.stringify(c.args), 140)})
            </div>
          ))}
        </div>
      )}

      {s.input && s.input.length > 0 && (
        <details className="group">
          <summary className="-ml-1 inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 text-[12px] text-ink-3 transition-colors duration-150 hover:bg-white/[0.04] hover:text-ink-2 [&::-webkit-details-marker]:hidden">
            <IconChevron size={12} className="-rotate-90 transition-transform duration-200 ease-out group-open:rotate-0" />
            Prompt · {s.input.length === 1 ? "1 message" : `last ${s.input.length} messages`}
          </summary>
          <div className="mt-2 space-y-2">
            {s.input.map((msg, i) => (
              <div key={i} className="rounded-lg border border-hair px-3 py-2">
                <div className="font-mono text-[10.5px] text-ink-3">{msg.role}{msg.name ? ` · ${msg.name}` : ""}</div>
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{truncate(msg.content || (msg.toolCalls ? msg.toolCalls.map((c) => `${c.name}(…)`).join(", ") : ""), 420)}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function TokenBar({ usage }: { usage: NonNullable<Span["usage"]> }) {
  const total = usage.input + usage.cacheRead + usage.cacheWrite + usage.output || 1;
  const seg = [
    { n: usage.cacheRead, c: "bg-white/25" },
    { n: usage.cacheWrite, c: "bg-white/45" },
    { n: usage.input, c: "bg-white/80" },
    { n: usage.output, c: "bg-ink-3" },
  ];
  return (
    <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
      {seg.map((s, i) => s.n > 0 && <div key={i} className={s.c} style={{ width: `${(s.n / total) * 100}%` }} />)}
    </div>
  );
}

function Line({ k, n, v }: { k: string; n: number; v: number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{k}</dt>
      <dd className="flex gap-4 text-ink-2 tnum">
        <span className="w-14 text-right">{tokens(n)}</span>
        <span className="w-16 text-right text-ink">{usd(v)}</span>
      </dd>
    </div>
  );
}

function Code({ label, value }: { label: string; value: unknown }) {
  // JSON.stringify gives undefined for undefined, and throws on a cycle. Neither may reach the page.
  let text: string;
  try {
    text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "—");
  } catch {
    text = String(value);
  }
  return (
    <div>
      <div className="mb-1.5 text-[12px] text-ink-3">{label}</div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-mono text-[11.5px] leading-relaxed text-ink-2 shadow-[inset_0_0_0_1px_var(--hair)] [overflow-wrap:anywhere]">{truncate(text, 2400)}</pre>
    </div>
  );
}

const truncate = (s: string | undefined, n: number) => (!s ? "" : s.length > n ? `${s.slice(0, n - 1)}…` : s);
