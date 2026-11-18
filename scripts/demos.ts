// Writes the demo traces in data/traces. Run: bun scripts/demos.ts
//
// The runs are synthetic but follow how real agents behave: each LLM call resends the system
// prompt, the tool schemas and the whole conversation so far, so prompts grow call by call.
// Organisations stay unnamed. People come from the fictional cast only (Hana Lin, Dana).

import { mkdir, writeFile } from "node:fs/promises";
import type { Message, Span, ToolDef, Trace } from "../lib/types";

const est = (s: string) => Math.ceil(s.length / 4);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type CallOpts = {
  name?: string;
  model?: string;
  out: string;
  outTokens?: number;
  calls?: { name: string; args: unknown }[];
  /** Milliseconds per output token, plus a fixed first-token delay. */
  ms?: number;
  error?: string;
};

/** Builds one agent run: an agent span, its LLM calls and its tool calls. */
class Run {
  spans: Span[] = [];
  t: number;
  history: Message[] = [];
  historyTokens = 0;
  private n = 0;
  private r: () => number;
  constructor(
    public agent: string,
    public model: string,
    public system: string,
    public systemTokens: number,
    public tools: ToolDef[],
    public cache: (i: number) => boolean,
    seed: number,
    start = 0,
    public parentId: string | null = null,
  ) {
    this.r = rng(seed);
    this.t = start;
    this.spans.push({ id: `${agent}`, parentId, kind: "agent", name: agent, start, end: start, status: "ok" });
  }
  get toolTokens() {
    return est(JSON.stringify(this.tools));
  }
  user(text: string, tokens = est(text)) {
    this.history.push({ role: "user", content: text });
    this.historyTokens += tokens;
  }
  llm(o: CallOpts) {
    const i = this.n++;
    const prompt = this.systemTokens + this.toolTokens + this.historyTokens;
    const out = o.outTokens ?? est(o.out) + (o.calls ? est(JSON.stringify(o.calls)) : 0);
    const cached = this.cache(i) ? Math.max(0, prompt - (this.lastAdded ?? prompt)) : 0;
    const dur = Math.round(380 + this.r() * 260 + prompt * 0.012 + out * (o.ms ?? 22));
    const id = `${this.agent}:llm${i}`;
    const output: Message = { role: "assistant", content: o.out, toolCalls: o.calls?.map((c, k) => ({ id: `${id}:c${k}`, name: c.name, args: c.args })) };
    this.spans.push({
      id,
      parentId: this.agent,
      kind: "llm",
      name: o.name ?? (o.calls?.length ? `plan → ${o.calls.map((c) => c.name).join(", ")}` : "answer"),
      start: this.t,
      end: this.t + dur,
      status: o.error ? "error" : "ok",
      error: o.error,
      model: o.model ?? this.model,
      usage: { input: prompt - cached - (this.cache(i) && cached === 0 ? 0 : 0), output: out, cacheRead: cached, cacheWrite: this.cache(i) ? Math.min(prompt - cached, this.lastAdded ?? prompt) : 0 },
      input: [{ role: "system", content: this.system }, ...this.history.slice(-6)],
      output,
      tools: this.tools,
    });
    // Usage must not double count: cacheWrite tokens are not also billed as input.
    const u = this.spans[this.spans.length - 1].usage!;
    u.input = Math.max(0, prompt - u.cacheRead - u.cacheWrite);
    this.t += dur + 40;
    this.history.push(output);
    this.historyTokens += out;
    this.lastAdded = out;
    return id;
  }
  private lastAdded: number | undefined;
  tool(name: string, args: unknown, result: unknown, ms: number, opts: { error?: string; resultTokens?: number; parallel?: number } = {}) {
    const id = `${this.agent}:tool${this.spans.length}`;
    const start = this.t + (opts.parallel ?? 0) * 35;
    this.spans.push({ id, parentId: this.agent, kind: "tool", name, start, end: start + ms, status: opts.error ? "error" : "ok", error: opts.error, tool: { name, args, result } });
    const text = typeof result === "string" ? result : JSON.stringify(result);
    const tok = opts.resultTokens ?? est(text) + 12;
    this.history.push({ role: "tool", name, content: opts.error ? `Error: ${opts.error}` : text });
    this.historyTokens += opts.error ? 40 : tok;
    this.lastAdded = (this.lastAdded ?? 0) + (opts.error ? 40 : tok);
    // A tool on its own moves the clock. Parallel tools move it once, at join().
    if (opts.parallel === undefined) this.t = start + ms + 30;
    return { id, end: start + ms };
  }
  wait(ms: number) {
    this.t += ms;
  }
  /** Ends a group of parallel tools at the slowest one. */
  join(ends: number[]) {
    this.t = Math.max(this.t, ...ends) + 30;
  }
  finish() {
    const agent = this.spans[0];
    agent.end = this.t;
    return this.spans;
  }
}

