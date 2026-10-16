import { env } from "../config/env.js";
import { getLLMProvider, listLLMProviders } from "./providers/index.js";
import { effectiveDataPolicy } from "../config/aiStartupValidation.js";

export const AUTO_CHAT_MODEL_ID = "auto";

function configuredProvidersInPreferenceOrder() {
  return listLLMProviders()
    .filter((provider) => provider.isConfigured())
    .sort((left, right) => Number(right.id === env.LLM_PROVIDER) - Number(left.id === env.LLM_PROVIDER));
}

export function listSelectableChatModels() {
  return configuredProvidersInPreferenceOrder().flatMap((provider) =>
    (provider.chatModels || [])
      .filter((model) => model.enabled && model.access === "free_tier")
      .map(({ id, name, description, access, tier }) => ({
        id,
        provider: provider.id,
        name,
        description,
        access,
        tier,
        dataPolicyClass: effectiveDataPolicy(provider.id),
      }))
      .filter((model) => env.NODE_ENV !== "production" || !env.AI_BLOCK_UNPAID_PERSONAL_DATA || model.dataPolicyClass === "paid_api"),
  );
}

export function listChatModelOptions() {
  const available = listSelectableChatModels();
  if (!available.length) return [];
  return [
    {
      id: AUTO_CHAT_MODEL_ID,
      provider: "auto",
      name: "Auto (recommended)",
      description: "JobScout selects a configured free-tier model for your question",
      access: "free_tier",
      dataPolicyClass: "provider_tier_configured",
    },
    ...available,
  ];
}

export function resolveChatModelForTier(tier = "small") {
  const available = listSelectableChatModels();
  if (!available.length) return null;
  const preferred = available.filter((model) => model.provider === env.LLM_PROVIDER);
  return preferred.find((model) => model.tier === tier)
    || available.find((model) => model.tier === tier)
    || preferred.find((model) => model.tier === "small")
    || available.find((model) => model.tier === "small")
    || available[0];
}

export function resolveSelectableChatModel(modelId) {
  if (!modelId || modelId === AUTO_CHAT_MODEL_ID) return null;
  return listSelectableChatModels().find((model) => model.id === modelId) || null;
}

export function getChatModelProvider(modelId) {
  const model = resolveSelectableChatModel(modelId);
  return model ? getLLMProvider(model.provider) : null;
}
