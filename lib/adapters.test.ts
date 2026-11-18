import { expect, test } from "bun:test";
import snapshot from "../data/models.snapshot.json";
import { parseTrace } from "./adapters";
import { allOn, priceMap, traceCost } from "./cost";
import { combinedSaving } from "./findings";
import type { Model } from "./types";

const prices = priceMap(snapshot.models as Model[]);
const a = (key: string, v: string | number) => ({ key, value: typeof v === "string" ? { stringValue: v } : { intValue: String(v) } });

test("reads OpenTelemetry GenAI spans and counts cached tokens apart", () => {
  const otlp = {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              { spanId: "a", name: "invoke_agent", startTimeUnixNano: "1000000000", endTimeUnixNano: "9000000000", attributes: [a("gen_ai.operation.name", "invoke_agent"), a("gen_ai.agent.name", "triage")] },
              {
                spanId: "b",
                parentSpanId: "a",
                name: "chat claude-sonnet-5.5",
                startTimeUnixNano: "1500000000",
                endTimeUnixNano: "3500000000",
                attributes: [a("gen_ai.operation.name", "chat"), a("gen_ai.system", "anthropic"), a("gen_ai.request.model", "claude-sonnet-5.5"), a("gen_ai.usage.input_tokens", 12000), a("gen_ai.usage.output_tokens", 300), a("gen_ai.usage.cache_read.input_tokens", 10000)],
              },
              { spanId: "c", parentSpanId: "a", name: "execute_tool", startTimeUnixNano: "3600000000", endTimeUnixNano: "4000000000", attributes: [a("gen_ai.operation.name", "execute_tool"), a("gen_ai.tool.name", "search"), a("gen_ai.tool.call.arguments", '{"q":"x"}')], status: { code: 2, message: "timeout" } },
            ],
          },
        ],
      },
    ],
  };
  const t = parseTrace(JSON.stringify(otlp), "run.json");
  expect(t.spans.map((s) => s.kind)).toEqual(["agent", "llm", "tool"]);
  const llm = t.spans[1];
  expect(llm.model).toBe("anthropic/claude-sonnet-5.5");
  expect(llm.usage).toEqual({ input: 2000, output: 300, cacheRead: 10000, cacheWrite: 0 });
  expect(llm.start).toBe(500);
  expect(t.spans[2].status).toBe("error");
  expect(t.spans[2].tool?.args).toEqual({ q: "x" });
});

test("reads JSON lines of OpenAI-style calls, with cached tokens inside prompt_tokens", () => {
  const line = (cached: number) =>
    JSON.stringify({ model: "openai/gpt-5.6-sol", messages: [{ role: "user", content: "hi" }], response: { usage: { prompt_tokens: 5000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: cached } }, choices: [{ message: { content: "ok" } }] }, duration_ms: 900 });
  const t = parseTrace([line(0), line(4000)].join("\n"), "calls.jsonl");
  expect(t.spans).toHaveLength(2);
  expect(t.spans[1].usage).toEqual({ input: 1000, output: 100, cacheRead: 4000, cacheWrite: 0 });
  expect(t.spans[1].start).toBeGreaterThan(t.spans[0].end - 1);
  // Re-pricing on the same model is the same cost.
  expect(traceCost(t, prices, allOn(t, "openai/gpt-5.6-sol"))).toBeCloseTo(traceCost(t, prices), 12);
});

test("a file Blackbox cannot read gives a clear message", () => {
  expect(() => parseTrace("not json\nat all", "x.txt")).toThrow(/Line 1 is not valid JSON/);
});

test("combined saving never exceeds the run and is below the plain sum", () => {
  const f = (saving: number) => ({ id: "x", kind: "cache" as const, title: "", detail: "", saving, spans: [] });
  const s = combinedSaving([f(0.25), f(0.06), f(0.04)], 0.3);
  expect(s).toBeLessThan(0.3);
  expect(s).toBeLessThan(0.35);
  expect(s).toBeGreaterThan(0.25);
});

// Hostile files from the break-UI review. Each one crashed the page or showed an impossible number.
const native = (spans: unknown[]) => JSON.stringify({ blackbox: 1, title: "hostile", spans });
const llm = (extra: Record<string, unknown>) => ({ kind: "llm", name: "call", start: 0, end: 1000, model: "acme/x", usage: { input: 100, output: 10 }, ...extra });

test("ids that are keys of every object get a prefix", () => {
  const t = parseTrace(native([llm({ id: "constructor" }), llm({ id: "__proto__", parentId: "constructor" }), llm({ id: "toString" })]));
  expect(t.spans.map((s) => s.id)).toEqual(["span:constructor", "span:__proto__", "span:toString"]);
  expect(t.spans[1].parentId).toBe("span:constructor");
});