const sys = (lines: string[]) => lines.join("\n");

// ---------- 1. Billing agent: a support agent at a clinic ----------

function billing(): Trace {
  const tools: ToolDef[] = [
    { name: "lookup_patient", description: "Find a patient record by name, date of birth or patient ID. Returns demographics, insurance plan, balance and contact preferences. Use this before any billing action so the right account is changed.", parameters: { type: "object", properties: { query: { type: "string", description: "Name, DOB (YYYY-MM-DD) or patient ID" } }, required: ["query"] } },
    { name: "get_invoices", description: "List invoices for a patient with line items, CPT codes, payer adjustments, payments and status. Results are sorted newest first and include up to 50 invoices.", parameters: { type: "object", properties: { patient_id: { type: "string" }, since: { type: "string", description: "ISO date" } }, required: ["patient_id"] } },
    { name: "check_refund_policy", description: "Ask the policy agent whether a refund is allowed under the clinic's billing policy BP-14, including duplicate charges, insurance timing and approval limits.", parameters: { type: "object", properties: { case: { type: "string" } }, required: ["case"] } },
    { name: "issue_refund", description: "Issue a refund to the original payment method. Amounts above 500 USD need a supervisor approval id. Idempotent per invoice and line item.", parameters: { type: "object", properties: { invoice_id: { type: "string" }, line_id: { type: "string" }, amount: { type: "number" }, reason: { type: "string" } }, required: ["invoice_id", "amount", "reason"] } },
    { name: "send_email", description: "Send an email to the patient using an approved template. Templates: refund_issued, refund_denied, need_more_info, payment_plan.", parameters: { type: "object", properties: { patient_id: { type: "string" }, template: { type: "string" }, variables: { type: "object" } }, required: ["patient_id", "template"] } },
    { name: "create_ticket", description: "Create an internal ticket for the billing team with priority, summary and links to the patient and invoices.", parameters: { type: "object", properties: { summary: { type: "string" }, priority: { type: "string", enum: ["low", "normal", "high"] } } } },
    { name: "get_payment_methods", description: "List saved payment methods with last four digits, brand and status. Never returns full card numbers.", parameters: { type: "object", properties: { patient_id: { type: "string" } } } },
    { name: "add_note", description: "Add a note to the patient's billing record. Notes are visible to staff only.", parameters: { type: "object", properties: { patient_id: { type: "string" }, note: { type: "string" } } } },
    { name: "escalate_to_human", description: "Hand the conversation to a human billing specialist with a summary of what was checked and what remains.", parameters: { type: "object", properties: { summary: { type: "string" } } } },
  ];
  const system = sys([
    "You are the billing support agent for a medical clinic.",
    "Follow billing policy BP-14. Verify the patient before any account change.",
    "Never reveal full payment details. Refunds above 500 USD need supervisor approval.",
    "Be concise and warm. Today is 2026-11-12.",
  ]);
  const run = new Run("support-agent", "anthropic/claude-opus-5.5", system, 3200, tools, () => false, 11);
  run.user("Hi, this is Hana Lin. I was charged twice for my visit on October 28 — $186 both times. Can you refund the duplicate?");
  run.llm({ name: "route_intent", out: "billing_dispute", outTokens: 6, ms: 18 });
  run.llm({ out: "", calls: [{ name: "lookup_patient", args: { query: "Hana Lin" } }] });
  run.tool("lookup_patient", { query: "Hana Lin" }, { patient_id: "P-20417", name: "Hana Lin", dob: "1991-03-08", plan: "PPO", balance: 0, email_ok: true }, 420);
  run.llm({ out: "", calls: [{ name: "get_invoices", args: { patient_id: "P-20417", since: "2026-10-01" } }] });
  const invoices = { invoices: [{ id: "INV-88213", date: "2026-10-28", lines: [{ id: "L1", cpt: "99214", amount: 186, status: "paid" }, { id: "L2", cpt: "99214", amount: 186, status: "paid" }], payer_adj: 0 }, { id: "INV-87790", date: "2026-10-03", lines: [{ id: "L1", cpt: "85025", amount: 42, status: "paid" }] }] };
  run.tool("get_invoices", { patient_id: "P-20417", since: "2026-10-01" }, invoices, 880, { resultTokens: 1850 });
  run.llm({ out: "Let me confirm the line items before I check the policy.", calls: [{ name: "get_invoices", args: { patient_id: "P-20417", since: "2026-10-01" } }] });
  run.tool("get_invoices", { patient_id: "P-20417", since: "2026-10-01" }, invoices, 860, { resultTokens: 1850 });
  run.llm({ out: "", calls: [{ name: "get_invoices", args: { patient_id: "P-20417", since: "2026-10-01" } }] });
  run.tool("get_invoices", { patient_id: "P-20417", since: "2026-10-01" }, invoices, 910, { resultTokens: 1850 });
  run.llm({ out: "INV-88213 has the same CPT 99214 charged twice on one visit. Checking policy.", calls: [{ name: "check_refund_policy", args: { case: "Duplicate CPT 99214 on INV-88213, two lines of $186, same date of service, both paid by card." } }] });

  // The policy check is its own small agent.
  const policyStart = run.t;
  const policy = new Run("policy-checker", "anthropic/claude-sonnet-5.5", sys(["You decide whether a refund follows the clinic's billing policy BP-14.", "Answer ALLOW or DENY with one short reason and any approval needed."]), 5200, [], () => false, 5, policyStart, "support-agent");
  policy.user("Duplicate CPT 99214 on INV-88213, two lines of $186, same date of service, both paid by card.");
  policy.llm({ name: "read_policy", out: "Section 4.2 covers duplicate professional charges on one date of service: refund the duplicate line to the original method, no approval below 500 USD.", ms: 20 });
  policy.llm({ name: "decide", out: "ALLOW — BP-14 §4.2, duplicate line L2, $186, no approval needed.", outTokens: 24 });
  const pSpans = policy.finish();
  run.t = policy.t + 60;
  run.tool("check_refund_policy", { case: "Duplicate CPT 99214 on INV-88213" }, "ALLOW — BP-14 §4.2, duplicate line L2, $186, no approval needed.", 0, { parallel: 0 });
  // The tool span covers the policy agent's whole run.
  run.spans[run.spans.length - 1].start = policyStart;
  run.spans[run.spans.length - 1].end = policy.t;

  run.llm({ out: "", calls: [{ name: "issue_refund", args: { invoice_id: "INV-88213", line_id: "L2", amount: 186, reason: "Duplicate charge, BP-14 §4.2" } }] });
  run.tool("issue_refund", { invoice_id: "INV-88213", line_id: "L2", amount: 186, reason: "Duplicate charge, BP-14 §4.2" }, null, 30000, { error: "502 Bad Gateway from payments-gateway (timeout after 30 s)" });
  run.llm({ out: "The payment service timed out. Trying again.", calls: [{ name: "issue_refund", args: { invoice_id: "INV-88213", line_id: "L2", amount: 186, reason: "Duplicate charge, BP-14 §4.2" } }] });
  run.tool("issue_refund", { invoice_id: "INV-88213", line_id: "L2", amount: 186, reason: "Duplicate charge, BP-14 §4.2" }, { refund_id: "RF-55190", status: "submitted", eta_days: 5 }, 2100);
  run.llm({ out: "", calls: [{ name: "send_email", args: { patient_id: "P-20417", template: "refund_issued", variables: { amount: "$186.00", eta: "5 business days" } } }, { name: "add_note", args: { patient_id: "P-20417", note: "Refunded duplicate L2 on INV-88213 ($186), RF-55190." } }] });
  const e1 = run.tool("send_email", { patient_id: "P-20417", template: "refund_issued" }, { sent: true }, 640, { parallel: 0 });
  const e2 = run.tool("add_note", { patient_id: "P-20417" }, { ok: true }, 210, { parallel: 1 });
  run.join([e1.end, e2.end]);
  run.llm({ name: "answer", out: "Thanks for your patience, Hana. You were charged twice for the same visit on October 28. I refunded the duplicate $186.00 to your card on file (refund RF-55190). It should appear within 5 business days, and I sent a confirmation to your email. Is there anything else I can help with?" });
  return {
    id: "billing-agent",
    title: "Billing agent",
    description: "A support agent refunds a duplicate charge. It calls one tool 3 times with the same arguments, waits 30 seconds for a gateway timeout, and sends its whole conversation again on every call.",
    source: "demo",
    startedAt: "2026-11-12T15:04:11.000Z",
    spans: [...run.finish(), ...pSpans].sort((a, b) => a.start - b.start),
  };
}

