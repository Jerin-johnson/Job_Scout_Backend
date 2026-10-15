import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { env } from "../../config/env.js";

const GEMINI_PRICING_PER_MILLION = {
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

export function getGeminiPricing(modelName, now = new Date()) {
  if (modelName === "gemini-3.6-flash" || modelName === "gemini-3.8-flash") {
    return now < new Date("2027-01-01T00:00:00.000Z")
      ? { input: 0.75, output: 3.75 }
      : { input: 1.5, output: 7.5 };
  }
  return GEMINI_PRICING_PER_MILLION[modelName];
}

const CHAT_MODELS = [
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
  // Paid-only and deliberately excluded high-cost models stay out of chat.
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

const FREE_GEMINI_MODEL_IDS = new Set(
  CHAT_MODELS.filter((model) => model.enabled && model.access === "free_tier").map((model) => model.id),
);

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) => (typeof part === "string" ? part : part?.text || ""))
    .filter(Boolean)
    .join("\n");
}

function toLangChainMessages(messages) {
  return messages.map(({ role, content }) => {
    const text = messageText(content);
    if (role === "system") return new SystemMessage(text);
    if (role === "assistant") return new AIMessage(text);
    return new HumanMessage(text);
  });
}

export function createGeminiModel({ modelName, temperature, maxTokens, schema }) {
  if (!FREE_GEMINI_MODEL_IDS.has(modelName)) {
    throw new Error("Gemini model is not allowlisted for this product.");
  }
  const isGemini3Flash = /^gemini-3\.(?:6|8)-flash(?:$|-)/.test(modelName);
  let model = new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey: env.GEMINI_API_KEY,
    // Gemini 3.6 documents temperature as unsupported. Omit it for newer Flash
    // models too, so adding a model does not turn a default into a bad request.
    ...(isGemini3Flash ? {} : { temperature }),
    maxOutputTokens: maxTokens,
    maxRetries: 0,
  });
  if (schema) model = model.withStructuredOutput(schema, { includeRaw: true });

  return {
    async invoke(messages, { signal } = {}) {
      const result = await model.invoke(toLangChainMessages(messages), { signal });
      if (schema) {
        const raw = result.raw;
        return {
          ...result.parsed,
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
        response_metadata: {
          usage: {
            input_tokens: result.usage_metadata?.input_tokens || 0,
            output_tokens: result.usage_metadata?.output_tokens || 0,
          },
        },
      };
    },
    async *stream(messages, { signal } = {}) {
      const chunks = await model.stream(toLangChainMessages(messages), { signal });
      for await (const chunk of chunks) {
        yield {
          content: typeof chunk.content === "string" ? chunk.content : messageText(chunk.content),
          usage_metadata: chunk.usage_metadata || {},
        };
      }
    },
  };
}

export function estimateGeminiCost(modelName, usage = {}) {
  const rates = getGeminiPricing(modelName);
  if (!rates) return 0;
  return (
    ((usage.inputTokens || 0) * rates.input + (usage.outputTokens || 0) * rates.output) / 1_000_000
  );
}

export const geminiProvider = {
  id: "gemini",
  isConfigured: () => Boolean(env.GEMINI_API_KEY),
  modelForTier: (tier) => (tier === "strong" ? env.GEMINI_MODEL_STRONG : env.GEMINI_MODEL_SMALL),
  createModel: createGeminiModel,
  estimateCostUsd: estimateGeminiCost,
  chatModels: CHAT_MODELS,
};
