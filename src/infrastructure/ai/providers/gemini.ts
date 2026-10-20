import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { env } from "../../../config/env.js";
import { getModelRate } from "../modelPricingCatalog.js";

type AIMessageConstructorParam = ConstructorParameters<typeof AIMessage>[0];
type ToolCallsArray = AIMessageConstructorParam extends { tool_calls?: infer T } ? T : never;

export function getGeminiPricing(
  modelName: string,
  now: Date | string = new Date(),
): { input: number | null; output: number | null } | null {
  try {
    const rates = getModelRate("gemini", modelName, now);
    return { input: rates.inputUsdPerMillion, output: rates.outputUsdPerMillion };
  } catch {
    return null;
  }
}

export interface ChatModelDefinition {
  id: string;
  name: string;
  description: string;
  access: "free_tier" | "restricted_tier" | "paid_tier";
  tier: "small" | "strong";
  enabled: boolean;
}

const CHAT_MODELS: ChatModelDefinition[] = [
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    description: "Recommended · fast, low-cost, free-tier eligible",
    access: "free_tier",
    tier: "small",
    enabled: true,
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    description: "Higher capability for complex tasks · free-tier eligible",
    access: "free_tier",
    tier: "strong",
    enabled: true,
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    description: "Balanced reasoning and speed · free-tier eligible",
    access: "free_tier",
    tier: "strong",
    enabled: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash-Lite",
    description: "Fast, capable, and cost-efficient · free-tier eligible",
    access: "free_tier",
    tier: "small",
    enabled: true,
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    description: "Legacy model · existing Gemini projects only · free-tier eligible",
    access: "free_tier",
    tier: "small",
    enabled: true,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Legacy reasoning model · existing Gemini projects only · free-tier eligible",
    access: "free_tier",
    tier: "strong",
    enabled: true,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "Higher-cost legacy model · unavailable in chat",
    access: "restricted_tier",
    tier: "strong",
    enabled: false,
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    description: "Paid model · unavailable in chat",
    access: "paid_tier",
    tier: "strong",
    enabled: false,
  },
];

const FREE_GEMINI_MODEL_IDS = new Set<string>(
  CHAT_MODELS.filter((model) => model.enabled && model.access === "free_tier").map(
    (model) => model.id,
  ),
);

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

function toLangChainMessages(messages: unknown[]): BaseMessage[] {
  return messages.map((msg) => {
    if (
      msg instanceof SystemMessage ||
      msg instanceof AIMessage ||
      msg instanceof HumanMessage ||
      msg instanceof ToolMessage
    ) {
      return msg;
    }
    const raw = msg as RawInputMessage;
    const { role, content, tool_calls, tool_call_id, name } = raw;
    const text = messageText(content);
    if (role === "system") return new SystemMessage(text);
    if (role === "tool")
      return new ToolMessage({
        content: text,
        tool_call_id: tool_call_id || "tc_0",
        name: name || "tool",
      });
    if (role === "assistant") {
      return new AIMessage({
        content: text,
        ...(Array.isArray(tool_calls) && tool_calls.length
          ? { tool_calls: tool_calls as ToolCallsArray }
          : {}),
      });
    }
    return new HumanMessage(text);
  });
}

export interface CreateModelOptions {
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  schema?: Record<string, unknown>;
  tools?: unknown[];
}

export interface InvokeOptions {
  signal?: AbortSignal;
}

export interface ModelInstance {
  invoke(messages: unknown[], options?: InvokeOptions): Promise<Record<string, unknown>>;
  stream(
    messages: unknown[],
    options?: InvokeOptions,
  ): AsyncGenerator<Record<string, unknown>, void, unknown>;
}