// ---------- 2. Research agent: prompt caching done right ----------

function research(): Trace {
  const tools: ToolDef[] = [
    { name: "web_search", description: "Search the web. Returns titles, URLs and snippets.", parameters: { type: "object", properties: { q: { type: "string" } } } },
    { name: "fetch_page", description: "Fetch a URL and return readable text.", parameters: { type: "object", properties: { url: { type: "string" } } } },
    { name: "search_library", description: "Search the school's curriculum library.", parameters: { type: "object", properties: { q: { type: "string" } } } },
  ];
  const run = new Run("research-agent", "openai/gpt-5.6-sol", "You write evidence-based briefs for school teachers. Cite every claim.", 1400, tools, (i) => i > 0, 23);
  run.user("Write a one-page brief for Dana's grade 9 science team: does spaced retrieval practice improve exam results? Include classroom routines.");
  run.llm({ out: "", calls: [{ name: "search_library", args: { q: "retrieval practice grade 9" } }, { name: "web_search", args: { q: "spaced retrieval practice secondary school meta-analysis" } }] });
  const a = run.tool("search_library", { q: "retrieval practice grade 9" }, { results: 3 }, 380, { resultTokens: 900, parallel: 0 });
  const b = run.tool("web_search", { q: "spaced retrieval practice secondary school meta-analysis" }, { results: 8 }, 1150, { resultTokens: 1400, parallel: 1 });
  run.join([a.end, b.end]);
  run.llm({ out: "", calls: [1, 2, 3, 4].map((k) => ({ name: "fetch_page", args: { url: `https://example.edu/study-${k}` } })) });
  const ends = [1, 2, 3, 4].map((k, i) => run.tool("fetch_page", { url: `https://example.edu/study-${k}` }, "…", 900 + k * 420, { resultTokens: 4200 + k * 600, parallel: i }).end);
  run.join(ends);
  run.llm({ name: "extract_findings", out: "Effect sizes from four studies…", outTokens: 950 });
  run.llm({ out: "", calls: [{ name: "web_search", args: { q: "retrieval practice classroom routines low stakes quizzes" } }] });
  run.tool("web_search", { q: "retrieval practice classroom routines low stakes quizzes" }, { results: 8 }, 980, { resultTokens: 1300 });
  run.llm({ name: "outline", out: "1. What the evidence says 2. Three routines 3. How to measure", outTokens: 420 });
  run.llm({ name: "draft", out: "Brief draft…", outTokens: 1650, ms: 14 });
  run.llm({ name: "check_citations", out: "All 7 claims have sources.", outTokens: 120 });
  run.llm({ name: "answer", out: "Final brief for the grade 9 science team…", outTokens: 1720, ms: 14 });
  return {
    id: "research-agent",
    title: "Research agent",
    description: "A research agent with prompt caching on. Large web pages stay in the context, but each call pays full price only for the new tokens.",
    source: "demo",
    startedAt: "2026-11-14T09:30:02.000Z",
    spans: run.finish(),
  };
}

