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
