import { getLLMProvider } from "./providers/index.js";

// This is deliberately a server-owned allowlist. A model being callable by the
// provider does not make it selectable in the product (especially if it bills).
const CHAT_MODELS = [
  {
    id: "gemini-3.1-flash-lite",
    provider: "gemini",
    name: "Gemini 3.1 Flash-Lite",
    description: "Fast, capable, and cost-efficient",
    access: "free_tier",
    enabled: true,
  },
  {
    id: "gemini-3.5-flash-lite",
    provider: "gemini",
    name: "Gemini 3.5 Flash-Lite",
    description: "Lowest-cost, high-throughput chat",
    access: "free_tier",
    enabled: true,
  },
];

export function listSelectableChatModels() {
  return CHAT_MODELS.filter((model) => model.enabled && isProviderConfigured(model.provider)).map(
    ({ id, provider, name, description, access }) => ({
      id,
      provider,
      name,
      description,
      access,
    }),
  );
}

export function resolveSelectableChatModel(modelId) {
  const model = CHAT_MODELS.find((entry) => entry.id === modelId && entry.enabled);
  if (!model || !isProviderConfigured(model.provider)) return null;
  return model;
}

function isProviderConfigured(provider) {
  try {
    return getLLMProvider(provider).isConfigured();
  } catch {
    return false;
  }
}