test("recorded costs must be finite and not negative", () => {
  const t = parseTrace(native([llm({ id: "a", recordedCost: "0.4" }), llm({ id: "b", recordedCost: -5 }), llm({ id: "c", recordedCost: "Infinity" })]));
  expect(t.spans.map((s) => s.recordedCost)).toEqual([0.4, undefined, undefined]);
});

test("Infinity and text in counts and times become 0", () => {
  const t = parseTrace(native([llm({ id: "a", start: "-Infinity", end: 1e999, usage: { input: "Infinity", output: "lots" } })]));
  const s = t.spans[0];
  expect([s.start, s.end, s.usage!.input, s.usage!.output]).toEqual([0, 0, 0, 0]);
});

test("objects in text fields become text, never objects in the page", () => {
  const t = parseTrace(native([llm({ id: "a", status: "error", error: { message: "boom" }, input: "hi", output: { role: "assistant", content: { text: "x" } } })]));
  const s = t.spans[0];
  expect(s.error).toBe('{"message":"boom"}');
  expect(s.input).toEqual([{ role: "user", content: "hi" }]);
  expect(s.output?.content).toBe('{"text":"x"}');
});

test("a plain value or a null line gets a clear error", () => {
  expect(() => parseTrace("null")).toThrow("one plain value");
  expect(() => parseTrace('{"model":"a","usage":{}}\nnull')).toThrow("not a JSON object");
});

test("250,000 spans parse without a stack overflow", () => {
  const spans = Array.from({ length: 250_000 }, (_, i) => ({ id: `s${i}`, kind: "tool", name: "t", start: i, end: i + 1 }));
  expect(parseTrace(native(spans)).spans.length).toBe(250_000);
});

// ---------- Session logs. Content is invented; only the shapes follow the real files. ----------

const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");
const at = (s: number) => new Date(Date.UTC(2026, 10, 18, 9, 0, 0) + s * 1000).toISOString();
const cc = (type: "user" | "assistant", s: number, message: object, extra: object = {}) => ({ type, sessionId: "s1", uuid: `${type}-${s}`, timestamp: at(s), message, ...extra });
const usage = { input_tokens: 12, cache_read_input_tokens: 9000, cache_creation_input_tokens: 400, output_tokens: 80 };

test("Claude Code: one API call split by a tool result counts its usage once", () => {
  const t = parseTrace(
    jsonl([
      cc("user", 0, { role: "user", content: "Find the flaky test." }),
      cc("assistant", 3, { id: "m1", model: "claude-fable-5-2", usage, content: [{ type: "thinking", thinking: "…" }] }, { requestId: "r1" }),
      cc("assistant", 4, { id: "m1", model: "claude-fable-5-2", usage, content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } }] }, { requestId: "r1" }),
      cc("user", 5, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file text" }] }),
      cc("assistant", 6, { id: "m1", model: "claude-fable-5-2", usage, content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "bun test" } }] }, { requestId: "r1" }),
      cc("user", 9, { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "1 fail", is_error: true }] }),
      cc("assistant", 12, { id: "m2", model: "claude-fable-5-2", usage: { ...usage, output_tokens: 30 }, content: [{ type: "text", text: "The test races a timer." }] }, { requestId: "r2" }),
      cc("assistant", 13, { id: "m3", model: "<synthetic>", usage: {}, content: [{ type: "text", text: "notice" }] }),
    ]),
    "session.jsonl",
  );
  const llm = t.spans.filter((s) => s.kind === "llm");
  expect(t.source).toBe("claude-code");
  expect(llm.length).toBe(2);
  expect(llm[0].usage).toEqual({ input: 12, output: 80, cacheRead: 9000, cacheWrite: 400 });
  expect(llm[0].model).toBe("anthropic/claude-fable-5.2");
  expect(llm[0].name).toBe("plan → Read, Bash");
  expect(llm[1].name).toBe("answer");
  // The second call starts when the last tool result came back.
  expect(llm[1].start).toBe(9000);
  const bash = t.spans.find((s) => s.name === "Bash")!;
  expect([bash.start, bash.end, bash.status]).toEqual([6000, 9000, "error"]);
  // Both tool results go to the next request.
  expect(llm[1].input?.map((m) => m.role)).toEqual(["tool", "tool"]);
});

test("Claude Code: idle time before a person's message is removed and described", () => {
  const t = parseTrace(
    jsonl([
      cc("user", 0, { role: "user", content: "One" }),
      cc("assistant", 2, { id: "a", model: "claude-opus-5-5", usage, content: [{ type: "text", text: "ok" }] }),
      cc("user", 2 + 3 * 3600, { role: "user", content: "Two, three hours later" }),
      cc("assistant", 2 + 3 * 3600 + 4, { id: "b", model: "claude-opus-5-5", usage, content: [{ type: "text", text: "ok" }] }),
    ]),
  );
  const llm = t.spans.filter((s) => s.kind === "llm");
  expect(llm[1].start).toBe(3000);
  expect(llm[1].end).toBe(7000);
  expect(t.description).toContain("1 pause");
});

