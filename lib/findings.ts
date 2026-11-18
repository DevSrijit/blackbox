// The waste finder. Each finding comes from the trace data alone, with a dollar estimate.
// Estimates are conservative and say what they assume.

import { findModel, spanCost, usageCost, type Prices } from "./cost";
import type { Span, Trace } from "./types";

export type Finding = {
  id: string;
  kind: "cache" | "retry" | "loop" | "tools" | "premium";
  title: string;
  detail: string;
  /** Estimated USD saved per run if fixed. */
  saving: number;
  spans: string[];
};

/** About 4 characters per token for English and JSON. Used only where the trace has no count. */
export const estTokens = (s: string) => Math.ceil(s.length / 4);

/** The small model of each provider, used to price "move this step to a small model" findings. */
const SMALL: Record<string, string> = {
  anthropic: "anthropic/claude-haiku-5.5",
  openai: "openai/gpt-5.6-luna",
  "x-ai": "x-ai/grok-4.7",
  qwen: "qwen/qwen3.8-flash",
  "z-ai": "z-ai/glm-5.3-flash",
  minimax: "minimax/minimax-m3.1-flash",
};
const smallFor = (model?: string) => SMALL[(model ?? "").split("/")[0]] ?? SMALL.anthropic;

export function findings(trace: Trace, prices: Prices): Finding[] {
  const out: Finding[] = [];
  const llm = trace.spans.filter((s) => s.kind === "llm" && s.usage).sort((a, b) => a.start - b.start);
  const byParent = group(llm, (s) => s.parentId ?? "root");

  // 1. Context resent without prompt caching.
  {
    let saving = 0;
    let resent = 0;
    const ids: string[] = [];
    for (const calls of byParent.values()) {
      for (let i = 1; i < calls.length; i++) {
        const prev = calls[i - 1].usage!;
        const cur = calls[i];
        const u = cur.usage!;
        const m = findModel(prices, cur.model);
        if (!m || m.cacheRead == null) continue;
        const prevPrompt = prev.input + prev.cacheRead + prev.cacheWrite;
        const shared = Math.min(prevPrompt, u.input);
        if (u.cacheRead > 0 || shared < 1024) continue;
        // Reading the shared part from the cache saves (input - cache read) per token.
        // Writing the new part to the cache costs extra where the cache write price is higher.
        const added = Math.max(0, u.input - shared);
        const premium = Math.max(0, (m.cacheWrite ?? m.prompt) - m.prompt);
        saving += shared * (m.prompt - m.cacheRead) - added * premium;
        resent += shared;
        ids.push(cur.id);
      }
    }
    if (ids.length) {
      // Two different problems give the same symptom. Either the run never used the cache, or the
      // cache worked and then stopped. The second one needs a different fix, so say which it is.
      const first = llm.find((s) => s.id === ids[0])!;
      const broke = llm.some((s) => s.usage!.cacheRead > 0 && s.start < first.start);
      const assume = "The estimate assumes each call starts with the whole input of the call before it. It includes the extra price of writing to the cache.";
      out.push({
        id: "cache",
        kind: "cache",
        title: broke
          ? `Prompt caching stops at ${first.name}. ${ids.length} ${ids.length === 1 ? "call pays" : "calls pay"} full price from there.`
          : `${ids.length} LLM calls send the earlier conversation again at full price`,
        detail: broke
          ? `Caching works until ${first.name}. From that call on, the calls miss the cache and send about ${fmtK(resent)} tokens of earlier conversation again at full price. A change near the top of the prompt, such as a timestamp, usually causes this. Keep the start of the prompt the same on every call. ${assume}`
          : `The agent sends about ${fmtK(resent)} tokens of earlier conversation again, with no prompt caching. With caching, those tokens bill at the lower cache price. ${assume}`,
        saving: Math.max(0, saving),
        spans: ids,
      });
    }
  }

  // 2. Failed calls and retries.
  {
    const failed = trace.spans.filter((s) => s.status === "error");
    if (failed.length) {
      const wasted = failed.reduce((a, s) => a + spanCost(s, prices), 0);
      // A failed tool call also wastes the LLM call that asked for it.
      const askers = failed.filter((s) => s.kind === "tool").map((t) => precedingLlm(llm, t)).filter(Boolean) as Span[];
      const extra = askers.reduce((a, s) => a + spanCost(s, prices), 0);
      out.push({
        id: "retry",
        kind: "retry",
        title: `${failed.length} failed ${failed.length === 1 ? "step" : "steps"} and the LLM ${askers.length === 1 ? "call" : "calls"} that asked for ${failed.length === 1 ? "it" : "them"}`,
        detail: `${unique(failed.map((s) => s.name)).join(", ")} failed. You paid for the LLM call that asked for this step. Open the step to read the error.`,
        saving: wasted + extra,
        spans: [...failed.map((s) => s.id), ...askers.map((s) => s.id)],
      });
    }
  }

  // 3. The same tool with the same arguments, again and again.
  {
    const tools = trace.spans.filter((s) => s.kind === "tool" && s.tool);
    const seen = group(tools, (s) => `${s.parentId}|${s.tool!.name}|${stable(s.tool!.args)}`);
    for (const [, calls] of seen) {
      if (calls.length < 3) continue;
      const askers = calls.slice(1).map((t) => precedingLlm(llm, t)).filter(Boolean) as Span[];
      out.push({
        id: `loop:${calls[0].id}`,
        kind: "loop",
        title: `${calls[0].tool!.name} ran ${calls.length} times with the same arguments`,
        detail: `The agent called ${calls[0].tool!.name} ${calls.length} times with the same arguments. Each repeat costs one more LLM call. Cache the tool result, or tell the model in the tool result that it already has this data.`,
        saving: askers.reduce((a, s) => a + spanCost(s, prices), 0),
        spans: [...calls.map((s) => s.id), ...askers.map((s) => s.id)],
      });
    }
  }

  // 4. Tool definitions that ride along on every call.
  {
    const withTools = llm.filter((s) => s.tools?.length);
    if (withTools.length) {
      const schema = estTokens(JSON.stringify(withTools[0].tools));
      const promptAll = withTools.reduce((a, s) => a + s.usage!.input + s.usage!.cacheRead + s.usage!.cacheWrite, 0);
      const share = (schema * withTools.length) / Math.max(1, promptAll);
      if (share > 0.08) {
        const saving = withTools.reduce((a, s) => {
          const m = findModel(prices, s.model);
          // Half the schema is a fair target: shorter descriptions, fewer always-on tools.
          return a + (m ? (schema / 2) * (s.usage!.cacheRead > 0 ? (m.cacheRead ?? m.prompt) : m.prompt) : 0);
        }, 0);
        out.push({
          id: "tools",
          kind: "tools",
          title: `Tool definitions are ${Math.round(share * 100)}% of the input`,
          detail: `${withTools[0].tools!.length} tools add about ${fmtK(schema)} tokens to each of ${withTools.length} LLM calls. The estimate assumes the schemas get 50% smaller. Write shorter descriptions. Send only the tools each step needs.`,
          saving,
          spans: withTools.map((s) => s.id),
        });
      }
    }
  }

  // 5. Short answers on a premium model. The estimate uses the small model of the same provider.
  {
    const hits = llm.filter((s) => {
      const m = findModel(prices, s.model);
      const small = findModel(prices, smallFor(s.model));
      const usesTools = s.output?.toolCalls?.length;
      return m && small && m.prompt >= 1.5e-6 && s.usage!.output <= 40 && !usesTools && m.id !== small.id;
    });
    if (hits.length) {
      const smalls = unique(hits.map((s) => findModel(prices, smallFor(s.model))!.id));
      const saving = hits.reduce((a, s) => a + spanCost(s, prices) - usageCost(s.usage!, findModel(prices, smallFor(s.model))!), 0);
      out.push({
        id: "premium",
        kind: "premium",
        title: `${hits.length} short ${hits.length === 1 ? "answer" : "answers"} from a premium model`,
        detail: `${unique(hits.map((s) => s.name)).join(", ")} ${hits.length === 1 ? "returns" : "return"} 40 tokens or fewer and ${hits.length === 1 ? "calls" : "call"} no tools, on a model that costs $1.50 or more for each 1M input tokens. The estimate uses the price of ${smalls.map((id) => id.split("/")[1]).join(" and ")}, the small model of the same provider.`,
        saving: Math.max(0, saving),
        spans: hits.map((s) => s.id),
      });
    }
  }

  return out.filter((f) => f.saving > 0 || f.kind === "retry").sort((a, b) => b.saving - a.saving);
}

/**
 * Combined saving of all findings. Fixes overlap (caching and a removed loop save some of the
 * same tokens), so each fix applies to the cost left after the others, never to the full total.
 */
export function combinedSaving(fs: Finding[], total: number) {
  if (total <= 0) return 0;
  let left = 1;
  for (const f of fs) left *= 1 - Math.min(0.95, f.saving / total);
  return total * (1 - left);
}

function precedingLlm(llm: Span[], t: Span) {
  let best: Span | null = null;
  for (const s of llm) if (s.end <= t.start + 1 && (!best || s.end > best.end)) best = s;
  return best;
}

function group<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function stable(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

const unique = (xs: string[]) => [...new Set(xs)];
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : `${n}`);
