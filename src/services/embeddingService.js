import { env } from "../config/env.js";
import { logger } from "../shared/utils/logger.js";
import { quotaService } from "./quotaService.js";
import { getModelRate } from "../ai/modelPricingCatalog.js";
import { randomUUID } from "node:crypto";
import { invokeWithTransientRetry } from "../ai/providerErrors.js";

const MOCK_DIMENSION = 1536;
const SYSTEM_USAGE_ID = "000000000000000000000000";

/** Compute cosine similarity between two vectors. */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Deterministic vectors are explicitly limited to local/test mock mode. */
function generateMockEmbedding(text, dimensions = MOCK_DIMENSION) {
  const embedding = new Array(dimensions).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  for (let i = 0; i < dimensions; i += 1) embedding[i] = Math.sin(hash + i) * 0.1;
  return embedding;
}

function embeddingConfig() {
  if (env.EMBEDDING_PROVIDER === "voyage") {
    const flexibleModels = new Set(["voyage-4-large", "voyage-4", "voyage-4-lite", "voyage-3-large", "voyage-3.5", "voyage-3.5-lite", "voyage-code-3"]);
    const fixedDimensions = { "voyage-large-2-instruct": 1024, "voyage-large-2": 1536, "voyage-3": 1024, "voyage-3-lite": 512, "voyage-multilingual-2": 1024 };
    const model = env.VOYAGE_EMBEDDING_MODEL;
    return {
      provider: "voyage",
      model,
      dimension: flexibleModels.has(model) ? env.VOYAGE_EMBEDDING_DIMENSION : (fixedDimensions[model] || env.VOYAGE_EMBEDDING_DIMENSION),
      supportsOutputDimension: flexibleModels.has(model),
      apiKey: env.VOYAGE_API_KEY,
    };
  }
  return {
    provider: "openai",
    model: env.OPENAI_EMBEDDING_MODEL,
    dimension: env.OPENAI_EMBEDDING_DIMENSION,
    apiKey: env.OPENAI_API_KEY,
  };
}

function notConfiguredError() {
  const error = new Error("The configured embedding provider is not available.");
  error.statusCode = 503;
  error.code = "EMBEDDING_PROVIDER_NOT_CONFIGURED";
  return error;
}

function estimateInputTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export const embeddingService = {
  getConfig: embeddingConfig,

  async getEmbeddingsWithMetadata(texts, { user, feature = "embedding", requestId = randomUUID() } = {}) {
    const normalizedTexts = (Array.isArray(texts) ? texts : []).map((text) => String(text || "").trim());
    if (normalizedTexts.some((text) => !text)) {
      const error = new Error("Embedding inputs must not be empty.");
      error.statusCode = 400;
      error.code = "EMPTY_EMBEDDING_INPUT";
      throw error;
    }
    if (!normalizedTexts.length) return [];
    const startedAt = performance.now();
    const config = embeddingConfig();
    const rate = getModelRate(config.provider, config.model);
    const inputTokens = normalizedTexts.reduce((sum, text) => sum + estimateInputTokens(text), 0);
    const estimatedCostUsd = (inputTokens * rate.inputUsdPerMillion) / 1_000_000;
    const availability = await this.assertAvailable({ user, feature, estimatedCostUsd });

    if (availability.mock) {
      return normalizedTexts.map((text) => ({
        vector: generateMockEmbedding(text),
        metadata: { provider: "mock", model: "deterministic-v1", dimension: MOCK_DIMENSION },
      }));
    }

    let vectors;
    let retryCount = 0;
    try {
      vectors = await invokeWithTransientRetry(async () => {
        if (config.provider === "voyage") {
          const { VoyageAIClient } = await import("voyageai");
          const client = new VoyageAIClient({ apiKey: config.apiKey, maxRetries: 0 });
          const request = { input: normalizedTexts, model: config.model, maxRetries: 0 };
          if (config.supportsOutputDimension) request.output_dimension = config.dimension;
          const response = await client.embed(request);
          return response.data?.map((item) => item.embedding);
        }
        const { OpenAIEmbeddings } = await import("@langchain/openai");
        const embeddings = new OpenAIEmbeddings({
          openAIApiKey: config.apiKey,
          modelName: config.model,
          dimensions: config.dimension,
          maxRetries: 0,
        });
        return embeddings.embedDocuments(normalizedTexts);
      }, {
        maxRetries: env.AI_PROVIDER_MAX_RETRIES,
        onRetry: (count) => { retryCount = count; },
      });
    } catch (error) {
      logger.warn({ provider: config.provider, model: config.model, errorCode: error?.code }, "Embedding batch request failed");
      await quotaService.recordUsage({
        userId: user?._id?.toString() || user?.id?.toString() || SYSTEM_USAGE_ID,
        userPlan: user?.plan,
        feature,
        provider: config.provider,
        model: `${config.provider}/${config.model}`,
        requestId,
        attemptId: randomUUID(),
        status: "failed",
        outcome: "provider_error",
        usageIsEstimated: true,
        inputTokens,
        outputTokens: 0,
        costUsd: estimatedCostUsd,
        latencyMs: Math.round(performance.now() - startedAt),
        retryCount,
      });
      throw error;
    }
    if (!Array.isArray(vectors) || vectors.length !== normalizedTexts.length || vectors.some((vector) => !Array.isArray(vector) || !vector.length || vector.some((value) => !Number.isFinite(value)))) {
      const error = new Error("Embedding provider returned an invalid vector batch.");
      error.statusCode = 502;
      error.code = "INVALID_EMBEDDING_RESPONSE";
      throw error;
    }
    const costUsd = (inputTokens * rate.inputUsdPerMillion) / 1_000_000;
    await quotaService.recordUsage({
      userId: user?._id?.toString() || user?.id?.toString() || SYSTEM_USAGE_ID,
      userPlan: user?.plan,
      feature,
      provider: config.provider,
      model: `${config.provider}/${config.model}`,
      requestId,
      attemptId: randomUUID(),
      status: "success",
      outcome: "success",
      inputTokens,
      outputTokens: 0,
      costUsd,
      usageIsEstimated: true,
      latencyMs: Math.round(performance.now() - startedAt),
      retryCount,
    });
    return vectors.map((vector) => ({ vector, metadata: { provider: config.provider, model: config.model, dimension: vector.length } }));
  },

  async assertAvailable({ user, feature = "embedding", estimatedCostUsd = 0 } = {}) {
    if (user) await quotaService.checkQuota(user, feature, { estimatedCostUsd });
    else await quotaService.assertAIEnabled();
    const config = embeddingConfig();
    const rate = getModelRate(config.provider, config.model);
    const configured = Boolean(config.apiKey) && !/^dummy/i.test(config.apiKey);
    const mockAllowed = env.NODE_ENV !== "production" && env.AI_ALLOW_MOCKS;
    if (!configured && !mockAllowed) throw notConfiguredError();
    return { ...config, rate, mock: !configured };
  },

  async getEmbeddingWithMetadata(text, { user, feature = "embedding", requestId = randomUUID() } = {}) {
    const startedAt = performance.now();
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      const error = new Error("Embedding input must not be empty.");
      error.statusCode = 400;
      error.code = "EMPTY_EMBEDDING_INPUT";
      throw error;
    }
    const config = embeddingConfig();
    const rate = getModelRate(config.provider, config.model);
    const inputTokens = estimateInputTokens(normalizedText);
    const estimatedCostUsd = (inputTokens * rate.inputUsdPerMillion) / 1_000_000;
    const availability = await this.assertAvailable({ user, feature, estimatedCostUsd });

    if (availability.mock) {
      return {
        vector: generateMockEmbedding(normalizedText),
        metadata: { provider: "mock", model: "deterministic-v1", dimension: MOCK_DIMENSION },
      };
    }

    let vector;
    let retryCount = 0;
    try {
      vector = await invokeWithTransientRetry(async () => {
        if (config.provider === "voyage") {
          const { VoyageAIClient } = await import("voyageai");
          const client = new VoyageAIClient({ apiKey: config.apiKey, maxRetries: 0 });
          const response = await client.embed({ input: [normalizedText], model: config.model, maxRetries: 0 });
          return response.data?.[0]?.embedding;
        }
        const { OpenAIEmbeddings } = await import("@langchain/openai");
        const embeddings = new OpenAIEmbeddings({
          openAIApiKey: config.apiKey,
          modelName: config.model,
          dimensions: config.dimension,
          maxRetries: 0,
        });
        return embeddings.embedQuery(normalizedText);
      }, {
        maxRetries: env.AI_PROVIDER_MAX_RETRIES,
        onRetry: (count) => { retryCount = count; },
      });
    } catch (error) {
      logger.warn({ provider: config.provider, model: config.model, errorCode: error?.code }, "Embedding provider request failed");
      await quotaService.recordUsage({
        userId: user?._id?.toString() || user?.id?.toString() || SYSTEM_USAGE_ID,
        userPlan: user?.plan,
        feature,
        provider: config.provider,
        model: `${config.provider}/${config.model}`,
        requestId,
        attemptId: randomUUID(),
        status: "failed",
        outcome: "provider_error",
        usageIsEstimated: true,
        inputTokens,
        outputTokens: 0,
        costUsd: estimatedCostUsd,
        latencyMs: Math.round(performance.now() - startedAt),
        retryCount,
      });
      throw error;
    }
    if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
      const error = new Error("Embedding provider returned an invalid vector.");
      error.statusCode = 502;
      error.code = "INVALID_EMBEDDING_RESPONSE";
      throw error;
    }

    const actualTokens = inputTokens;
    const costUsd = (actualTokens * rate.inputUsdPerMillion) / 1_000_000;
    await quotaService.recordUsage({
      userId: user?._id?.toString() || user?.id?.toString() || SYSTEM_USAGE_ID,
      userPlan: user?.plan,
      feature,
      provider: config.provider,
      model: `${config.provider}/${config.model}`,
      requestId,
      attemptId: randomUUID(),
      status: "success",
      outcome: "success",
      inputTokens: actualTokens,
      outputTokens: 0,
      costUsd,
      usageIsEstimated: true,
      latencyMs: Math.round(performance.now() - startedAt),
      retryCount,
    });

    return {
      vector,
      metadata: { provider: config.provider, model: config.model, dimension: vector.length },
    };
  },

  async getEmbedding(text, options) {
    const result = await this.getEmbeddingWithMetadata(text, options);
    return result.vector;
  },
};
