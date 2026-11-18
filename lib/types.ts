// The one trace format inside Blackbox. Every adapter converts to it.

/**
 * Token counts for one LLM call. The four counts never overlap:
 * total prompt tokens = input + cacheRead + cacheWrite.
 */
export type Usage = {
  /** Prompt tokens billed at the normal input price. */
  input: number;
  output: number;
  /** Prompt tokens served from the provider's prompt cache. */
  cacheRead: number;
  /** Prompt tokens written to the prompt cache on this call. */
  cacheWrite: number;
};

export type ToolCall = { id?: string; name: string; args: unknown };

export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
};

export type ToolDef = { name: string; description?: string; parameters?: unknown };

export type SpanKind = "agent" | "llm" | "tool" | "retrieval";

export type Span = {
  id: string;
  parentId: string | null;
  kind: SpanKind;
  name: string;
  /** Milliseconds from the start of the trace. */
  start: number;
  end: number;
  status: "ok" | "error";
  error?: string;
  /** OpenRouter-style model id, for example "anthropic/claude-sonnet-5.5". */
  model?: string;
  usage?: Usage;
  /** Cost the source recorded, in USD, when it has one. */
  recordedCost?: number;
  input?: Message[];
  output?: Message;
  tools?: ToolDef[];
  tool?: { name: string; args: unknown; result?: unknown };
};

export type Trace = {
  id: string;
  title: string;
  description?: string;
  source: "demo" | "otel" | "openai" | "blackbox" | "claude-code" | "codex";
  startedAt: string;
  spans: Span[];
};

export type Model = {
  id: string;
  /** OpenRouter's canonical slug, which can carry a date. Usage rankings use it. */
  slug?: string;
  name: string;
  created: number;
  context: number;
  /** USD per token. */
  prompt: number;
  completion: number;
  cacheRead: number | null;
  cacheWrite: number | null;
};
