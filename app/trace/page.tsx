import type { Metadata } from "next";
import { OpenedRun } from "@/components/OpenedRun";
import { getFeatured } from "@/lib/featured";
import { getModels } from "@/lib/models";
import { demoRuns } from "@/lib/runs";

// A visitor's own file: never indexed.
export const metadata: Metadata = { title: "Your trace", robots: { index: false, follow: false } };

export default async function TracePage() {
  const { models, fetchedAt, live } = await getModels();
  const featured = await getFeatured(models);
  return <OpenedRun models={models} demos={demoRuns()} pricesAt={fetchedAt} pricesLive={live} featured={featured} />;
}
