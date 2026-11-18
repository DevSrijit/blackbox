"use client";

// Opening a trace file, from anywhere in the app: the "Open a trace" buttons, ⌘O, or a file
// dropped on any page. The file is parsed in the browser and shown at /trace.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { parseTrace, TraceError } from "@/lib/adapters";
import { setOpened } from "@/lib/opened";

type Ctx = { openFile: () => void; version: number };
const OpenerContext = createContext<Ctx>({ openFile: () => {}, version: 0 });

export const useOpener = () => useContext(OpenerContext);

export function Opener({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const input = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reduce = useReducedMotion();

  const openFile = useCallback(() => input.current?.click(), []);

  const load = useCallback(
    async (file: File) => {
      try {
        if (file.size > 50 * 1024 * 1024) throw new TraceError("This file is larger than 50 MB. Blackbox reads traces up to 50 MB.");
        const trace = parseTrace(await file.text(), file.name);
        if (!trace.spans.some((s) => s.kind === "llm")) throw new TraceError("This trace has no LLM calls, so it has no cost to show.");
        setOpened(trace);
        setError(null);
        setVersion((v) => v + 1);
        if (path !== "/trace") router.push("/trace");
      } catch (e) {
        setError(e instanceof TraceError ? e.message : "Blackbox could not read this file. It must be JSON or JSON lines.");
      }
    },
    [path, router],
  );

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setDropping(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDropping(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDropping(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) load(f);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openFile();
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("keydown", key);
    };
  }, [load, openFile]);

  // A message disappears on its own after 8 seconds.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(id);
  }, [error]);

  return (
    <OpenerContext.Provider value={{ openFile, version }}>
      {children}
      <input
        ref={input}
        type="file"
        accept=".json,.jsonl,.ndjson,application/json,application/x-ndjson,application/jsonl,text/plain"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) load(f);
        }}
      />
      <AnimatePresence>
        {dropping && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-bg/90 p-6"
          >
            <motion.div
              initial={reduce ? false : { scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="w-full max-w-[460px] rounded-2xl border border-dashed border-white/25 px-10 py-12 text-center"
            >
              <div className="text-[18px] font-semibold tracking-[-0.015em] text-ink">Drop the file to replay it</div>
              <p className="mx-auto mt-2 max-w-[34ch] text-pretty text-[13px] leading-relaxed text-ink-2">OpenTelemetry JSON, JSON lines of OpenAI or OpenRouter calls, or a Blackbox file. It stays in your browser.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div aria-live="assertive" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
        <AnimatePresence>
          {error && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              className="pointer-events-auto flex max-w-[520px] items-start gap-3 rounded-xl bg-raised px-4 py-3 text-[13px] text-ink shadow-[0_16px_40px_-8px_rgba(0,0,0,0.7),inset_0_0_0_1px_var(--hair-2)]"
            >
              <span className="mt-[6px] size-1.5 shrink-0 rounded-full bg-ink" aria-hidden />
              <span className="text-pretty leading-relaxed">{error}</span>
              <button type="button" onClick={() => setError(null)} className="-mr-1 ml-1 grid size-6 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink" aria-label="Close message">
                <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="m3 3 6 6M9 3 3 9" strokeLinecap="round" />
                </svg>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </OpenerContext.Provider>
  );
}
