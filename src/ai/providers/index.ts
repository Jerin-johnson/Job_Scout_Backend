import { env } from "../../config/env.js";
import { anthropicProvider } from "./anthropic.js";
import { geminiProvider, ChatModelDefinition, CreateModelOptions, ModelInstance } from "./gemini.js";
import { groqProvider } from "./groq.js";

export interface LLMProvider {
  id: string;
  isConfigured: () => boolean;
  modelForTier: (tier: string, task?: string) => string;
  createModel: (options: CreateModelOptions) => ModelInstance | unknown;
  estimateCostUsd: (model: string, usage?: Record<string, unknown>) => number;
  chatModels?: readonly ChatModelDefinition[];
}

const providers = new Map<string, LLMProvider>();

/** Register a provider adapter once at application startup. */
export function registerLLMProvider(provider: LLMProvider): void {
  if (
    !provider?.id ||
    typeof provider.createModel !== "function" ||
    typeof provider.isConfigured !== "function" ||
    typeof provider.modelForTier !== "function" ||
    typeof provider.estimateCostUsd !== "function"
  ) {
    throw new TypeError(
      "LLM providers must implement id, createModel, isConfigured, modelForTier, and estimateCostUsd.",
    );
  }
  if (providers.has(provider.id)) {
    throw new Error(`LLM provider already registered: ${provider.id}`);
  }
  providers.set(provider.id, Object.freeze(provider));
}

for (const provider of [geminiProvider, groqProvider, anthropicProvider]) {
  registerLLMProvider(provider as LLMProvider);
}

export function getLLMProvider(name: string = env.LLM_PROVIDER): LLMProvider {
  const provider = providers.get(name);
  if (!provider) throw new Error(`Unsupported LLM provider: ${name}`);
  return provider;
}

export function listLLMProviders(): LLMProvider[] {
  return [...providers.values()];
}

export * from "./gemini.js";
export * from "./groq.js";
export * from "./anthropic.js";
