import { env } from "../../config/env.js";
import { anthropicProvider } from "./anthropic.js";
import { geminiProvider } from "./gemini.js";
import { groqProvider } from "./groq.js";

const providers = new Map();

/** Register a provider adapter once at application startup. */
export function registerLLMProvider(provider) {
  if (!provider?.id || typeof provider.createModel !== "function" ||
    typeof provider.isConfigured !== "function" || typeof provider.modelForTier !== "function" ||
    typeof provider.estimateCostUsd !== "function") {
    throw new TypeError("LLM providers must implement id, createModel, isConfigured, modelForTier, and estimateCostUsd.");
  }
  if (providers.has(provider.id)) throw new Error(`LLM provider already registered: ${provider.id}`);
  providers.set(provider.id, Object.freeze(provider));
}

for (const provider of [geminiProvider, groqProvider, anthropicProvider]) {
  registerLLMProvider(provider);
}

export function getLLMProvider(name = env.LLM_PROVIDER) {
  const provider = providers.get(name);
  if (!provider) throw new Error(`Unsupported LLM provider: ${name}`);
  return provider;
}

export function listLLMProviders() {
  return [...providers.values()];
}
