import { ChatAnthropic } from "@langchain/anthropic";
import { env } from "../../../config/env.js";
import { getModelRate } from "../modelPricingCatalog.js";
import { CreateModelOptions, ChatModelDefinition } from "./gemini.js";

export function createAnthropicModel({
  modelName,
  temperature,
  maxTokens,
  schema,
  tools,
}: CreateModelOptions): unknown {
  let model: unknown = new ChatAnthropic({
    modelName,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    temperature,
    maxTokens,
  });
  const chatModel = model as ChatAnthropic;
  if (schema) {
    model = chatModel.withStructuredOutput(
      schema as Parameters<typeof chatModel.withStructuredOutput>[0],
    );
  } else if (
    Array.isArray(tools) &&
    tools.length > 0 &&
    typeof chatModel.bindTools === "function"
  ) {
    model = chatModel.bindTools(tools as Parameters<typeof chatModel.bindTools>[0]);
  }
  return model;
}

export interface AnthropicUsageOptions {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function estimateAnthropicCost(
  modelName: string,
  {
    inputTokens = 0,
    outputTokens = 0,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
  }: AnthropicUsageOptions,
): number {
  const rates = getModelRate("anthropic", modelName);
  const regularInput = Math.max(0, inputTokens - cacheReadTokens);
  const inputRate = rates.inputUsdPerMillion ?? 0;
  const cachedRate = rates.cachedInputUsdPerMillion ?? inputRate;
  const writeRate = rates.cacheWriteUsdPerMillion ?? inputRate;
  const outputRate = rates.outputUsdPerMillion ?? 0;

  return (
    (regularInput * inputRate +
      cacheReadTokens * cachedRate +
      cacheWriteTokens * writeRate +
      outputTokens * outputRate) /
    1_000_000
  );
}

export const anthropicProvider = {
  id: "anthropic",
  isConfigured: (): boolean =>
    Boolean(env.ANTHROPIC_API_KEY) && env.ANTHROPIC_API_KEY !== "dummy_anthropic_key_for_dev",
  modelForTier: (tier: string): string => (tier === "strong" ? env.MODEL_STRONG : env.MODEL_SMALL),
  createModel: createAnthropicModel,
  estimateCostUsd: estimateAnthropicCost,
  chatModels: [] as ChatModelDefinition[],
};
