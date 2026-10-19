import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { env } from "../../config/env.js";
import { getModelRate } from "../modelPricingCatalog.js";
import { CreateModelOptions, InvokeOptions, ModelInstance } from "./gemini.js";

type AIMessageConstructorParam = ConstructorParameters<typeof AIMessage>[0];
type ToolCallsArray = AIMessageConstructorParam extends { tool_calls?: infer T } ? T : never;

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const partObj = part as { text?: string };
      return partObj?.text || "";
    })
    .filter(Boolean)
    .join("\n");
}

interface RawInputMessage {
  role?: string;
  content?: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export function toGroqMessages(messages: unknown[]): BaseMessage[] {
  const normalized: BaseMessage[] = [];
  const systemInstructions: string[] = [];
  for (const msg of messages) {
    if (msg instanceof AIMessage || msg instanceof HumanMessage || msg instanceof ToolMessage) {
      normalized.push(msg);
      continue;
    }
    const raw = msg as RawInputMessage;
    const { role, content, tool_calls, tool_call_id, name } = raw;
    const text = messageText(content);
    if (role === "system") {
      systemInstructions.push(text);
    } else if (role === "tool") {
      normalized.push(
        new ToolMessage({
          content: text,
          tool_call_id: tool_call_id || "tc_0",
          name: name || "tool",
        }),
      );
    } else if (role === "assistant") {
      normalized.push(
        new AIMessage({
          content: text,
          ...(Array.isArray(tool_calls) && tool_calls.length ? { tool_calls: tool_calls as ToolCallsArray } : {}),
        }),
      );
    } else {
      const contentWithInstructions = systemInstructions.length
        ? `JobScout instructions and user context:\n${systemInstructions.join("\n\n")}\n\nCurrent user message:\n${text}`
        : text;
      normalized.push(new HumanMessage(contentWithInstructions));
      systemInstructions.length = 0;
    }
  }
  if (systemInstructions.length) {
    normalized.unshift(
      new HumanMessage(
        `JobScout instructions and user context:\n${systemInstructions.join("\n\n")}`,
      ),
    );
  }
  return normalized;
}

interface UsageMetaResult {
  usage_metadata?: { input_tokens?: number; output_tokens?: number };
  response_metadata?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } };
}

function usageOf(result: unknown): { input_tokens: number; output_tokens: number } {
  const r = result as UsageMetaResult;
  const usage = r?.usage_metadata || {};
  const tokenUsage = r?.response_metadata?.tokenUsage || {};
  return {
    input_tokens: usage.input_tokens ?? tokenUsage.promptTokens ?? 0,
    output_tokens: usage.output_tokens ?? tokenUsage.completionTokens ?? 0,
  };
}

/** LangChain adapter for Groq's OpenAI-compatible Chat Completions API. */
export function createGroqModel({
  modelName,
  temperature,
  maxTokens,
  schema,
  tools,
}: CreateModelOptions): ModelInstance {
  let model: unknown = new ChatOpenAI({
    modelName,
    apiKey: env.GROQ_API_KEY,
    temperature,
    maxTokens,
    maxRetries: 0,
    streamUsage: true,
    configuration: { baseURL: GROQ_BASE_URL },
  });

  const chatModel = model as ChatOpenAI;
  if (schema) {
    model = chatModel.withStructuredOutput(schema as Parameters<typeof chatModel.withStructuredOutput>[0], {
      includeRaw: true,
    });
  } else if (Array.isArray(tools) && tools.length > 0 && typeof chatModel.bindTools === "function") {
    model = chatModel.bindTools(tools as Parameters<typeof chatModel.bindTools>[0]);
  }

  interface InvokableModel {
    invoke(messages: BaseMessage[], options?: { signal?: AbortSignal }): Promise<{
      content?: unknown;
      tool_calls?: unknown[];
      raw?: unknown;
      parsed?: Record<string, unknown>;
      usage_metadata?: { input_tokens?: number; output_tokens?: number };
      response_metadata?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } };
    }>;
    stream(messages: BaseMessage[], options?: { signal?: AbortSignal }): Promise<AsyncIterable<{
      content?: unknown;
      tool_calls?: unknown[];
      usage_metadata?: { input_tokens?: number; output_tokens?: number };
    }>>;
  }

  const runnable = model as InvokableModel;

  return {
    async invoke(messages: unknown[], options: InvokeOptions = {}): Promise<Record<string, unknown>> {
      const invocationOptions = options?.signal ? { signal: options.signal } : {};
      const result = await runnable.invoke(toGroqMessages(messages), invocationOptions);
      if (schema) {
        const raw = result.raw;
        return { ...(result.parsed || {}), response_metadata: { usage: usageOf(raw) } };
      }
      return {
        content: messageText(result.content),
        tool_calls: Array.isArray(result.tool_calls) ? result.tool_calls : [],
        response_metadata: { usage: usageOf(result) },
      };
    },
    async *stream(messages: unknown[], options: InvokeOptions = {}): AsyncGenerator<Record<string, unknown>, void, unknown> {
      const invocationOptions = options?.signal ? { signal: options.signal } : {};
      const chunks = await runnable.stream(toGroqMessages(messages), invocationOptions);
      for await (const chunk of chunks) {
        yield {
          content: messageText(chunk.content),
          tool_calls: Array.isArray(chunk.tool_calls) ? chunk.tool_calls : undefined,
          usage_metadata: {
            input_tokens: chunk.usage_metadata?.input_tokens ?? 0,
            output_tokens: chunk.usage_metadata?.output_tokens ?? 0,
          },
        };
      }
    },
  };
}

export function estimateGroqCost(
  modelName: string,
  { inputTokens = 0, outputTokens = 0, cachedInputTokens = 0 } = {},
): number {
  const rates = getModelRate("groq", modelName);
  const regularInput = Math.max(0, inputTokens - cachedInputTokens);
  const cachedRate = rates.cachedInputUsdPerMillion ?? rates.inputUsdPerMillion ?? 0;
  const inputRate = rates.inputUsdPerMillion ?? 0;
  const outputRate = rates.outputUsdPerMillion ?? 0;
  return (
    (regularInput * inputRate +
      cachedInputTokens * cachedRate +
      outputTokens * outputRate) /
    1_000_000
  );
}

export const groqProvider = {
  id: "groq",
  isConfigured: (): boolean => Boolean(env.GROQ_API_KEY),
  modelForTier: (tier: string): string => (tier === "strong" ? env.GROQ_MODEL_STRONG : env.GROQ_MODEL_SMALL),
  createModel: createGroqModel,
  estimateCostUsd: estimateGroqCost,
  chatModels: [
    {
      id: "openai/gpt-oss-20b",
      name: "Groq · GPT OSS 20B",
      description: "Fast and cost-efficient · Free plan eligible, rate limits apply",
      access: "free_tier" as const,
      tier: "small" as const,
      enabled: true,
    },
    {
      id: "openai/gpt-oss-120b",
      name: "Groq · GPT OSS 120B",
      description: "Higher capability · Free plan eligible, rate limits apply",
      access: "free_tier" as const,
      tier: "strong" as const,
      enabled: true,
    },
  ],
};
