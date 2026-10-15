import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { env } from "../../config/env.js";

const GEMINI_PRICING_PER_MILLION = {
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.8-flash": { input: 1.5, output: 7.5 },
};

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
  let model = new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey: env.GEMINI_API_KEY,
    temperature,
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
  };
}

export function estimateGeminiCost(modelName, usage = {}) {
  const rates = GEMINI_PRICING_PER_MILLION[modelName];
  if (!rates) return 0;
  return (
    ((usage.inputTokens || 0) * rates.input + (usage.outputTokens || 0) * rates.output) / 1_000_000
  );
}
