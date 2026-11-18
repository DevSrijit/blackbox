// Cost math. Pure functions over a trace and a price list.

import type { Model, Span, Trace, Usage } from "./types";

export type Prices = Map<string, Model>;

/** The largest value, by loop. Safe for any number of values, unlike Math.max(...values). */
export function maxOf(values: Iterable<number>, floor = 0): number {
  let m = floor;
  for (const v of values) if (v > m) m = v;
  return m;
}

export function priceMap(models: Model[]): Prices {
  return new Map(models.map((m) => [m.id, m]));
}

/** Finds a model by id, with or without a provider prefix or a date suffix. */
export function findModel(prices: Prices, id: string | undefined): Model | undefined {
  if (!id) return undefined;
  const exact = prices.get(id);
  if (exact) return exact;
  const bare = id.toLowerCase().replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$/, "");
  for (const m of prices.values()) if (m.id === bare || m.id.endsWith(`/${bare}`)) return m;
  return undefined;
}

/**
 * Cost of one call's tokens at one model's prices.
 * A model without a cache price bills cached tokens at its normal input price.
 */
export function usageCost(u: Usage, m: Model): number {
  return u.input * m.prompt + u.cacheRead * (m.cacheRead ?? m.prompt) + u.cacheWrite * (m.cacheWrite ?? m.prompt) + u.output * m.completion;
}

export type CostParts = { input: number; cacheRead: number; cacheWrite: number; output: number; total: number };

export function costParts(u: Usage, m: Model): CostParts {
  const input = u.input * m.prompt;
  const cacheRead = u.cacheRead * (m.cacheRead ?? m.prompt);
  const cacheWrite = u.cacheWrite * (m.cacheWrite ?? m.prompt);
  const output = u.output * m.completion;
  return { input, cacheRead, cacheWrite, output, total: input + cacheRead + cacheWrite + output };
}

/** Model ids by span id. A missing entry means the span keeps its own model. */
export type Assignment = Record<string, string>;

export function modelFor(span: Span, assign: Assignment) {
  return assign[span.id] ?? span.model;
}

/** Cost of one LLM span under an assignment. The recorded cost wins when no model is known. */
export function spanCost(span: Span, prices: Prices, assign: Assignment = {}): number {
  if (span.kind !== "llm" || !span.usage) return 0;
  // A model with no known price falls back to the recorded model, never to $0.
  const m = findModel(prices, modelFor(span, assign)) ?? findModel(prices, span.model);
  if (m) return usageCost(span.usage, m);
  return span.recordedCost ?? 0;
}

/** True when Blackbox has a price for this LLM call: from its model, its recorded model, or a recorded cost. */
export function hasPrice(span: Span, prices: Prices, assign: Assignment = {}): boolean {
  if (span.kind !== "llm" || !span.usage) return true;
  return !!(findModel(prices, modelFor(span, assign)) ?? findModel(prices, span.model)) || span.recordedCost != null;
}

/** The LLM calls that Blackbox cannot price. Their cost counts as nothing, so the UI must say so. */
export function unpricedCalls(trace: Trace, prices: Prices, assign: Assignment = {}): Span[] {
  return trace.spans.filter((s) => s.kind === "llm" && !hasPrice(s, prices, assign));
}

export function traceCost(trace: Trace, prices: Prices, assign: Assignment = {}): number {
  let sum = 0;
  for (const s of trace.spans) sum += spanCost(s, prices, assign);
  return sum;
}

/** The same run with every LLM call moved to one model. Token counts stay the same. */
export function allOn(trace: Trace, modelId: string): Assignment {
  const out: Assignment = {};
  for (const s of trace.spans) if (s.kind === "llm") out[s.id] = modelId;
  return out;
}

/** Cumulative cost over time, as steps, for the cost line. Each call adds its cost at its end. */
export function costCurve(trace: Trace, prices: Prices, assign: Assignment = {}) {
  const pts = trace.spans
    .filter((s) => s.kind === "llm")
    .map((s) => ({ t: s.end, c: spanCost(s, prices, assign) }))
    .sort((a, b) => a.t - b.t);
  let acc = 0;
  return pts.map((p) => ({ t: p.t, c: (acc += p.c) }));
}

export function totals(trace: Trace) {
  const llm = trace.spans.filter((s) => s.kind === "llm");
  const u = llm.reduce(
    (a, s) => {
      const x = s.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      return { input: a.input + x.input, output: a.output + x.output, cacheRead: a.cacheRead + x.cacheRead, cacheWrite: a.cacheWrite + x.cacheWrite };
    },
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  // A loop, not Math.max(...spans): a spread of 250,000 values overflows the call stack.
  let duration = 0;
  for (const s of trace.spans) if (s.end > duration) duration = s.end;
  return {
    llmCalls: llm.length,
    toolCalls: trace.spans.filter((s) => s.kind === "tool").length,
    errors: trace.spans.filter((s) => s.status === "error").length,
    usage: u,
    prompt,
    cacheHit: prompt ? u.cacheRead / prompt : 0,
    duration,
    models: [...new Set(llm.map((s) => s.model).filter(Boolean))] as string[],
  };
}

const big = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const mid = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Money at the precision its size needs: $0.0065, $0.325, $32.52, $32,518. */
export const usd = (v: number) => {
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  if (v < 1000) return mid.format(v);
  return big.format(v);
};

export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : `${n}`);

export const perMillion = (p: number) => `$${(p * 1e6).toFixed(p * 1e6 >= 10 ? 0 : 2)}`;
