import { env } from "../../config/env.js";
import { createAnthropicModel, estimateAnthropicCost } from "./anthropic.js";
import { createGeminiModel, estimateGeminiCost } from "./gemini.js";

const providers = {
  gemini: {
    isConfigured: () => Boolean(env.GEMINI_API_KEY),
    modelForTier: (tier) => (tier === "strong" ? env.GEMINI_MODEL_STRONG : env.GEMINI_MODEL_SMALL),
    createModel: createGeminiModel,
    estimateCostUsd: estimateGeminiCost,
  },
  anthropic: {
    isConfigured: () =>
      Boolean(env.ANTHROPIC_API_KEY) && env.ANTHROPIC_API_KEY !== "dummy_anthropic_key_for_dev",
    modelForTier: (tier) => (tier === "strong" ? env.MODEL_STRONG : env.MODEL_SMALL),
    createModel: createAnthropicModel,
    estimateCostUsd: estimateAnthropicCost,
  },
};

export function getLLMProvider(name = env.LLM_PROVIDER) {
  const provider = providers[name];
  if (!provider) throw new Error(`Unsupported LLM provider: ${name}`);
  return provider;
}
