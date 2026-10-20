export interface ChatStreamRoutingDecision {
  tier?: number;
  intent?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface ChatStreamChunk {
  text?: string;
  done?: boolean;
  latencyMs?: number;
  firstTokenLatencyMs?: number | null;
  usage?: unknown;
}

export interface ChatStreamEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Keep the wire contract and event order explicit and easy to test. */
export async function* chatStreamEvents({
  decision,
  modelId,
  chunks,
  cacheHit = false,
}: {
  decision?: ChatStreamRoutingDecision | null;
  modelId?: string | null;
  chunks: AsyncIterable<ChatStreamChunk> | Iterable<ChatStreamChunk>;
  cacheHit?: boolean;
}): AsyncGenerator<ChatStreamEvent, void, unknown> {
  yield {
    event: "routing",
    data: {
      tier: decision?.tier || 1,
      intent: decision?.intent || "chat_simple",
      confidence: decision?.confidence || 0.5,
      model: modelId,
    },
  };
  yield { event: "status", data: { status: "Putting your career context together…" } };
  yield { event: "status", data: { status: "Thinking through your question…" } };
  for await (const chunk of chunks) {
    if (chunk?.text) yield { event: "token", data: { text: chunk.text } };
    if (chunk?.done) {
      yield {
        event: "done",
        data: {
          finishReason: "stop",
          tier: decision?.tier || 1,
          route: decision?.intent || "chat_simple",
          model: modelId,
          cacheHit,
          latencyMs: chunk.latencyMs,
          firstTokenLatencyMs: chunk.firstTokenLatencyMs,
          usage: chunk.usage,
        },
      };
    }
  }
}
