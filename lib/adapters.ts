// Converts trace files to the Blackbox format. Everything runs in the browser: no upload.
//
// Supported:
//   - Blackbox JSON: { "blackbox": 1, ...Trace }
//   - OpenTelemetry OTLP JSON with GenAI semantic conventions (gen_ai.*),
//     plus the common OpenInference keys (llm.*, tool.*).
//   - JSON lines of chat completion calls, one call per line, in the OpenAI or OpenRouter shape:
//     { "model", "messages", "tools"?, "response": { "usage", "choices" }, "start"?, "duration_ms"? }
//     A bare response object per line ({ "model", "usage", "choices" }) also works.
//   - Claude Code session logs: ~/.claude/projects/<project>/<session>.jsonl
//   - Codex CLI session logs: ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl

import type { Message, Span, SpanKind, ToolDef, Trace, Usage } from "./types";

export class TraceError extends Error {}

export function parseTrace(text: string, fileName = "trace"): Trace {
  const trimmed = text.trim();
  if (!trimmed) throw new TraceError("The file is empty.");
  let doc: unknown = null;
  let parsed = false;
  try {
    doc = JSON.parse(trimmed);
    parsed = true;
  } catch {
    // Not one JSON document: try JSON lines.
  }
  if (parsed && (doc === null || typeof doc !== "object"))
    throw new TraceError("This file holds one plain value, not a trace. Blackbox reads OpenTelemetry JSON, Blackbox JSON, or JSON lines of chat calls.");
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const o = doc as Record<string, unknown>;
    if ("blackbox" in o) return native(o, fileName);
    if ("resourceSpans" in o) return otel(o, fileName);
    if ("choices" in o || "messages" in o) return chatLines([o], fileName);
    throw new TraceError("Blackbox does not know this file shape. It reads Claude Code and Codex session logs, OpenTelemetry JSON, Blackbox JSON, and JSON lines of chat calls.");
  }
  if (Array.isArray(doc)) {
    if (doc.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw new TraceError("An item in this file is not a JSON object. Each item must hold one chat call.");
    return chatLines(doc as Record<string, unknown>[], fileName);
  }
  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: Record<string, unknown>[] = [];
  for (const [i, l] of lines.entries()) {
    try {
      rows.push(JSON.parse(l));
    } catch {
      throw new TraceError(`Line ${i + 1} is not valid JSON. Blackbox reads OpenTelemetry JSON, Blackbox JSON, or JSON lines of chat calls.`);
    }
  }
  if (rows.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw new TraceError("A line in this file is not a JSON object. Each line must hold one chat call.");
  if (rows.length && rows.every((r) => "resourceSpans" in r)) {
    const merged = { resourceSpans: rows.flatMap((r) => r.resourceSpans as unknown[]) };
    return otel(merged, fileName);
  }
  if (rows.some(isClaudeCodeRow)) return claudeCode(rows, fileName);
  if (rows.some(isCodexRow)) return codex(rows, fileName);
  return chatLines(rows, fileName);
}

function native(o: Record<string, unknown>, fileName = "trace"): Trace {
  const t = o as unknown as Partial<Trace>;
  if (!Array.isArray(t.spans)) throw new TraceError("This Blackbox file has no spans.");
  return finish({
    id: String(t.id ?? fileName),
    title: typeof t.title === "string" && t.title.trim() ? t.title : fileName.replace(/\.[^.]+$/, ""),
    description: typeof t.description === "string" ? t.description : undefined,
    source: t.source ?? "blackbox",
    startedAt: t.startedAt && !Number.isNaN(Date.parse(t.startedAt)) ? t.startedAt : new Date(0).toISOString(),
    spans: t.spans,
  });
}

/** A finite number, or 0. "Infinity", NaN and non-numeric text all become 0. */
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const count = (v: unknown) => Math.max(0, num(v));
const MAX_DURATION = 7 * 24 * 3600 * 1000;

const json = (v: unknown) => {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return String(v);
  }
};
/** Any value as display text. Objects become JSON, so a file can never put an object into the page. */
const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? json(v) : String(v));

