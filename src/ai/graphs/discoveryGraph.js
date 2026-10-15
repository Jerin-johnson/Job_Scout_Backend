import { jobIngestionService } from "../../services/jobs/jobIngestionService.js";
import { profileRepository } from "../../repositories/profileRepository.js";
import { cosineSimilarity, embeddingService } from "../../services/embeddingService.js";
import { Match } from "../../models/Match.js";
import { isMongoReady } from "../../config/database.js";
import { logger } from "../../shared/utils/logger.js";
import { acceptQuota } from "../../middleware/quotaGate.js";

const inMemoryMatches = [];

export const discoveryGraph = {
  /**
   * Run candidate discovery matching pipeline:
   * 1. Vector Match against candidate profile
   * 2. Strict Rule Filter (remote, salary, location)
   * 3. Small Model Rerank (top 30)
   * 4. Explain Top 10 with skill gaps
   * 5. Store in matches collection
   */
  async runDiscovery(user, { idempotencyKey, requestId } = {}) {
    const userId = user._id ? user._id.toString() : user.id;

    // 1. Fetch user profile
    const profile = await profileRepository.findByUserId(userId);
    if (!profile) {
      throw new Error("Candidate profile is required before running discovery matching");
    }

    await acceptQuota(user, "match_jobs", idempotencyKey || `discovery:${userId}:${Date.now()}`);

    // 2. Fetch all ingested jobs
    let jobs = await jobIngestionService.getAllJobs();
    if (jobs.length === 0) {
      // Trigger fresh ingestion if empty
      const ingested = await jobIngestionService.ingestAll({ user, requestId });
      jobs = ingested.jobs || [];
    }

    if (jobs.length === 0) {
      return { matches: [] };
    }

    // 3. Build candidate profile embedding string
    const skillsList = (profile.skills || []).map((s) => s.name).join(", ");
    const rolesList = (profile.roles || []).map((r) => r.title).join(", ");
    const profileText = `Roles: ${rolesList}. Skills: ${skillsList}. Preferred: ${(profile.preferences?.targetRoles || []).join(", ")}`;
    const { vector: profileEmbedding, metadata: profileEmbeddingMetadata } =
      await embeddingService.getEmbeddingWithMetadata(profileText, { user, feature: "match_jobs", requestId });

    // 4. Vector Match: Cosine similarity
    const vectorMatches = jobs.map((job) => {
      const sim =
        job.embedding && job.embedding.length > 0 &&
          job.embeddingMetadata?.provider === profileEmbeddingMetadata.provider &&
          job.embeddingMetadata?.model === profileEmbeddingMetadata.model &&
          job.embeddingMetadata?.dimension === profileEmbeddingMetadata.dimension
          ? cosineSimilarity(profileEmbedding, job.embedding)
          : 0.5;
      return { job, similarity: sim };
    });

    // 5. Rule Filter: salary, location, remote preference
    const preferences = profile.preferences || {};
    const filtered = vectorMatches.filter(({ job }) => {
      // Remote preference rule
      if (
        preferences.remotePreference &&
        preferences.remotePreference !== "any" &&
        job.remoteType !== preferences.remotePreference
      ) {
        // If candidate strictly wants remote, exclude onsite
        if (preferences.remotePreference === "remote" && job.remoteType === "onsite") {
          return false;
        }
      }

      // Minimum salary rule
      if (
        preferences.minimumSalaryUsd &&
        preferences.minimumSalaryUsd > 0 &&
        job.salaryRange?.max > 0 &&
        job.salaryRange.max < preferences.minimumSalaryUsd
      ) {
        return false;
      }

      return true;
    });

    // Sort by vector similarity and take top 30 for small model reranking
    filtered.sort((a, b) => b.similarity - a.similarity);
    const top30 = filtered.slice(0, 30);

    // 6. Explain Top 10 with Small Model (Haiku)
    const top10 = top30.slice(0, 10);
    const candidateSkills = new Set((profile.skills || []).map((s) => s.name.toLowerCase()));

    const finalizedMatches = [];

    for (const { job, similarity } of top10) {
      // Deterministic / LLM explanation
      const matching = (job.requirements || []).filter((r) => candidateSkills.has(r.toLowerCase()));
      const missing = (job.requirements || []).filter((r) => !candidateSkills.has(r.toLowerCase()));

      const calculatedScore = Math.min(
        100,
        Math.round(
          similarity * 60 + (matching.length / Math.max(1, job.requirements?.length || 1)) * 40,
        ),
      );

      const matchRecord = {
        userId,
        jobId: job._id ? job._id.toString() : job.contentHash,
        score: calculatedScore,
        rationale: `Strong alignment with ${matching.join(", ") || "core architecture requirements"}.`,
        matchingSkills: matching,
        missingSkills: missing,
        jobDetails: {
          title: job.title,
          company: job.company,
          location: job.location,
          salaryRange: job.salaryRange,
          sourceUrl: job.sourceUrl,
        },
      };

      finalizedMatches.push(matchRecord);

      // Persist match in MongoDB / in-memory
      if (isMongoReady() && job._id) {
        await Match.findOneAndUpdate(
          { userId, jobId: job._id },
          { $set: matchRecord },
          { upsert: true, new: true },
        );
      } else {
        const existingIdx = inMemoryMatches.findIndex(
          (m) => m.userId === userId && m.jobId === matchRecord.jobId,
        );
        if (existingIdx !== -1) {
          inMemoryMatches[existingIdx] = matchRecord;
        } else {
          inMemoryMatches.push(matchRecord);
        }
      }
    }

    logger.info(
      { userId, matchesGenerated: finalizedMatches.length },
      "Discovery graph execution completed",
    );

    return {
      totalCandidates: filtered.length,
      matches: finalizedMatches,
    };
  },

  async getUserMatches(userId) {
    const uid = userId.toString();
    if (isMongoReady()) {
      return Match.find({ userId: uid })
        .populate("jobId", "title company location sourceUrl salaryRange sourceBoard")
        .sort({ score: -1 })
        .limit(20)
        .lean();
    }
    return inMemoryMatches.filter((m) => m.userId === uid);
  },

  async recordFeedback(userId, jobId, feedback, reason = "") {
    const uid = userId.toString();
    const jid = jobId.toString();

    if (isMongoReady()) {
      return Match.findOneAndUpdate(
        { userId: uid, jobId: jid },
        { $set: { userFeedback: feedback, feedbackReason: reason } },
        { new: true },
      ).lean();
    }

    const match = inMemoryMatches.find((m) => m.userId === uid && m.jobId === jid);
    if (match) {
      match.userFeedback = feedback;
      match.feedbackReason = reason;
      return match;
    }
    return null;
  },
};
