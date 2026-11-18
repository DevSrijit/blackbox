import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Workbench } from "@/components/Workbench";
import { DEMOS, demoBySlug } from "@/lib/demos";
import { getFeatured } from "@/lib/featured";
import { getModels } from "@/lib/models";
import { demoRuns } from "@/lib/runs";

// Every demo page is prerendered from generateStaticParams, so loads and navigations are static.
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return DEMOS.map((d) => ({ slug: d.id }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const trace = demoBySlug((await params).slug);
  return { title: trace ? `${trace.title} demo` : "Demo", description: trace?.description };
}

export default function DemoPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
      <Demo params={params} />
    </Suspense>
  );
}

async function Demo({ params }: Props) {
  const { slug } = await params;
  const trace = demoBySlug(slug);
  if (!trace) notFound();
  const { models, fetchedAt, live } = await getModels();
  const featured = await getFeatured(models);
  return <Workbench key={slug} trace={trace} models={models} runs={demoRuns()} current={slug} pricesAt={fetchedAt} pricesLive={live} featured={featured} />;
}
