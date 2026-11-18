// The OpenRouter price list. Refreshed at most once an hour; the bundled snapshot is the fallback.

import { cacheLife } from "next/cache";
import snapshot from "@/data/models.snapshot.json";
import type { Model } from "./types";

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function getModels(): Promise<{ models: Model[]; fetchedAt: string; live: boolean }> {
  "use cache";
  cacheLife("hours");
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    const models: Model[] = [];
    for (const m of body.data) {
      const p = (m.pricing ?? {}) as Record<string, unknown>;
      const prompt = num(p.prompt);
      const completion = num(p.completion);
      if (prompt === null || completion === null || prompt < 0 || completion < 0) continue;
      models.push({
        id: String(m.id),
        slug: typeof m.canonical_slug === "string" ? m.canonical_slug : undefined,
        name: String(m.name ?? m.id),
        created: Number(m.created ?? 0),
        context: Number(m.context_length ?? 0),
        prompt,
        completion,
        cacheRead: num(p.input_cache_read),
        cacheWrite: num(p.input_cache_write),
      });
    }
    if (models.length < 50) throw new Error("short list");
    return { models, fetchedAt: new Date().toISOString(), live: true };
  } catch {
    return { models: snapshot.models as Model[], fetchedAt: snapshot.fetchedAt, live: false };
  }
}