const ROLES = new Set(["system", "user", "assistant", "tool"]);
function message(m: unknown): Message | undefined {
  if (typeof m === "string") return { role: "user", content: m };
  if (!m || typeof m !== "object") return undefined;
  const o = m as Record<string, unknown>;
  const calls = Array.isArray(o.toolCalls) ? o.toolCalls.filter((c): c is Record<string, unknown> => !!c && typeof c === "object") : [];
  return {
    role: ROLES.has(o.role as string) ? (o.role as Message["role"]) : "user",
    content: text(o.content),
    name: typeof o.name === "string" ? o.name : undefined,
    toolCalls: calls.length ? calls.map((c) => ({ id: typeof c.id === "string" ? c.id : undefined, name: text(c.name) || "tool", args: c.args ?? {} })) : undefined,
  };
}

/**
 * An id that is also a key of every plain object ("constructor", "__proto__", "toString") would
 * read the wrong value from a lookup table. Such ids get a prefix.
 */
const safeId = (id: string) => (id === "__proto__" || id in Object.prototype ? `span:${id}` : id);

/**
 * The last step for every adapter: every span gets valid fields, so no file can crash the UI.
 * Times become finite and ordered, counts and costs become finite and not negative, text fields
 * become strings, and ids become unique strings.
 */
export function finish(t: Trace): Trace {
  const seen = new Set<string>();
  const spans: Span[] = t.spans.map((raw, i) => {
    const s = (raw && typeof raw === "object" ? raw : {}) as Partial<Span>;
    let id = safeId(s.id == null ? `span-${i}` : text(s.id));
    while (seen.has(id)) id = `${id}#${i}`;
    seen.add(id);
    const a = num(s.start);
    const b = num(s.end);
    const kind: SpanKind = s.kind === "llm" || s.kind === "tool" || s.kind === "retrieval" || s.kind === "agent" ? s.kind : "agent";
    const tool = s.tool && typeof s.tool === "object" ? { name: text(s.tool.name) || "tool", args: s.tool.args ?? {}, result: s.tool.result } : undefined;
    const span: Span = {
      id,
      parentId: s.parentId == null || s.parentId === "" ? null : safeId(text(s.parentId)),
      kind,
      name: text(s.name) || tool?.name || kind,
      start: Math.min(a, b),
      end: Math.max(a, b),
      status: s.status === "error" ? "error" : "ok",
      error: s.error == null ? undefined : text(s.error),
      tool,
      tools: Array.isArray(s.tools) ? s.tools.filter((d) => d && typeof d === "object").map((d) => ({ ...d, name: text(d.name) || "tool" })) : undefined,
      input: Array.isArray(s.input) ? s.input.map(message).filter((m): m is Message => !!m) : s.input == null ? undefined : [message(s.input)].filter((m): m is Message => !!m),
      output: message(s.output),
    };
    if (kind === "llm") {
      const u = (s.usage && typeof s.usage === "object" ? s.usage : {}) as Partial<Usage>;
      span.usage = { input: count(u.input), output: count(u.output), cacheRead: count(u.cacheRead), cacheWrite: count(u.cacheWrite) };
      span.model = typeof s.model === "string" && s.model ? s.model : undefined;
      // A recorded cost must be a finite number that is not negative. Text like "0.4" is read as a number.
      const raw = s.recordedCost as unknown;
      const cost = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
      if (Number.isFinite(cost) && cost >= 0) span.recordedCost = cost;
    }
    return span;
  });
  // Loops, not Math.min(...spans): a spread of 250,000 values overflows the call stack.
  let t0 = Infinity;
  for (const s of spans) if (s.start < t0) t0 = s.start;
  if (!Number.isFinite(t0)) t0 = 0;
  let duration = 0;
  for (const s of spans) {
    s.start -= t0;
    s.end -= t0;
    if (s.end > duration) duration = s.end;
  }
  if (duration > MAX_DURATION) throw new TraceError("This trace is longer than 7 days. Its timestamps use mixed units, or a unit that Blackbox does not read. Blackbox reads milliseconds, or seconds for OpenAI's created field.");
  return { ...t, spans };
}

