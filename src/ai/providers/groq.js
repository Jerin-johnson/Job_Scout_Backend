import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { env } from "../../config/env.js";
import { getModelRate } from "../modelPricingCatalog.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) => (typeof part === "string" ? part : part?.text || ""))
    .filter(Boolean)
    .join("\n");
}

export function toGroqMessages(messages) {
  const normalized = [];
  const systemInstructions = [];
  for (const msg of messages) {
    if (msg instanceof AIMessage || msg instanceof HumanMessage || msg instanceof ToolMessage) {
      normalized.push(msg);
      continue;
    }
    const { role, content, tool_calls, tool_call_id, name } = msg;
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
          ...(Array.isArray(tool_calls) && tool_calls.length ? { tool_calls } : {}),
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

function usageOf(result) {
  const usage = result?.usage_metadata || {};
  const tokenUsage = result?.response_metadata?.tokenUsage || {};
  return {
    input_tokens: usage.input_tokens ?? tokenUsage.promptTokens ?? 0,
    output_tokens: usage.output_tokens ?? tokenUsage.completionTokens ?? 0,
  };
}

/** LangChain adapter for Groq's OpenAI-compatible Chat Completions API. */
export function createGroqModel({ modelName, temperature, maxTokens, schema, tools }) {
  let model = new ChatOpenAI({
    modelName,
    apiKey: env.GROQ_API_KEY,
    temperature,
    maxTokens,
    maxRetries: 0,
    streamUsage: true,
    configuration: { baseURL: GROQ_BASE_URL },
  });
  if (schema) model = model.withStructuredOutput(schema, { includeRaw: true });
  else if (Array.isArray(tools) && tools.length > 0 && typeof model.bindTools === "function") {
    model = model.bindTools(tools);
  }

  return {
    async invoke(messages, options = {}) {
      const invocationOptions = options?.signal ? { signal: options.signal } : {};
      const result = await model.invoke(toGroqMessages(messages), invocationOptions);
      if (schema) {
        const raw = result.raw;
        return { ...result.parsed, response_metadata: { usage: usageOf(raw) } };
      }
      return {
        content: messageText(result.content),
        tool_calls: Array.isArray(result.tool_calls) ? result.tool_calls : [],
        response_metadata: { usage: usageOf(result) },
      };
    },
    async *stream(messages, options = {}) {
      const invocationOptions = options?.signal ? { signal: options.signal } : {};
      const chunks = await model.stream(toGroqMessages(messages), invocationOptions);
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
  modelName,
  { inputTokens = 0, outputTokens = 0, cachedInputTokens = 0 } = {},
) {
  const rates = getModelRate("groq", modelName);
  const regularInput = Math.max(0, inputTokens - cachedInputTokens);
  const cachedRate = rates.cachedInputUsdPerMillion ?? rates.inputUsdPerMillion;
  return (
    (regularInput * rates.inputUsdPerMillion +
      cachedInputTokens * cachedRate +
      outputTokens * rates.outputUsdPerMillion) /
    1_000_000
  );
}

export const groqProvider = {
  id: "groq",
  isConfigured: () => Boolean(env.GROQ_API_KEY),
  modelForTier: (tier) => (tier === "strong" ? env.GROQ_MODEL_STRONG : env.GROQ_MODEL_SMALL),
  createModel: createGroqModel,
  estimateCostUsd: estimateGroqCost,
  chatModels: [
    {
      id: "openai/gpt-oss-20b",
      name: "Groq · GPT OSS 20B",
      description: "Fast and cost-efficient · Free plan eligible, rate limits apply",
      access: "free_tier",
      tier: "small",
      enabled: true,
    },
    {
      id: "openai/gpt-oss-120b",
      name: "Groq · GPT OSS 120B",
      description: "Higher capability · Free plan eligible, rate limits apply",
      access: "free_tier",
      tier: "strong",
      enabled: true,
    },
  ],
};
