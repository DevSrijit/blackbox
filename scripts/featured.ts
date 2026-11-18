// Refreshes data/featured.snapshot.json from OpenRouter's usage rankings, the last 4 weeks.
// Run: bun scripts/featured.ts   (Bun reads OPENROUTER_API_KEY from .env.local.)
// The site uses this file when it has no key or the live call fails.

import { writeFile } from "node:fs/promises";
import { fetchRankings, pickFeatured } from "../lib/featured";
import type { Model } from "../lib/types";

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("Set OPENROUTER_API_KEY in .env.local first.");
  process.exit(1);
}

const res = await fetch("https://openrouter.ai/api/v1/models");
const body = (await res.json()) as { data: { id: string; canonical_slug?: string; pricing?: { prompt?: string } }[] };
const models = body.data.filter((m) => Number(m.pricing?.prompt) >= 0).map((m) => ({ id: m.id, slug: m.canonical_slug }) as Model);

const { rows, asOf } = await fetchRankings(key);
const list = pickFeatured(rows, models);
await writeFile("data/featured.snapshot.json", JSON.stringify({ asOf, note: "Usage-ranked: OpenRouter, last 4 weeks.", models: list }, null, 2) + "\n");
console.log(`Wrote ${list.length} models, as of ${asOf}:`);
for (const f of list) console.log(`  ${f.id}  ${((f.tokens ?? 0) / 1e12).toFixed(1)}T tokens`);
