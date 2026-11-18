import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui";

export const metadata: Metadata = { title: "Not found", robots: { index: false } };

/** A page that does not exist: a flat line on the recorder, and two ways back. */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="flex w-full max-w-[520px] flex-col items-center text-center">
        <Logo size={22} />
        {/* Nothing recorded: the spend line stays flat, and the recording light is off. */}
        <svg viewBox="0 0 400 48" className="mt-10 w-full text-ink-4" fill="none" aria-hidden>
          <path d="M0 24h400" stroke="currentColor" strokeWidth="1" strokeDasharray="2 5" />
          <circle cx="200" cy="24" r="3.5" stroke="var(--rec)" strokeWidth="1.25" />
        </svg>
        <h1 className="mt-8 text-balance text-[clamp(32px,6vw,48px)] font-semibold leading-[1.02] tracking-[-0.035em]" style={{ fontFamily: "var(--font-display)" }}>
          Nothing was recorded here.
        </h1>
        <p className="mt-4 max-w-[40ch] text-pretty text-[15px] leading-relaxed text-ink-2">This page does not exist. The link can be wrong, or the page moved.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="rounded-xl bg-ink px-4 py-2.5 text-[14px] font-medium text-bg transition-[background-color,transform] duration-150 ease-out hover:bg-white active:scale-[0.97]">
            Back to the start
          </Link>
          <Link href="/demo/billing-agent" className="rounded-xl px-4 py-2.5 text-[14px] text-ink shadow-[inset_0_0_0_1px_var(--hair-2)] transition-[background-color,transform] duration-150 ease-out hover:bg-white/[0.05] active:scale-[0.97]">
            Open a demo run
          </Link>
        </div>
      </div>
    </main>
  );
}
