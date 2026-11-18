import { Landing, type DemoChip, type FieldRun, type Showcase } from "@/components/landing/Landing";
import { countOf, wasteCount } from "@/components/landing/field/layout";
import { allOn, findModel, priceMap, spanCost, totals, traceCost } from "@/lib/cost";
import { DEMOS } from "@/lib/demos";
import { getFeatured } from "@/lib/featured";
import { combinedSaving, estTokens, findings, type Finding } from "@/lib/findings";
import { getModels } from "@/lib/models";

/** One line that says what a demo run shows, from its biggest finding. */
function hookFor(f: Finding | undefined) {
  if (!f) return "Caches well. A clean run to compare with.";
  if (f.kind === "cache") return f.title.startsWith("Prompt caching stops") ? "Its prompt cache breaks halfway through." : "Resends its whole conversation on every call.";
  if (f.kind === "loop") return "Calls the same tool again and again.";
  if (f.kind === "retry") return "Pays for a step that failed.";
  if (f.kind === "premium") return "Uses a premium model for short answers.";
  return "Sends heavy tool definitions on every call.";
}

/** How many models the sweep shows, after the run as recorded. */
const SWEEP = 10;

export default async function Home() {
  const { models } = await getModels();
  const prices = priceMap(models);

  const chips: DemoChip[] = DEMOS.map((d) => {
    const cost = traceCost(d, prices);
    const found = findings(d, prices);
    return {
      slug: d.id,
      file: `${d.id}.json`,
      kb: Math.max(1, Math.round(JSON.stringify(d).length / 1024)),
      cost,
      calls: totals(d).llmCalls,
      hook: hookFor(found[0]),
      saving: combinedSaving(found, cost),
    };
  });

  // The field draws the billing agent run, one dot per token.
  const hero = DEMOS[0];
  const fs = findings(hero, prices);
  const flagged = (kind: string) => new Set(fs.filter((f) => f.kind === kind).flatMap((f) => f.spans));
  const resentIds = flagged("cache");
  const repeatIds = new Set([...flagged("loop"), ...flagged("retry")]);

  const llm = hero.spans.filter((s) => s.kind === "llm" && s.usage).sort((a, b) => a.start - b.start);
  const prev = new Map<string, number>();
  const run: FieldRun = {
    duration: totals(hero).duration,
    calls: llm.map((s) => {
      const u = s.usage!;
      const prompt = u.input + u.cacheRead + u.cacheWrite;
      const parent = s.parentId ?? "root";
      // The same rule as the cache finding: the part of the input that repeats the call before it.
      const resent = resentIds.has(s.id) ? Math.min(prev.get(parent) ?? 0, u.input) : 0;
      prev.set(parent, prompt);
      return { name: s.name, model: s.model ?? "", start: s.start, end: s.end, prompt, output: u.output, resent, repeat: repeatIds.has(s.id), cost: spanCost(s, prices) };
    }),
  };
  const fail = hero.spans.find((s) => s.status === "error");
  const total = traceCost(hero, prices);

  // The sweep: the run's own models and the most used models on OpenRouter, priced on this run.
  const featured = await getFeatured(models);
  const recordedIds = [...new Set(llm.map((s) => s.model ?? ""))];
  const ids = [...new Set([...recordedIds, ...featured.models.map((f) => f.id)])];
  const sweep = ids
    .map((id) => ({ id, m: findModel(prices, id) }))
    .filter((x): x is { id: string; m: NonNullable<typeof x.m> } => !!x.m)
    .slice(0, SWEEP)
    .map(({ id, m }) => ({ id, pin: m.prompt, pout: m.completion, total: traceCost(hero, prices, allOn(hero, id)) }))
    .sort((a, b) => b.total - a.total);

  const showcase: Showcase = {
    prices: llm.map((s) => {
      const m = findModel(prices, s.model);
      return { pin: m?.prompt ?? 0, pout: m?.completion ?? 0 };
    }),
    recorded: recordedIds.flatMap((id) => {
      const m = findModel(prices, id);
      return m ? [{ id, pin: m.prompt, pout: m.completion, calls: llm.flatMap((s, i) => (s.model === id ? [i] : [])) }] : [];
    }),
    sweep,
    findings: fs.map((f) => ({ kind: f.kind, title: f.title, saving: f.saving })),
    // Which finding each call belongs to, so the field can light that group alone.
    marks: llm.map((s) => ({
      group: (flagged("loop").has(s.id) ? 1 : 0) | (flagged("retry").has(s.id) ? 2 : 0) | (flagged("premium").has(s.id) ? 4 : 0),
      tools: s.tools?.length ? Math.min(s.usage!.input + s.usage!.cacheRead + s.usage!.cacheWrite, estTokens(JSON.stringify(s.tools))) : 0,
    })),
    tools: hero.spans
      .filter((s) => s.kind === "tool")
      .sort((a, b) => a.start - b.start)
      .map((s) => ({ name: s.name, ms: s.end - s.start, failed: s.status === "error" })),
    saving: combinedSaving(fs, total),
    wasteTokens: wasteCount(run),
    modelCount: models.length,
  };

  return (
    <Landing
      run={run}
      chips={chips}
      failure={fail ? { name: fail.name, start: fail.start, end: fail.end } : null}
      total={total}
      tokenCount={countOf(run)}
      showcase={showcase}
    />
  );
}