test("Claude Code: sub-agent logs opened with the session become agents under it", () => {
  const t = parseTrace(
    jsonl([
      cc("user", 0, { role: "user", content: "Review this." }),
      cc("assistant", 1, { id: "a", model: "claude-opus-5-5", usage, content: [{ type: "tool_use", id: "task", name: "Agent", input: {} }] }),
      cc("assistant", 3, { id: "sub1", model: "claude-haiku-5-5", usage, content: [{ type: "text", text: "found 2" }] }, { isSidechain: true, agentId: "x1" }),
      cc("user", 4, { role: "user", content: [{ type: "tool_result", tool_use_id: "task", content: "found 2" }] }),
    ]),
  );
  const agent = t.spans.find((s) => s.kind === "agent" && s.name === "sub-agent 1")!;
  expect(agent).toBeDefined();
  expect(t.spans.find((s) => s.id === "llm:sub1")?.parentId).toBe(agent.id);
});

const cx = (type: string, s: number, payload: object) => ({ timestamp: at(s), type, payload });
const tu = (input: number, cached: number, output: number) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output });

test("Codex: usage records end each response; cached tokens count apart", () => {
  const t = parseTrace(
    jsonl([
      cx("session_meta", 0, { id: "sess" }),
      cx("turn_context", 0, { model: "gpt-5.6-sol" }),
      cx("response_item", 0, { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>…</environment_context>" }] }),
      cx("response_item", 1, { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the build" }] }),
      cx("response_item", 3, { type: "function_call", name: "exec_command", arguments: '{"cmd":"bun run build"}', call_id: "c1" }),
      cx("token_usage_record", 3, { response_id: "r1", usage: tu(5000, 4000, 50) }),
      cx("token_usage_record", 3, { response_id: "r1", usage: tu(5000, 4000, 50) }),
      cx("response_item", 8, { type: "function_call_output", call_id: "c1", output: '{"output":"error TS2304","metadata":{"exit_code":2}}' }),
      cx("response_item", 10, { type: "message", role: "assistant", content: [{ type: "output_text", text: "Fixed." }] }),
      cx("token_usage_record", 10, { response_id: "r2", usage: tu(6000, 5000, 20) }),
    ]),
  );
  const llm = t.spans.filter((s) => s.kind === "llm");
  expect(t.source).toBe("codex");
  expect(t.title).toBe("Fix the build");
  expect(llm.length).toBe(2);
  expect(llm[0].usage).toEqual({ input: 1000, output: 50, cacheRead: 4000, cacheWrite: 0 });
  expect(llm[0].model).toBe("openai/gpt-5.6-sol");
  expect(llm[0].name).toBe("plan → exec_command");
  const tool = t.spans.find((s) => s.kind === "tool")!;
  expect([tool.start, tool.end, tool.status, tool.tool?.result]).toEqual([3000, 8000, "error", "error TS2304"]);
  expect(llm[1].start).toBe(8000);
});

test("Codex: older logs repeat token_count events; a repeat is not a new response", () => {
  const tc = (s: number, total: number) => cx("event_msg", s, { type: "token_count", info: { last_token_usage: tu(100, 0, 10), total_token_usage: { total_tokens: total } } });
  const t = parseTrace(jsonl([cx("turn_context", 0, { model: "gpt-5.1-codex" }), cx("response_item", 0, { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }), tc(2, 110), tc(2, 110), tc(5, 220)]));
  expect(t.spans.filter((s) => s.kind === "llm").length).toBe(2);
});

test("Codex: a long gap after a finished turn is idle, and the title is the person's request", () => {
  const ask = (s: number, text: string) => cx("response_item", s, { type: "message", role: "user", content: [{ type: "input_text", text }] });
  const t = parseTrace(
    jsonl([
      cx("turn_context", 0, { model: "gpt-5.6-sol" }),
      ask(0, "# Context from my IDE setup:\n\n## Active file: a.ts\n\n## My request for Codex:\nRename the flag"),
      cx("token_usage_record", 4, { response_id: "r1", usage: tu(100, 0, 10) }),
      cx("event_msg", 5, { type: "task_complete" }),
      cx("event_msg", 5 + 7200, { type: "thread_settings_applied" }),
      ask(5 + 7201, "Now the tests"),
      cx("token_usage_record", 5 + 7205, { response_id: "r2", usage: tu(200, 100, 10) }),
    ]),
  );
  expect(t.title).toBe("Rename the flag");
  const llm = t.spans.filter((s) => s.kind === "llm");
  expect(llm[1].end - llm[0].end).toBeLessThan(10_000);
  expect(t.description).toContain("1 pause");
});
