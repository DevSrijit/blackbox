import { Landing, type DemoCard, type HeroData } from "@/components/landing/Landing";
import { allOn, costCurve, priceMap, totals, traceCost } from "@/lib/cost";
import { DEMOS } from "@/lib/demos";
import { combinedSaving, findings } from "@/lib/findings";
import { getModels } from "@/lib/models";

/** The model the hero re-prices the billing run on. About half the price, so the new line sits mid-height, as on the share image. */
const HERO_MODEL = "anthropic/claude-sonnet-5.5";

export default async function Home() {
  const { models } = await getModels();
  const prices = priceMap(models);

  const demos: DemoCard[] = DEMOS.map((d) => {
    const total = traceCost(d, prices);
    const tot = totals(d);
    const curve = costCurve(d, prices);
    return {
      slug: d.id,
      title: d.title,
      description: d.description ?? "",
      cost: total,
      saving: combinedSaving(findings(d, prices), total),
      calls: tot.llmCalls,
      seconds: tot.duration / 1000,
      cached: tot.cacheHit,
      curve: curve.map((p) => [p.t / tot.duration, p.c / Math.max(1e-9, total)] as [number, number]),
    };
  });

  const hero = DEMOS[0];
  const tot = totals(hero);
  const heroData: HeroData = {
    slug: hero.id,
    title: hero.title,
    duration: tot.duration,
    model: HERO_MODEL.split("/")[1],
    recorded: costCurve(hero, prices).map((p) => [p.t, p.c] as [number, number]),
    repriced: costCurve(hero, prices, allOn(hero, HERO_MODEL)).map((p) => [p.t, p.c] as [number, number]),
    calls: hero.spans
      .filter((s) => s.kind === "llm" && s.usage)
      .map((s) => ({ start: s.start, end: s.end, input: s.usage!.input + s.usage!.cacheWrite, cached: s.usage!.cacheRead })),
  };

  return <Landing demos={demos} hero={heroData} modelCount={models.length} />;
}
