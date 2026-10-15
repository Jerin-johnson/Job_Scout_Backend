import { env } from "../config/env.js";
import { logger } from "../shared/utils/logger.js";
import { quotaService } from "./quotaService.js";
import { getModelRate } from "../ai/modelPricingCatalog.js";

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
    return {
      provider: "voyage",
      model: env.VOYAGE_EMBEDDING_MODEL,
      dimension: env.VOYAGE_EMBEDDING_DIMENSION,
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

  async getEmbeddingWithMetadata(text, { user, feature = "embedding" } = {}) {
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
    try {
      if (config.provider === "voyage") {
        const { VoyageAIClient } = await import("voyageai");
        const client = new VoyageAIClient({ apiKey: config.apiKey });
        const response = await client.embed({ input: [normalizedText], model: config.model });
        vector = response.data?.[0]?.embedding;
      } else {
        const { OpenAIEmbeddings } = await import("@langchain/openai");
        const embeddings = new OpenAIEmbeddings({
          openAIApiKey: config.apiKey,
          modelName: config.model,
          dimensions: config.dimension,
        });
        vector = await embeddings.embedQuery(normalizedText);
      }
    } catch (error) {
      logger.warn({ provider: config.provider, model: config.model, errorCode: error?.code }, "Embedding provider request failed");
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
      model: `${config.provider}/${config.model}`,
      inputTokens: actualTokens,
      outputTokens: 0,
      costUsd,
      usageIsEstimated: true,
      latencyMs: 0,
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
