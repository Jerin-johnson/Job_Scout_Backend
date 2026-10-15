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
    const adapters = [new RemoteOkAdapter()];
    if (process.env.NODE_ENV !== "production") adapters.unshift(new MockBoardAdapter());
    return adapters;
  },

  /**
   * Run full ingestion: fetch -> dedupe -> embedOnce -> bulkWrite
   */
  async ingestAll({ user, requestId } = {}) {
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

    const embeddingConfig = await embeddingService.assertAvailable({ user, feature: "match_jobs" });

    // 1. Deduplicate in-flight jobs by contentHash
    const uniqueMap = new Map();
    for (const job of allJobs) {
      if (!uniqueMap.has(job.contentHash)) {
        uniqueMap.set(job.contentHash, job);
      }
    }
    const uniqueJobs = Array.from(uniqueMap.values());
    const defaultExpiry = new Date(Date.now() + 60 * 86400 * 1000);
    for (const job of uniqueJobs) {
      if (!job.expiresAt) job.expiresAt = defaultExpiry;
    }

    // 2. Embed once per job (check 90-day shared Redis embedding cache)
    let newEmbeddingsCount = 0;

    const embeddingWorkers = Array.from(
      { length: Math.min(5, uniqueJobs.length) },
      async (_, worker) => {
        for (let index = worker; index < uniqueJobs.length; index += 5) {
          const job = uniqueJobs[index];
          const embKey = CacheKeys.embedding(
            job.contentHash,
            embeddingConfig.provider,
            embeddingConfig.model,
            embeddingConfig.dimension,
          );
          let cached = await get(embKey);

          if (!cached) {
            const textToEmbed = `${job.title} at ${job.company}. Requirements: ${job.requirements.join(", ")}. ${job.rawDescription.substring(0, 500)}`;
            cached = await embeddingService.getEmbeddingWithMetadata(textToEmbed, { user, feature: "match_jobs", requestId });
            await set(embKey, cached, TTL.EMBEDDING);
            newEmbeddingsCount++;
          }

          job.embedding = cached.vector;
          job.embeddingMetadata = cached.metadata;
        }
      },
    );
    await Promise.all(embeddingWorkers);

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
          expiresAt: job.expiresAt || new Date(Date.now() + 60 * 86400 * 1000),
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
      return Job.find({ expiresAt: { $gt: new Date() } })
        .sort({ postedAt: -1 })
        .lean();
    }
    return Array.from(inMemoryJobs.values()).filter((job) => new Date(job.expiresAt) > new Date());
  },

  async searchJobs({ q = "", location = "", source = "", remoteType = "", page = 1, limit = 20 }) {
    const safeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (isMongoReady()) {
      const filter = {};
      if (q) {
        const expression = new RegExp(safeRegex(q), "i");
        filter.$or = [
          { title: expression },
          { company: expression },
          { tags: expression },
          { requirements: expression },
        ];
      }
      if (location) filter.location = new RegExp(safeRegex(location), "i");
      if (source) filter.sourceBoard = new RegExp(`^${safeRegex(source)}$`, "i");
      if (["remote", "hybrid", "onsite"].includes(remoteType)) filter.remoteType = remoteType;
      const [jobs, total] = await Promise.all([
        Job.find({ ...filter, expiresAt: { $gt: new Date() } })
          .sort({ postedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .select("-embedding")
          .lean(),
        Job.countDocuments({ ...filter, expiresAt: { $gt: new Date() } }),
      ]);
      return {
        jobs: jobs.map((job) => ({ ...job, jobId: String(job._id) })),
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };
    }
    const terms = q.toLowerCase();
    const now = new Date();
    const filtered = Array.from(inMemoryJobs.values())
      .filter(
        (job) =>
          new Date(job.expiresAt) > now &&
          (!terms ||
            [job.title, job.company, ...(job.tags || []), ...(job.requirements || [])]
              .join(" ")
              .toLowerCase()
              .includes(terms)) &&
          (!location || (job.location || "").toLowerCase().includes(location.toLowerCase())) &&
          (!source || job.sourceBoard?.toLowerCase() === source.toLowerCase()) &&
          (!remoteType || job.remoteType === remoteType),
      )
      .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
    const start = (page - 1) * limit;
    return {
      jobs: filtered.slice(start, start + limit).map(({ embedding: _embedding, ...job }) => ({
        ...job,
        jobId: String(job._id || job.contentHash),
      })),
      total: filtered.length,
      page,
      limit,
      pages: Math.ceil(filtered.length / limit),
    };
  },
};