// ---------- OpenTelemetry ----------

/** OTLP nanoseconds, as a string or a number, to milliseconds. Bad values give NaN, which finish() turns into 0. */
function nanoToMs(v: unknown): number {
  try {
    return Number(BigInt(String(v).trim().split(".")[0]) / BigInt(1e6));
  } catch {
    return Number(v) / 1e6;
  }
}

type Attr = { key: string; value: Record<string, unknown> };
type OtlpSpan = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string | number;
  endTimeUnixNano: string | number;
  attributes?: Attr[];
  status?: { code?: number | string; message?: string };
};

function attrValue(v: Record<string, unknown>): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v) return ((v.arrayValue as { values?: Record<string, unknown>[] }).values ?? []).map(attrValue);
  return undefined;
}

function otel(o: Record<string, unknown>, fileName: string): Trace {
  const spans: OtlpSpan[] = [];
  for (const rs of (o.resourceSpans as { scopeSpans?: { spans?: OtlpSpan[] }[] }[]) ?? [])
    for (const ss of rs.scopeSpans ?? []) spans.push(...(ss.spans ?? []));
  if (!spans.length) throw new TraceError("This OTLP file has no spans.");
  let t0 = Infinity;
  for (const s of spans) {
    const ms = nanoToMs(s.startTimeUnixNano);
    if (Number.isFinite(ms) && ms < t0) t0 = ms;
  }
  if (!Number.isFinite(t0)) t0 = 0;
  const ids = new Set(spans.map((s) => s.spanId));
  const out: Span[] = spans.map((s) => {
    const a: Record<string, unknown> = {};
    for (const at of s.attributes ?? []) a[at.key] = attrValue(at.value);
    const str = (...keys: string[]) => keys.map((k) => a[k]).find((v) => typeof v === "string") as string | undefined;
    const num = (...keys: string[]) => Number(keys.map((k) => a[k]).find((v) => v !== undefined) ?? 0) || 0;
    const op = str("gen_ai.operation.name", "openinference.span.kind")?.toLowerCase() ?? "";
    const toolName = str("gen_ai.tool.name", "tool.name");
    const model = str("gen_ai.response.model", "gen_ai.request.model", "llm.model_name");
    const kind: SpanKind =
      op.includes("agent") || op === "chain" ? "agent" : op.includes("tool") || toolName ? "tool" : op.includes("retriev") || op === "embeddings" ? "retrieval" : model || op === "chat" || op === "llm" || op === "text_completion" ? "llm" : "agent";
    const start = nanoToMs(s.startTimeUnixNano) - t0;
    const end = nanoToMs(s.endTimeUnixNano) - t0;
    const cacheRead = num("gen_ai.usage.cache_read.input_tokens", "gen_ai.usage.cache_read_input_tokens", "llm.token_count.prompt_details.cache_read");
    const cacheWrite = num("gen_ai.usage.cache_creation.input_tokens", "gen_ai.usage.cache_creation_input_tokens", "llm.token_count.prompt_details.cache_write");
    const promptTotal = num("gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens", "llm.token_count.prompt");
    const span: Span = {
      id: s.spanId,
      parentId: s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : null,
      kind,
      name: toolName ?? str("gen_ai.agent.name") ?? s.name,
      start,
      end,
      status: String(s.status?.code ?? "") === "2" || s.status?.code === "STATUS_CODE_ERROR" ? "error" : "ok",
      error: s.status?.message,
    };
    if (kind === "llm") {
      span.model = model ? normalizeModel(model, str("gen_ai.system", "gen_ai.provider.name", "llm.provider")) : undefined;
      // OTel input_tokens includes cached tokens. Blackbox counts them apart.
      span.usage = { input: Math.max(0, promptTotal - cacheRead - cacheWrite), output: num("gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens", "llm.token_count.completion"), cacheRead, cacheWrite };
      span.input = messagesFrom(a["gen_ai.input.messages"]);
      const outMsgs = messagesFrom(a["gen_ai.output.messages"]);
      span.output = outMsgs?.[outMsgs.length - 1];
    }
    if (kind === "tool") span.tool = { name: toolName ?? s.name, args: jsonish(a["gen_ai.tool.call.arguments"] ?? a["tool.parameters"]), result: jsonish(a["gen_ai.tool.call.result"] ?? a["output.value"]) };
    return span;
  });
  return finish({ id: fileName, title: fileName.replace(/\.[^.]+$/, ""), source: "otel", startedAt: new Date(t0).toISOString(), spans: out.sort((a, b) => a.start - b.start) });
}

