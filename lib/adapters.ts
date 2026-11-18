// Converts trace files to the Blackbox format. Everything runs in the browser: no upload.
//
// Supported:
//   - Blackbox JSON: { "blackbox": 1, ...Trace }
//   - OpenTelemetry OTLP JSON with GenAI semantic conventions (gen_ai.*),
//     plus the common OpenInference keys (llm.*, tool.*).
//   - JSON lines of chat completion calls, one call per line, in the OpenAI or OpenRouter shape:
//     { "model", "messages", "tools"?, "response": { "usage", "choices" }, "start"?, "duration_ms"? }
//     A bare response object per line ({ "model", "usage", "choices" }) also works.

import type { Message, Span, SpanKind, ToolDef, Trace, Usage } from "./types";

export class TraceError extends Error {}

export function parseTrace(text: string, fileName = "trace"): Trace {
  const trimmed = text.trim();
  if (!trimmed) throw new TraceError("The file is empty.");
  let doc: unknown = null;
  try {
    doc = JSON.parse(trimmed);
  } catch {
    // Not one JSON document: try JSON lines.
  }
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const o = doc as Record<string, unknown>;
    if ("blackbox" in o) return native(o, fileName);
    if ("resourceSpans" in o) return otel(o, fileName);
    if ("choices" in o || "messages" in o) return chatLines([o], fileName);
    throw new TraceError("Blackbox does not know this file shape. It reads OpenTelemetry JSON, Blackbox JSON, or JSON lines of chat calls.");
  }
  if (Array.isArray(doc)) return chatLines(doc as Record<string, unknown>[], fileName);
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
  if (rows.length && rows.every((r) => "resourceSpans" in r)) {
    const merged = { resourceSpans: rows.flatMap((r) => r.resourceSpans as unknown[]) };
    return otel(merged, fileName);
  }
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

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const MAX_DURATION = 7 * 24 * 3600 * 1000;

/**
 * The last step for every adapter: every span gets valid fields, so no file can crash the UI.
 * Times become finite and ordered, usage counts become numbers, ids become unique strings.
 */
export function finish(t: Trace): Trace {
  const seen = new Set<string>();
  const spans: Span[] = t.spans.map((raw, i) => {
    const s = (raw ?? {}) as Partial<Span>;
    let id = String(s.id ?? `span-${i}`);
    while (seen.has(id)) id = `${id}#${i}`;
    seen.add(id);
    const a = num(s.start);
    const b = num(s.end);
    const kind: SpanKind = s.kind === "llm" || s.kind === "tool" || s.kind === "retrieval" || s.kind === "agent" ? s.kind : "agent";
    const span: Span = { ...s, id, parentId: s.parentId ? String(s.parentId) : null, kind, name: String(s.name ?? s.tool?.name ?? kind), start: Math.min(a, b), end: Math.max(a, b), status: s.status === "error" ? "error" : "ok" };
    if (kind === "llm") {
      const u = (s.usage ?? {}) as Partial<Usage>;
      span.usage = { input: Math.max(0, num(u.input)), output: Math.max(0, num(u.output)), cacheRead: Math.max(0, num(u.cacheRead)), cacheWrite: Math.max(0, num(u.cacheWrite)) };
      if (typeof s.model !== "string" || !s.model) span.model = undefined;
    }
    return span;
  });
  const t0 = spans.length ? Math.min(...spans.map((s) => s.start)) : 0;
  for (const s of spans) {
    s.start -= t0;
    s.end -= t0;
  }
  const duration = Math.max(0, ...spans.map((s) => s.end));
  if (duration > MAX_DURATION) throw new TraceError("This trace is longer than 7 days. Its timestamps use mixed units, or a unit that Blackbox does not read. Blackbox reads milliseconds, or seconds for OpenAI's created field.");
  return { ...t, spans };
}

// ---------- OpenTelemetry ----------

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
  const t0 = Math.min(...spans.map((s) => Number(BigInt(s.startTimeUnixNano) / BigInt(1e6))));
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
    const start = Number(BigInt(s.startTimeUnixNano) / BigInt(1e6)) - t0;
    const end = Number(BigInt(s.endTimeUnixNano) / BigInt(1e6)) - t0;
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
  const t0 = Math.min(...spans.map((s) => s.start));
  return finish({ id: fileName, title: fileName.replace(/\.[^.]+$/, ""), source: "openai", startedAt: new Date(Number.isFinite(t0) && t0 > 1e12 ? t0 : 0).toISOString(), spans });
}
