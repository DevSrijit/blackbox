"use client";

// /trace: the run from a file the visitor opened. With no file, a quiet place to drop one.

import Link from "next/link";
import { useSyncExternalStore } from "react";

const noop = () => () => {};
import { getOpened } from "@/lib/opened";
import type { FeaturedList } from "@/lib/featured";
import type { Model, Trace } from "@/lib/types";
import { useOpener } from "./Opener";
import type { RunItem } from "./RunMenu";
import { Key, Logo } from "./ui";
import { Workbench } from "./Workbench";

export function OpenedRun({ models, demos, pricesAt, pricesLive, featured }: { models: Model[]; demos: RunItem[]; pricesAt: string; pricesLive: boolean; featured: FeaturedList }) {
  const { openFile, version } = useOpener();
  // The opened file lives only in this browser, so the server renders the empty frame.
  // A new file bumps `version`, which re-renders this component and reads the store again.
  const trace = useSyncExternalStore<Trace | null | undefined>(noop, getOpened, () => undefined);

  if (trace === undefined) return <div className="min-h-dvh bg-bg" />;

  if (trace)
    return (
      <Workbench
        key={`${trace.id}:${version}`}
        trace={trace}
        models={models}
        runs={[{ key: "opened", title: trace.title, description: "The file you opened", demo: false, href: "/trace" }, ...demos]}
        current="opened"
        pricesAt={pricesAt}
        pricesLive={pricesLive}
        featured={featured}
      />
    );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center border-b border-hair px-4">
        <Link href="/" className="flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5">
          <Logo />
          <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Blackbox</span>
        </Link>
      </header>
      <main className="grid flex-1 place-items-center px-6 py-16">
        <div className="max-w-[420px] text-center">
          <h1 className="text-[22px] font-semibold tracking-[-0.022em]">Open a trace to replay it</h1>
          <p className="mt-2 text-pretty text-[14px] leading-relaxed text-ink-2">Choose a file, or drop one anywhere on this page. Blackbox reads OpenTelemetry JSON and JSON lines of OpenAI or OpenRouter calls. The file stays in your browser.</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button type="button" onClick={openFile} className="flex items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg transition-transform duration-150 ease-out hover:bg-white active:scale-[0.97]">
              Choose a file <Key light>⌘O</Key>
            </button>
            <Link href={demos[0]?.href ?? "/"} className="rounded-lg px-3.5 py-2 text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hair-2)] transition-colors hover:bg-white/[0.04] hover:text-ink">
              Watch a demo
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