export function createGeminiModel({
  modelName,
  temperature,
  maxTokens,
  schema,
  tools,
}: CreateModelOptions): ModelInstance {
  if (!FREE_GEMINI_MODEL_IDS.has(modelName)) {
    throw new Error("Gemini model is not allowlisted for this product.");
  }
  const isGemini3Flash = /^gemini-3\.(?:6|8)-flash(?:$|-)/.test(modelName);
  let model: unknown = new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey: env.GEMINI_API_KEY,
    ...(isGemini3Flash ? {} : { temperature }),
    maxOutputTokens: maxTokens,
    maxRetries: 0,
  });

  const chatModel = model as ChatGoogleGenerativeAI;
  if (schema) {
    model = chatModel.withStructuredOutput(
      schema as Parameters<typeof chatModel.withStructuredOutput>[0],
      {
        includeRaw: true,
      },
    );
  } else if (
    Array.isArray(tools) &&
    tools.length > 0 &&
    typeof chatModel.bindTools === "function"
  ) {
    model = chatModel.bindTools(tools as Parameters<typeof chatModel.bindTools>[0]);
  }

  interface InvokableModel {
    invoke(
      messages: BaseMessage[],
      options?: { signal?: AbortSignal },
    ): Promise<{
      content?: unknown;
      tool_calls?: unknown[];
      usage_metadata?: { input_tokens?: number; output_tokens?: number };
      raw?: { usage_metadata?: { input_tokens?: number; output_tokens?: number } };
      parsed?: Record<string, unknown>;
    }>;
    stream(
      messages: BaseMessage[],
      options?: { signal?: AbortSignal },
    ): Promise<
      AsyncIterable<{
        content?: unknown;
        tool_calls?: unknown[];
        usage_metadata?: { input_tokens?: number; output_tokens?: number };
      }>
    >;
  }

  const runnable = model as InvokableModel;

  return {
    async invoke(
      messages: unknown[],
      options: InvokeOptions = {},
    ): Promise<Record<string, unknown>> {
      const invocationOptions = options?.signal ? { signal: options.signal } : {};
      const result = await runnable.invoke(toLangChainMessages(messages), invocationOptions);
      if (schema) {
        const raw = result.raw;
        return {
          ...(result.parsed || {}),
          response_metadata: {
            usage: {
              input_tokens: raw?.usage_metadata?.input_tokens || 0,
              output_tokens: raw?.usage_metadata?.output_tokens || 0,
            },
          },
        };
      }
      return {
        content: typeof result.content === "string" ? result.content : messageText(result.content),
        tool_calls: Array.isArray(result.tool_calls) ? result.tool_calls : [],
        response_metadata: {
          usage: {
            input_tokens: result.usage_metadata?.input_tokens || 0,
            output_tokens: result.usage_metadata?.output_tokens || 0,
          },
        },
      };
    },
    async *stream(
      messages: unknown[],
      options: InvokeOptions = {},
    ): AsyncGenerator<Record<string, unknown>, void, unknown> {
      const invocationOptions = options?.signal ? { signal: options.signal } : {};
      const chunks = await runnable.stream(toLangChainMessages(messages), invocationOptions);
      for await (const chunk of chunks) {
        yield {
          content: typeof chunk.content === "string" ? chunk.content : messageText(chunk.content),
          tool_calls: Array.isArray(chunk.tool_calls) ? chunk.tool_calls : undefined,
          usage_metadata: chunk.usage_metadata || {},
        };
      }
    },
  };
}

export interface UsageOptions {
  at?: Date | string;
  cachedInputTokens?: number;
  cacheReadTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export function estimateGeminiCost(modelName: string, usage: UsageOptions = {}): number {
  const rates = getModelRate("gemini", modelName, usage.at || new Date());
  const cached = usage.cachedInputTokens ?? usage.cacheReadTokens ?? 0;
  const regularInput = Math.max(0, (usage.inputTokens || 0) - cached);
  const cachedRate = rates.cachedInputUsdPerMillion ?? rates.inputUsdPerMillion ?? 0;
  const inputRate = rates.inputUsdPerMillion ?? 0;
  const outputRate = rates.outputUsdPerMillion ?? 0;
  return (
    (regularInput * inputRate + cached * cachedRate + (usage.outputTokens || 0) * outputRate) /
    1_000_000
  );
}

export const geminiProvider = {
  id: "gemini",
  isConfigured: (): boolean => Boolean(env.GEMINI_API_KEY),
  modelForTier: (tier: string): string =>
    tier === "strong" ? env.GEMINI_MODEL_STRONG : env.GEMINI_MODEL_SMALL,
  createModel: createGeminiModel,
  estimateCostUsd: estimateGeminiCost,
  chatModels: CHAT_MODELS,
};
