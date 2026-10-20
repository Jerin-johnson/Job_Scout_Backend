import { env, Env } from "../../../config/env.js";
import { catalogModelStatus } from "../modelPricingCatalog.js";

const PROVIDER_CREDENTIAL: Record<string, keyof Env> = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const PROVIDER_MODELS: Record<string, Array<keyof Env>> = {
  gemini: ["GEMINI_MODEL_SMALL", "GEMINI_MODEL_STRONG"],
  groq: ["GROQ_MODEL_SMALL", "GROQ_MODEL_STRONG"],
  anthropic: ["MODEL_SMALL", "MODEL_STRONG"],
};

const EMBEDDING_CREDENTIAL: Record<string, keyof Env> = {
  openai: "OPENAI_API_KEY",
  voyage: "VOYAGE_API_KEY",
};

function isPlaceholder(value?: string | null): boolean {
  return !value || /dummy|replace.?me|your.?key|changeme/i.test(value);
}

export function effectiveDataPolicy(provider: string, config: Env = env): string {
  if (provider === "gemini") return config.GEMINI_DATA_POLICY_CLASS;
  if (provider === "groq") return config.GROQ_DATA_POLICY_CLASS;
  if (provider === "anthropic") return "paid_api";
  if (provider === "openai" || provider === "voyage") return "paid_api";
  return "unknown";
}

export interface PersonalDataPolicyError extends Error {
  statusCode: number;
  code: string;
  safeDetails: { provider: string; modelId: string; policy: string };
}

export function personalDataPolicyError(
  provider: string,
  modelId: string,
  feature: string,
  config: Env = env,
): PersonalDataPolicyError | null {
  const personalDataFeatures = new Set([
    "chat",
    "resume_parse",
    "extract",
    "tailor_resume",
    "interview_prep",
    "mock_interview",
    "mock_interview_trial",
    "application_chat",
    "resume_match_suggestions",
  ]);
  if (
    config.NODE_ENV !== "production" ||
    !config.AI_BLOCK_UNPAID_PERSONAL_DATA ||
    !personalDataFeatures.has(feature)
  ) {
    return null;
  }
  if (effectiveDataPolicy(provider, config) !== "paid_api") {
    const error = new Error(
      "This feature contains personal data and requires a provider tier approved for personal data processing.",
    ) as PersonalDataPolicyError;
    error.statusCode = 403;
    error.code = "AI_PERSONAL_DATA_PROVIDER_BLOCKED";
    error.safeDetails = { provider, modelId, policy: effectiveDataPolicy(provider, config) };
    return error;
  }
  return null;
}

export function validateAIConfiguration(config: Env = env): string[] {
  if (config.NODE_ENV !== "production") return [];

  const issues: string[] = [];
  if (config.AI_ALLOW_MOCKS) issues.push("AI_ALLOW_MOCKS must be false in production");
  if (!config.AI_BLOCK_UNPAID_PERSONAL_DATA)
    issues.push("AI_BLOCK_UNPAID_PERSONAL_DATA must be true in production");

  const provider = config.LLM_PROVIDER;
  const credentialName = PROVIDER_CREDENTIAL[provider];
  if (!credentialName) {
    issues.push(`LLM_PROVIDER is unsupported: ${provider || "unset"}`);
  } else if (isPlaceholder(config[credentialName] as string | undefined)) {
    issues.push(`${credentialName} must be set to a real credential for the selected provider`);
  }

  for (const variable of PROVIDER_MODELS[provider] || []) {
    const modelId = config[variable] as string | undefined;
    const status = catalogModelStatus(provider, modelId);
    if (status !== "priced")
      issues.push(`${variable}=${modelId || "unset"} is ${status} in the model catalog`);
  }

  const embeddingCredentialName = EMBEDDING_CREDENTIAL[config.EMBEDDING_PROVIDER];
  if (
    !embeddingCredentialName ||
    isPlaceholder(config[embeddingCredentialName] as string | undefined)
  ) {
    issues.push(
      `${embeddingCredentialName || "embedding provider"} must be configured for the selected embedding provider`,
    );
  }
  const embeddingModel =
    config.EMBEDDING_PROVIDER === "voyage"
      ? config.VOYAGE_EMBEDDING_MODEL
      : config.OPENAI_EMBEDDING_MODEL;
  const embeddingStatus = catalogModelStatus(config.EMBEDDING_PROVIDER, embeddingModel);
  if (embeddingStatus !== "priced") {
    issues.push(
      `Embedding model ${config.EMBEDDING_PROVIDER}/${embeddingModel || "unset"} is ${embeddingStatus} in the model catalog`,
    );
  }

  if (!Number.isFinite(config.DAILY_USER_USD_BUDGET) || config.DAILY_USER_USD_BUDGET <= 0) {
    issues.push("DAILY_USER_USD_BUDGET must be a positive finite number");
  }
  if (!Number.isFinite(config.GLOBAL_DAILY_USD_CAP) || config.GLOBAL_DAILY_USD_CAP <= 0) {
    issues.push("GLOBAL_DAILY_USD_CAP must be a positive finite number");
  }
  return issues;
}

export function assertValidAIConfiguration(config: Env = env): void {
  const issues = validateAIConfiguration(config);
  if (issues.length) {
    const error = new Error(
      `AI production configuration is invalid: ${issues.join("; ")}`,
    ) as Error & { code?: string };
    error.code = "AI_CONFIGURATION_INVALID";
    throw error;
  }
}
