import { ChatAnthropic } from "@langchain/anthropic";
import { env } from "../../config/env.js";

const PRICING = {
  haiku: {
    input: 0.0000008,
    output: 0.000004,
    cacheRead: 0.00000008,
    cacheWrite: 0.000001,
  },
  sonnet: {
    input: 0.000003,
    output: 0.000015,
    cacheRead: 0.0000003,
    cacheWrite: 0.00000375,
  },
};

export function createAnthropicModel({ modelName, temperature, maxTokens, schema }) {
  let model = new ChatAnthropic({
    modelName,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    temperature,
    maxTokens,
  });
  if (schema) model = model.withStructuredOutput(schema);
  return model;
}

export function estimateAnthropicCost(
  modelName,
  { inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0 },
) {
  const rates = modelName.toLowerCase().includes("sonnet") ? PRICING.sonnet : PRICING.haiku;
  return (
    inputTokens * rates.input +
    outputTokens * rates.output +
    cacheReadTokens * rates.cacheRead +
    cacheWriteTokens * rates.cacheWrite
  );
}
