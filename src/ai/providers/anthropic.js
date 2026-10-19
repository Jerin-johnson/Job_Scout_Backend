import { ChatAnthropic } from "@langchain/anthropic";
import { env } from "../../config/env.js";
import { getModelRate } from "../modelPricingCatalog.js";

export function createAnthropicModel({ modelName, temperature, maxTokens, schema, tools }) {
  let model = new ChatAnthropic({
    modelName,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    temperature,
    maxTokens,
  });
  if (schema) model = model.withStructuredOutput(schema);
  else if (Array.isArray(tools) && tools.length > 0 && typeof model.bindTools === "function") {
    model = model.bindTools(tools);
  }
  return model;
}

export function estimateAnthropicCost(
  modelName,
  { inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0 },
) {
  const rates = getModelRate("anthropic", modelName);
  const regularInput = Math.max(0, inputTokens - cacheReadTokens);
  return (
    (regularInput * rates.inputUsdPerMillion +
      cacheReadTokens * (rates.cachedInputUsdPerMillion ?? rates.inputUsdPerMillion) +
      cacheWriteTokens * (rates.cacheWriteUsdPerMillion ?? rates.inputUsdPerMillion) +
      outputTokens * rates.outputUsdPerMillion) /
    1_000_000
  );
}

export const anthropicProvider = {
  id: "anthropic",
  isConfigured: () =>
    Boolean(env.ANTHROPIC_API_KEY) && env.ANTHROPIC_API_KEY !== "dummy_anthropic_key_for_dev",
  modelForTier: (tier) => (tier === "strong" ? env.MODEL_STRONG : env.MODEL_SMALL),
  createModel: createAnthropicModel,
  estimateCostUsd: estimateAnthropicCost,
  // Anthropic models are paid and intentionally not exposed in the free chat picker.
  chatModels: [],
};