// ---------- 3. Coding agent: fix a flaky test ----------

function coding(): Trace {
  const tools: ToolDef[] = ["read_file", "edit_file", "run_tests", "grep", "list_dir", "git_diff"].map((name) => ({
    name,
    description: `${name.replace("_", " ")} in the workspace. Paths are relative to the repository root. Large outputs are cut at 400 lines.`,
    parameters: { type: "object", properties: { path: { type: "string" }, pattern: { type: "string" }, edits: { type: "array" } } },
  }));
  // A timestamp at the top of the system prompt changes every minute, so the cache stops
  // hitting after call 8. Blackbox should flag the calls after that.
  const run = new Run("coding-agent", "anthropic/claude-sonnet-5.5", "You are a coding agent. Current time is written at the top of this prompt.", 4100, tools, (i) => i > 0 && i < 8, 41);
  run.user("tests/scheduler.test.ts fails about one run in five. Find out why and fix it.");
  const files = ["src/scheduler.ts", "src/clock.ts", "tests/scheduler.test.ts", "src/queue.ts"];
  run.llm({ out: "", calls: [{ name: "list_dir", args: { path: "src" } }] });
  run.tool("list_dir", { path: "src" }, ["scheduler.ts", "clock.ts", "queue.ts"], 60, { resultTokens: 80 });
  for (const f of files) {
    run.llm({ out: "", calls: [{ name: "read_file", args: { path: f } }] });
    run.tool("read_file", { path: f }, "…", 90, { resultTokens: 1600 + f.length * 40 });
  }
  run.llm({ out: "", calls: [{ name: "run_tests", args: { pattern: "scheduler" } }] });
  run.tool("run_tests", { pattern: "scheduler" }, "1 failed: expected 3 jobs, got 2", 7400, { resultTokens: 700 });
  run.llm({ name: "hypothesis", out: "The test uses real time; jobs scheduled at the same millisecond race.", outTokens: 160 });
  run.llm({ out: "", calls: [{ name: "grep", args: { pattern: "Date.now" } }] });
  run.tool("grep", { pattern: "Date.now" }, "src/clock.ts:12, src/scheduler.ts:48", 120, { resultTokens: 140 });
  run.llm({ out: "", calls: [{ name: "edit_file", args: { path: "src/scheduler.ts", edits: [{ find: "Date.now()", replace: "this.clock.now()" }] } }] });
  run.tool("edit_file", { path: "src/scheduler.ts" }, null, 80, { error: "find text not found: 'Date.now()' appears with different spacing" });
  run.llm({ out: "", calls: [{ name: "read_file", args: { path: "src/scheduler.ts" } }] });
  run.tool("read_file", { path: "src/scheduler.ts" }, "…", 90, { resultTokens: 2300 });
  run.llm({ out: "", calls: [{ name: "edit_file", args: { path: "src/scheduler.ts", edits: [{ find: "Date.now( )", replace: "this.clock.now()" }] } }] });
  run.tool("edit_file", { path: "src/scheduler.ts" }, { ok: true }, 70, { resultTokens: 30 });
  run.llm({ out: "", calls: [{ name: "edit_file", args: { path: "tests/scheduler.test.ts", edits: [{ find: "new Scheduler()", replace: "new Scheduler(fakeClock)" }] } }] });
  run.tool("edit_file", { path: "tests/scheduler.test.ts" }, { ok: true }, 70, { resultTokens: 30 });
  // Repeated test runs on purpose, with different seeds: a flaky test needs several passes.
  for (let k = 0; k < 3; k++) {
    run.llm({ out: "", calls: [{ name: "run_tests", args: { pattern: "scheduler", repeat: 20, seed: k + 1 } }] });
    run.tool("run_tests", { pattern: "scheduler", repeat: 20, seed: k + 1 }, "20 passed", 9800, { resultTokens: 260 });
  }
  run.llm({ out: "", calls: [{ name: "git_diff", args: {} }] });
  run.tool("git_diff", {}, "…", 60, { resultTokens: 420 });
  run.llm({ name: "answer", out: "Fixed. The scheduler read Date.now() directly, so two jobs created in the same millisecond got the same slot. It now uses the injected clock, and the test uses a fake clock. 60 of 60 runs pass.", outTokens: 210 });
  return {
    id: "coding-agent",
    title: "Coding agent",
    description: "A coding agent fixes a flaky test. Prompt caching stops working halfway: a timestamp at the top of the system prompt changes, so every later call pays full price.",
    source: "demo",
    startedAt: "2026-11-16T21:12:40.000Z",
    spans: run.finish(),
  };
}

await mkdir("data/traces", { recursive: true });
for (const t of [billing(), coding(), research()]) {
  await writeFile(`data/traces/${t.id}.json`, JSON.stringify({ blackbox: 1, ...t }, null, 1));
  console.log(t.id, t.spans.length, "spans");
}
