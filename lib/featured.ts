// The models the Compare list shows first. They come from what people actually use: OpenRouter's
// public usage rankings, summed over the last 4 weeks. The rankings need an OpenRouter API key on
// the server (OPENROUTER_API_KEY). With no key, or when the call fails, the saved snapshot is used.
// Refresh the snapshot with: bun scripts/featured.ts

import { cacheLife } from "next/cache";
import snapshot from "@/data/featured.snapshot.json";
import type { Model } from "./types";

export type Featured = { id: string; /** Tokens over the window, or null for a hand-picked entry. */ tokens: number | null };
export type FeaturedList = {
  models: Featured[];
  /** "rankings": live usage data. "snapshot": the saved copy, which may be usage data or hand-picked. */
  source: "rankings" | "snapshot";
  /** When the usage data was read, or null for a hand-picked list. */
  asOf: string | null;
};

/** How many models the list features. */
const COUNT = 12;
/** At most this many from one provider, so one lab cannot fill the list. */
const PER_PROVIDER = 2;
const WINDOW_DAYS = 28;

export type RankRow = { slug: string; tokens: number };

/** Weekly usage, summed by model. Throws on any failure, so a failed call is never cached. */
export async function fetchRankings(key: string): Promise<{ rows: RankRow[]; asOf: string }> {
  const start = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const res = await fetch(`https://openrouter.ai/api/v1/datasets/rankings-daily?period=week&start_date=${start}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`rankings ${res.status}`);
  const body = (await res.json()) as { data?: { model_permaslug?: string; total_tokens?: string | number }[]; meta?: { as_of?: string } };
  const sum = new Map<string, number>();
  for (const r of body.data ?? []) {
    const slug = String(r.model_permaslug ?? "");
    const tokens = Number(r.total_tokens);
    if (!slug || slug === "other" || !Number.isFinite(tokens)) continue;
    // ":free", ":thinking" and other variants count toward their base model.
    const base = slug.split(":")[0];
    sum.set(base, (sum.get(base) ?? 0) + tokens);
  }
  if (sum.size < COUNT) throw new Error("short rankings");
  return { rows: [...sum].map(([slug, tokens]) => ({ slug, tokens })), asOf: body.meta?.as_of ?? new Date().toISOString() };
}

/**
 * The rankings, cached for a day. A failed call returns null and is cached for minutes only, so a
 * short outage does not hide the live list for a whole day. It never throws: an error inside a
 * cached function would stop the build.
 */
async function rankings(key: string): Promise<{ rows: RankRow[]; asOf: string } | null> {
  "use cache";
  try {
    const out = await fetchRankings(key);
    cacheLife("days");
    return out;
  } catch {
    cacheLife("minutes");
    return null;
  }
}

/**
 * Turns ranking rows into priced models. A ranking slug can carry a date ("openai/gpt-x-2026-05-13")
 * that the price list leaves out, so the match also tries the slug without it.
 */
export function pickFeatured(rows: RankRow[], models: Model[]): Featured[] {
  // Variants (":batch", ":free") share their base model's slug, so only base models take part.
  const base = models.filter((m) => !m.id.includes(":"));
  const byId = new Map(base.map((m) => [m.id, m]));
  const bySlug = new Map(base.filter((m) => m.slug).map((m) => [m.slug!, m]));
  // A dated snapshot ("…-1017", "…-20260513", "…-2026-05-13") counts toward its base model when the
  // base is on the price list, so one model never takes two places.
  const undated = (id: string) => id.replace(/-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/, "");
  const find = (slug: string) => {
    const m = bySlug.get(slug) ?? byId.get(slug);
    const plain = byId.get(undated(m?.id ?? slug));
    return plain ?? m;
  };
  const total = new Map<string, number>();
  for (const r of rows) {
    const m = find(r.slug);
    if (m) total.set(m.id, (total.get(m.id) ?? 0) + r.tokens);
  }
  const out: Featured[] = [];
  const perProvider = new Map<string, number>();
  for (const [id, tokens] of [...total].sort((a, b) => b[1] - a[1])) {
    const provider = id.split("/")[0];
    if ((perProvider.get(provider) ?? 0) >= PER_PROVIDER) continue;
    perProvider.set(provider, (perProvider.get(provider) ?? 0) + 1);
    out.push({ id, tokens });
    if (out.length === COUNT) break;
  }
  return out;
}

export async function getFeatured(models: Model[]): Promise<FeaturedList> {
  const key = process.env.OPENROUTER_API_KEY;
  const live = key ? await rankings(key) : null;
  if (live) {
    const list = pickFeatured(live.rows, models);
    if (list.length >= COUNT / 2) return { models: list, source: "rankings", asOf: live.asOf };
  }
  // No key, or the call failed: use the saved copy.
  const priced = new Set(models.map((m) => m.id));
  return { models: (snapshot.models as Featured[]).filter((f) => priced.has(f.id)), source: "snapshot", asOf: snapshot.asOf };
}