function jsonish(v: unknown) {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function messagesFrom(v: unknown): Message[] | undefined {
  const arr = jsonish(v);
  if (!Array.isArray(arr)) return undefined;
  return arr.map((m: Record<string, unknown>) => {
    const parts = (m.parts as Record<string, unknown>[] | undefined) ?? [];
    const text = typeof m.content === "string" ? m.content : parts.filter((p) => p.type === "text").map((p) => p.content).join("\n");
    const calls = parts.filter((p) => p.type === "tool_call").map((p) => ({ id: p.id as string, name: p.name as string, args: p.arguments }));
    return { role: (m.role as Message["role"]) ?? "user", content: String(text ?? ""), toolCalls: calls.length ? calls : undefined };
  });
}

function normalizeModel(model: string, system?: string) {
  if (model.includes("/")) return model;
  // Anthropic's API ids write versions with dashes and a date: "claude-sonnet-4-5-20250929".
  // OpenRouter writes "claude-sonnet-4.5". Same for "claude-3-5-haiku" and "claude-3.5-haiku".
  if (model.startsWith("claude")) model = model.replace(/-\d{8}$/, "").replace(/(\d)-(\d)(?=$|-)/g, "$1.$2");
  const s = (system ?? "").toLowerCase();
  const provider = s.includes("anthropic") || model.startsWith("claude") ? "anthropic" : s.includes("openai") || /^(gpt|o\d)/.test(model) ? "openai" : s || "unknown";
  return `${provider}/${model}`;
}

// ---------- Chat completion logs ----------

/** The start of a row in epoch ms. OpenAI's `created` field is in seconds. */
function absTime(row: Record<string, unknown>) {
  const res = (row.response as Record<string, unknown>) ?? {};
  const v = row.start ?? row.started_at ?? row.created ?? res.created;
  if (typeof v === "number") return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string") return Date.parse(v);
  return NaN;
}

function chatLines(rows: Record<string, unknown>[], fileName: string): Trace {
  if (!rows.length) throw new TraceError("Blackbox found no chat completion calls in this file.");
  const spans: Span[] = [];
  const firstTimed = rows.map(absTime).find((v) => Number.isFinite(v));
  let clock = firstTimed ?? 0;
  rows.forEach((row, i) => {
    const res = (row.response as Record<string, unknown>) ?? row;
    const usage = (res.usage ?? row.usage) as Record<string, unknown> | undefined;
    if (!usage) throw new TraceError(`Call ${i + 1} has no usage block, so Blackbox cannot count its tokens.`);
    const details = (usage.prompt_tokens_details ?? {}) as Record<string, number>;
    const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
    const cacheRead = Number(details.cached_tokens ?? usage.cache_read_input_tokens ?? 0);
    const cacheWrite = Number(details.cache_write_tokens ?? usage.cache_creation_input_tokens ?? 0);
    // OpenAI counts cached tokens inside prompt_tokens. Anthropic counts them outside input_tokens.
    const anthropicStyle = usage.input_tokens !== undefined && usage.prompt_tokens === undefined;
    const u: Usage = { input: anthropicStyle ? prompt : Math.max(0, prompt - cacheRead - cacheWrite), output: Number(usage.completion_tokens ?? usage.output_tokens ?? 0), cacheRead, cacheWrite };
    const start = absTime(row);
    const dur = Number(row.duration_ms ?? row.latency_ms ?? 1500) || 1500;
    // A row with no time follows the row before it.
    const s0 = Number.isFinite(start) ? start : clock;
    const choice = ((res.choices as Record<string, unknown>[]) ?? [])[0];
    const msg = (choice?.message ?? {}) as Record<string, unknown>;
    spans.push({
      id: String(row.id ?? res.id ?? `call-${i + 1}`) + `#${i}`,
      parentId: null,
      kind: "llm",
      name: String(row.name ?? `call ${i + 1}`),
      start: s0,
      end: s0 + dur,
      status: row.error ? "error" : "ok",
      error: row.error ? String(row.error) : undefined,
      model: normalizeModel(String(res.model ?? row.model ?? "unknown")),
      usage: u,
      recordedCost: typeof usage.cost === "number" ? usage.cost : undefined,
      input: (row.messages as Message[] | undefined)?.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })),
      output: { role: "assistant", content: String(msg.content ?? ""), toolCalls: (msg.tool_calls as { function: { name: string; arguments: string } }[] | undefined)?.map((c) => ({ name: c.function.name, args: jsonish(c.function.arguments) })) },
      tools: (row.tools as { function?: ToolDef }[] | undefined)?.map((t) => t.function ?? (t as ToolDef)),
    });
    clock = s0 + dur + 200;
  });
  let t0 = Infinity;
  for (const s of spans) if (s.start < t0) t0 = s.start;
  if (!Number.isFinite(t0)) t0 = 0;
  return finish({ id: fileName, title: fileName.replace(/\.[^.]+$/, ""), source: "openai", startedAt: new Date(Number.isFinite(t0) && t0 > 1e12 ? t0 : 0).toISOString(), spans });
}

