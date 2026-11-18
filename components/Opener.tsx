"use client";

// Opening a trace file, from anywhere in the app: the "Open a trace" buttons, ⌘O, or a file
// dropped on any page. The file is parsed in the browser and shown at /trace.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { parseTrace, TraceError } from "@/lib/adapters";
import { setOpened } from "@/lib/opened";

/**
 * A page can take over file drops: the landing hero draws its own drop state. While a target is
 * registered, the generic overlay stays hidden and the target gets the pointer and the file.
 */
export type DropTarget = {
  enter: () => void;
  /** The pointer moved during a file drag. Called on every dragover, so keep it cheap. */
  over: (x: number, y: number) => void;
  leave: () => void;
  /** The target plays its own animation, then calls `load`. */
  drop: (file: File, x: number, y: number) => void;
};

type Ctx = {
  openFile: () => void;
  version: number;
  /** Reads the file and opens it at /trace. `before` runs after a good parse and before the route change. */
  load: (file: File, before?: () => Promise<void>) => Promise<boolean>;
  registerDropTarget: (t: DropTarget) => () => void;
};
const OpenerContext = createContext<Ctx>({ openFile: () => {}, version: 0, load: async () => false, registerDropTarget: () => () => {} });

export const useOpener = () => useContext(OpenerContext);

/** Session logs with many sub-agents can be large. A larger file would not fit in a browser tab's memory. */
const MAX_BYTES = 250 * 1024 * 1024;

/**
 * Files opened together become one trace: a Claude Code session and the sub-agent logs in its
 * "subagents" folder. They are joined as JSON lines; the adapter orders the lines by time.
 */
function asOne(list: FileList | null | undefined): File | null {
  const files = list ? Array.from(list) : [];
  if (files.length <= 1) return files[0] ?? null;
  const main = files.find((f) => !f.name.startsWith("agent-")) ?? files[0];
  return new File(files.flatMap((f) => [f, "\n"]), main.name, { type: "application/jsonl" });
}

export function Opener({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const input = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reduce = useReducedMotion();
  const target = useRef<DropTarget | null>(null);

  const openFile = useCallback(() => input.current?.click(), []);

  const registerDropTarget = useCallback((t: DropTarget) => {
    target.current = t;
    return () => {
      if (target.current === t) target.current = null;
    };
  }, []);

  const load = useCallback(
    async (file: File, before?: () => Promise<void>) => {
      try {
        if (file.size > MAX_BYTES) throw new TraceError("This trace is larger than 250 MB. Blackbox reads traces up to 250 MB. Open one session file, without its sub-agent files.");
        const trace = parseTrace(await file.text(), file.name);
        if (!trace.spans.some((s) => s.kind === "llm")) throw new TraceError("This trace has no LLM calls, so it has no cost to show.");
        setOpened(trace);
        setError(null);
        setVersion((v) => v + 1);
        await before?.();
        if (path !== "/trace") router.push("/trace");
        return true;
      } catch (e) {
        setError(e instanceof TraceError ? e.message : "Blackbox could not read this file. It must be JSON or JSON lines.");
        return false;
      }
    },
    [path, router],
  );

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      if (depth > 1) return;
      if (target.current) target.current.enter();
      else setDropping(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth) return;
      setDropping(false);
      target.current?.leave();
    };
    const over = (e: DragEvent) => {
      e.preventDefault();
      target.current?.over(e.clientX, e.clientY);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDropping(false);
      const f = asOne(e.dataTransfer?.files);
      if (!f) {
        target.current?.leave();
        return;
      }
      if (target.current) target.current.drop(f, e.clientX, e.clientY);
      else load(f);
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
    <OpenerContext.Provider value={{ openFile, version, load, registerDropTarget }}>
      {children}
      <input
        ref={input}
        type="file"
        accept=".json,.jsonl,.ndjson,application/json,application/x-ndjson,application/jsonl,text/plain"
        multiple
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = asOne(e.target.files);
          e.target.value = "";
          if (!f) return;
          if (target.current) target.current.drop(f, window.innerWidth / 2, window.innerHeight / 2);
          else load(f);
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
              <p className="mx-auto mt-2 max-w-[34ch] text-pretty text-[13px] leading-relaxed text-ink-2">A Claude Code or Codex session, OpenTelemetry JSON, JSON lines of OpenAI or OpenRouter calls, or a Blackbox file. It stays in your browser.</p>
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
