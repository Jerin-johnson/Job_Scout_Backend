import { MockBoardAdapter } from "./adapters/mockBoardAdapter.js";
import { RemoteOkAdapter } from "./adapters/remoteOkAdapter.js";
import { Job } from "../../models/Job.js";
import { isMongoReady } from "../../config/database.js";
import { embeddingService } from "../embeddingService.js";
import { get, set, CacheKeys, TTL } from "../../shared/cache.js";
import { logger } from "../../shared/utils/logger.js";

const inMemoryJobs = new Map();

export const jobIngestionService = {
  getAdapters() {
    return [new MockBoardAdapter(), new RemoteOkAdapter()];
  },

  /**
   * Run full ingestion: fetch -> dedupe -> embedOnce -> bulkWrite
   */
  async ingestAll() {
    const adapters = this.getAdapters();
    const allJobs = [];

    for (const adapter of adapters) {
      try {
        const jobs = await adapter.fetchJobs();
        allJobs.push(...jobs);
      } catch (err) {
        logger.error({ err: err.message, adapter: adapter.name }, "Adapter failed");
      }
    }

    if (allJobs.length === 0) return { ingested: 0, embedded: 0 };

    // 1. Deduplicate in-flight jobs by contentHash
    const uniqueMap = new Map();
    for (const job of allJobs) {
      if (!uniqueMap.has(job.contentHash)) {
        uniqueMap.set(job.contentHash, job);
      }
    }
    const uniqueJobs = Array.from(uniqueMap.values());

    // 2. Embed once per job (check 90-day shared Redis embedding cache)
    let newEmbeddingsCount = 0;

    for (const job of uniqueJobs) {
      const embKey = CacheKeys.embedding(job.contentHash);
      let embedding = await get(embKey);

      if (!embedding) {
        const textToEmbed = `${job.title} at ${job.company}. Requirements: ${job.requirements.join(", ")}. ${job.rawDescription.substring(0, 500)}`;
        embedding = await embeddingService.getEmbedding(textToEmbed);
        await set(embKey, embedding, TTL.EMBEDDING);
        newEmbeddingsCount++;
      }

      job.embedding = embedding;
    }

    // 3. Persist to MongoDB using bulkWrite
    if (isMongoReady()) {
      const bulkOps = uniqueJobs.map((job) => ({
        updateOne: {
          filter: { contentHash: job.contentHash },
          update: { $set: job },
          upsert: true,
        },
      }));

      await Job.bulkWrite(bulkOps);
    } else {
      for (const job of uniqueJobs) {
        inMemoryJobs.set(job.contentHash, {
          _id: `job_${job.contentHash.substring(0, 10)}`,
          ...job,
        });
      }
    }

    logger.info(
      { total: uniqueJobs.length, newEmbeddings: newEmbeddingsCount },
      "Job ingestion pipeline completed",
    );

    return {
      ingested: uniqueJobs.length,
      embedded: newEmbeddingsCount,
      jobs: uniqueJobs,
    };
  },

  async getAllJobs() {
    if (isMongoReady()) {
      return Job.find({}).sort({ postedAt: -1 }).limit(100).lean();
    }
    return Array.from(inMemoryJobs.values());
  },
};