// ---------- Agent session logs ----------

type Row = Record<string, unknown>;

/** Long text from a log is cut, so one file read by a tool cannot make every step heavy. */
const CLIP = 20_000;
const clip = (v: string) => (v.length > CLIP ? `${v.slice(0, CLIP)}\n[${(v.length - CLIP).toLocaleString("en-US")} more characters]` : v);
const stamp = (r: Row) => (typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN);
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const blocks = (c: unknown): Row[] => (Array.isArray(c) ? c.filter((b): b is Row => !!b && typeof b === "object") : typeof c === "string" ? [{ type: "text", text: c }] : []);

/** The readable text of content blocks: text parts as they are, images as a marker. */
function blockText(c: unknown): string {
  if (typeof c === "string") return c;
  return blocks(c)
    .map((b) => (typeof b.text === "string" ? b.text : b.type === "image" || b.type === "input_image" ? "[image]" : ""))
    .filter(Boolean)
    .join("\n");
}

/** A step name like the demos use: the tools a call asks for, or what it does with no tool. */
const stepName = (tools: string[], said: boolean) => (tools.length ? `plan → ${[...new Set(tools)].join(", ")}` : said ? "answer" : "think");

const isClaudeCodeRow = (r: Row) => (r.type === "assistant" || r.type === "user") && typeof r.sessionId === "string" && !!r.message && typeof r.message === "object";

/** A pause before a person's next message longer than this is idle time, not agent time. */
const IDLE_MS = 60_000;
/** What is left of an idle pause, so the turn boundary still shows on the timeline. */
const IDLE_KEEP = 1_000;

/**
 * Times for a session log with the idle pauses taken out. A long wait for the person's next
 * message is not part of the run, and over hours or days it would hide every call. Tool and model
 * time stay as recorded.
 */
