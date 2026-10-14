import { env } from "../config/env.js";
import { logger } from "../shared/utils/logger.js";

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Deterministic pseudo-embedding generator for offline/test environments
 */
function generateMockEmbedding(text, dimensions = 1536) {
  const embedding = new Array(dimensions).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  for (let i = 0; i < dimensions; i++) {
    embedding[i] = Math.sin(hash + i) * 0.1;
  }
  return embedding;
}

export const embeddingService = {
  /**
   * Generate vector embedding for text
   */
  async getEmbedding(text) {
    if (!text || text.trim().length === 0) {
      return generateMockEmbedding("empty");
    }

    const isMock =
      !env.OPENAI_API_KEY ||
      env.OPENAI_API_KEY === "dummy_openai_key" ||
      env.OPENAI_API_KEY === "dummy_openai_key_for_dev";

    if (isMock && (!env.VOYAGE_API_KEY || env.VOYAGE_API_KEY.length === 0)) {
      return generateMockEmbedding(text);
    }

    try {
      if (env.EMBEDDING_PROVIDER === "voyage" && env.VOYAGE_API_KEY) {
        const { VoyageAIClient } = await import("voyageai");
        const client = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY });
        const response = await client.embed({
          input: [text],
          model: "voyage-large-2-instruct",
        });
        return response.data[0].embedding;
      } else {
        const { OpenAIEmbeddings } = await import("@langchain/openai");
        const embeddings = new OpenAIEmbeddings({
          openAIApiKey: env.OPENAI_API_KEY,
          modelName: "text-embedding-3-small",
        });
        return embeddings.embedQuery(text);
      }
    } catch (err) {
      logger.warn(
        { err: err.message },
        "Embedding generation failed; falling back to deterministic mock",
      );
      return generateMockEmbedding(text);
    }
  },
};