function idleClock(events: Row[], isIdle: (prev: Row, next: Row) => boolean) {
  const at = new Map<Row, number>();
  let shift = 0;
  let removed = 0;
  let gaps = 0;
  let prev = NaN;
  let last: Row | null = null;
  for (const r of events) {
    const t = stamp(r);
    const gap = t - prev;
    if (last && Number.isFinite(gap) && gap > IDLE_MS && isIdle(last, r)) {
      shift += gap - IDLE_KEEP;
      removed += gap - IDLE_KEEP;
      gaps++;
    }
    at.set(r, t - shift);
    prev = t;
    last = r;
  }
  const hours = removed / 3_600_000;
  const note = gaps
    ? `Idle time while the session waited for a person is removed: ${gaps} ${gaps === 1 ? "pause" : "pauses"}, ${hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(removed / 60_000)} min`} in total. Tool and model time is as recorded.`
    : undefined;
  return { at: (r: Row) => at.get(r) ?? stamp(r), note };
}

/**
 * Claude Code writes one line per event. One API response is split over several "assistant"
 * lines that share message.id and repeat the same usage, and tool results can arrive between
 * those lines, so the lines are grouped by id across the whole file and the usage counts once.
 * Tool results come back in "user" lines, linked by tool_use_id. Lines with the model
 * "<synthetic>" are local notices, not API calls. Sub-agents write their own files, with
 * isSidechain and an agentId on each line; dropped together with the session, each one becomes
 * an agent under it.
 */
function claudeCode(rows: Row[], fileName: string): Trace {
  // Files dropped together arrive one after the other, so order by time.
  const events = rows
    .filter((r) => (r.type === "assistant" || r.type === "user") && Number.isFinite(stamp(r)))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => stamp(a.r) - stamp(b.r) || a.i - b.i)
    .map((e) => e.r);
  if (!events.length) throw new TraceError("This Claude Code log has no messages.");
  const isPrompt = (r: Row) => r.type === "user" && !r.isSidechain && !r.isMeta && blocks(rec(r.message).content).some((b) => b.type === "text");
  const { at, note } = idleClock(events, (_, next) => isPrompt(next));
  const t0 = at(events[0]);
  const named = rows.find((r) => r.type === "custom-title" && typeof r.customTitle === "string");
  const title = named ? String(named.customTitle) : fileName.replace(/\.[^.]+$/, "");
  const root: Span = { id: "session", parentId: null, kind: "agent", name: "Claude Code session", start: 0, end: 0, status: "ok" };
  const spans: Span[] = [root];

  // Each chain (the session, and each sub-agent) has its own conversation and its own clock.
  type Chain = { agent: Span; pending: Message[]; askedAt: number };
  const chains = new Map<string, Chain>();
  const chainOf = (r: Row): Chain => {
    const key = r.isSidechain ? `agent:${text(r.agentId) || "side"}` : "main";
    let c = chains.get(key);
    if (!c) {
      const agent = key === "main" ? root : { id: key, parentId: root.id, kind: "agent" as const, name: `sub-agent ${chains.size}`, start: Infinity, end: 0, status: "ok" as const };
      if (agent !== root) spans.push(agent);
      c = { agent, pending: [], askedAt: at(r) - t0 };
      chains.set(key, c);
    }
    return c;
  };

  const groups = new Map<string, Row[]>();
  const idOf = (r: Row) => text(rec(r.message).id) || text(r.requestId) || text(r.uuid);
  for (const r of events) {
    if (r.type !== "assistant") continue;
    const id = idOf(r);
    const g = groups.get(id);
    if (g) g.push(r);
    else groups.set(id, [r]);
  }

  const tools = new Map<string, Span>();
  const done = new Set<string>();
  for (const r of events) {
    const c = chainOf(r);
    const m = rec(r.message);
    if (r.type === "assistant") {
      const id = idOf(r);
      if (done.has(id)) continue;
      done.add(id);
      const g = groups.get(id) ?? [r];
      const model = text(m.model);
      if (!model || model === "<synthetic>") continue;
      const u = rec(m.usage);
      const said: string[] = [];
      const calls: { id: string; name: string; args: unknown }[] = [];
      let end = -Infinity;
      for (const line of g) {
        end = Math.max(end, at(line) - t0);
        for (const b of blocks(rec(line.message).content)) {
          if (b.type === "text" && typeof b.text === "string") said.push(b.text);
          if (b.type !== "tool_use") continue;
          const toolId = text(b.id);
          const name = text(b.name) || "tool";
          calls.push({ id: toolId, name, args: b.input ?? {} });
          const t = at(line) - t0;
          const tool: Span = { id: `tool:${toolId}`, parentId: c.agent.id, kind: "tool", name, start: t, end: t, status: "ok", tool: { name, args: b.input ?? {} } };
          tools.set(toolId, tool);
          spans.push(tool);
        }
      }
      const start = Math.min(c.askedAt, at(r) - t0);
      spans.push({
        id: `llm:${id}`,
        parentId: c.agent.id,
        kind: "llm",
        name: stepName(calls.map((x) => x.name), said.length > 0),
        start,
        end,
        status: "ok",
        model: normalizeModel(model, "anthropic"),
        usage: { input: count(u.input_tokens), output: count(u.output_tokens), cacheRead: count(u.cache_read_input_tokens), cacheWrite: count(u.cache_creation_input_tokens) },
        input: c.pending,
        output: { role: "assistant", content: clip(said.join("\n")), toolCalls: calls.length ? calls : undefined },
      });
      c.pending = [];
      c.askedAt = end;
      continue;
    }
    const t = at(r) - t0;
    for (const b of blocks(m.content)) {
      if (b.type === "tool_result") {
        const out = clip(blockText(b.content));
        const tool = tools.get(text(b.tool_use_id));
        if (tool) {
          tool.end = Math.max(tool.start, t);
          if (tool.tool) tool.tool.result = out;
          if (b.is_error === true) {
            tool.status = "error";
            tool.error = out.slice(0, 2000);
          }
        }
        c.pending.push({ role: "tool", name: tool?.name, content: out });
      } else if (b.type === "text" && typeof b.text === "string") {
        c.pending.push({ role: "user", content: clip(b.text) });
      }
    }
    c.askedAt = t;
  }
  if (!spans.some((x) => x.kind === "llm")) throw new TraceError("This Claude Code log has no API calls with token counts.");
  const agents = new Map(spans.filter((x) => x.kind === "agent").map((a) => [a.id, a]));
  for (const x of spans) {
    if (x.kind === "agent") continue;
    root.end = Math.max(root.end, x.end);
    const a = x.parentId ? agents.get(x.parentId) : undefined;
    if (a && a !== root) {
      a.start = Math.min(a.start, x.start);
      a.end = Math.max(a.end, x.end);
    }
  }
  return finish({ id: fileName, title, description: note, source: "claude-code", startedAt: new Date(stamp(events[0])).toISOString(), spans });
}

const isCodexRow = (r: Row) => (r.type === "session_meta" || r.type === "response_item" || r.type === "turn_context") && !!r.payload && typeof r.payload === "object";

/**
 * Codex writes one line per event, each { timestamp, type, payload }. A model response ends with
 * a usage record: "token_usage_record" in newer versions (one per response id), and an
 * "event_msg" of type "token_count" in all of them, which can repeat for rate-limit updates.
 * Tool calls ("function_call", "custom_tool_call") pair with their outputs by call_id.
 * OpenAI counts cached tokens inside input_tokens; Blackbox counts them apart.
 */
function codex(rows: Row[], fileName: string): Trace {
  const events = rows.filter((r) => Number.isFinite(stamp(r)));
  if (!events.length) throw new TraceError("This Codex log has no timed events.");
  const isPrompt = (r: Row) => {
    const p = rec(r.payload);
    return r.type === "response_item" && p.type === "message" && p.role === "user" && !blockText(p.content).trimStart().startsWith("<");
  };
  // Codex marks the end of each turn. A long gap after it, or before a person's message, is idle.
  const ended = (r: Row) => r.type === "event_msg" && (rec(r.payload).type === "task_complete" || rec(r.payload).type === "turn_aborted");
  const { at: clock, note } = idleClock(events, (prev, next) => ended(prev) || isPrompt(next));
  const t0 = clock(events[0]);
  const records = events.some((r) => r.type === "token_usage_record");
  const root: Span = { id: "session", parentId: null, kind: "agent", name: "Codex session", start: 0, end: 0, status: "ok" };
  const spans: Span[] = [root];
  const tools = new Map<string, Span>();
  const seen = new Set<string>();
  let model = "";
  let pending: Message[] = [];
  let askedAt = t0;
  let said: string[] = [];
  let calls: { id: string; name: string; args: unknown }[] = [];
  let lastTotal = -1;
  let n = 0;

  const close = (usage: Row, at: number, id: string) => {
    const cached = count(usage.cached_input_tokens);
    const written = count(usage.cache_write_input_tokens);
    const start = Math.min(askedAt, at) - t0;
    spans.push({
      id: `llm:${id || ++n}`,
      parentId: root.id,
      kind: "llm",
      name: stepName(calls.map((c) => c.name), said.length > 0),
      start,
      end: at - t0,
      status: "ok",
      model: model ? normalizeModel(model, "openai") : undefined,
      usage: { input: Math.max(0, count(usage.input_tokens) - cached - written), output: count(usage.output_tokens), cacheRead: cached, cacheWrite: written },
      input: pending,
      output: { role: "assistant", content: clip(said.join("\n")), toolCalls: calls.length ? calls : undefined },
    });
    pending = [];
    said = [];
    calls = [];
    askedAt = at;
  };

  for (const r of events) {
    const p = rec(r.payload);
    const at = clock(r);
    if (r.type === "turn_context" && typeof p.model === "string") model = p.model;
    if (r.type === "response_item") {
      if (p.type === "message") {
        const content = blockText(p.content);
        if (p.role === "assistant") said.push(content);
        else if (p.role === "user" && content.trim()) {
          pending.push({ role: "user", content: clip(content) });
          askedAt = at;
        }
      } else if (p.type === "function_call" || p.type === "custom_tool_call") {
        const id = text(p.call_id) || text(p.id);
        const name = text(p.name) || "tool";
        const args = p.type === "function_call" ? jsonish(p.arguments) : p.input;
        calls.push({ id, name, args });
        const tool: Span = { id: `tool:${id}`, parentId: root.id, kind: "tool", name, start: at - t0, end: at - t0, status: "ok", tool: { name, args } };
        tools.set(id, tool);
        spans.push(tool);
      } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
        const raw = p.output;
        const body = rec(jsonish(raw));
        const out = clip(typeof raw === "string" ? (typeof body.output === "string" ? body.output : raw) : blockText(raw) || text(raw));
        const tool = tools.get(text(p.call_id));
        if (tool) {
          tool.end = Math.max(tool.start, at - t0);
          if (tool.tool) tool.tool.result = out;
          const code = rec(body.metadata).exit_code;
          if (typeof code === "number" && code !== 0) {
            tool.status = "error";
            tool.error = `Exit code ${code}`;
          }
        }
        pending.push({ role: "tool", name: tool?.name, content: out });
        askedAt = at;
      }
    }
    if (records && r.type === "token_usage_record") {
      const id = text(p.response_id);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      close(rec(p.usage), at, id);
    }
    if (!records && r.type === "event_msg" && p.type === "token_count") {
      const info = rec(p.info);
      const total = num(rec(info.total_token_usage).total_tokens);
      // The same totals again are a rate-limit update, not a new response.
      if (!info.last_token_usage || total === lastTotal) continue;
      lastTotal = total;
      close(rec(info.last_token_usage), at, "");
    }
  }
  if (!spans.some((s) => s.kind === "llm")) throw new TraceError("This Codex log has no model responses with token counts.");
  for (const s of spans) root.end = Math.max(root.end, s.end);
  const meta = rec(events.find((r) => r.type === "session_meta")?.payload);
  // The first thing the person asked, not the context Codex injects: tagged blocks, and the IDE
  // context that ends with "## My request for Codex:".
  const asked = spans.flatMap((s) => (s.kind === "llm" ? (s.input ?? []) : [])).find((m) => m.role === "user" && !m.content.trimStart().startsWith("<"))?.content ?? "";
  const firstAsk = asked.split(/## My request for Codex:\s*/).pop() ?? "";
  const title = firstAsk ? firstAsk.replace(/\s+/g, " ").slice(0, 60) : text(meta.id) || fileName.replace(/\.[^.]+$/, "");
  return finish({ id: fileName, title, description: note, source: "codex", startedAt: new Date(stamp(events[0])).toISOString(), spans });
}
