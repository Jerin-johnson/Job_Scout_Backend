import { discoveryGraph } from "../ai/graphs/discoveryGraph.js";
import { get, set, CacheKeys, TTL } from "../shared/cache.js";
import { longTermMemory } from "../ai/memory/longTerm.js";
import { jobIngestionService } from "../services/jobs/jobIngestionService.js";
import { z } from "zod";
import { requestQuotaIdempotencyKey } from "../middleware/quotaGate.js";

const feedbackSchema = z.object({
  feedback: z.enum(["thumbs_up", "thumbs_down"]),
  reason: z.string().optional().default(""),
});

function serializeMatch(match) {
  const job = match.jobId && typeof match.jobId === "object" ? match.jobId : match.jobDetails || {};
  return {
    jobId: String(job._id || match.jobId),
    title: match.title || job.title || "Job title unavailable",
    company: match.company || job.company || "Company unavailable",
    location: match.location || job.location || "",
    sourceUrl: match.sourceUrl || job.sourceUrl || "",
    sourceBoard: match.sourceBoard || job.sourceBoard || "",
    salaryRange: match.salaryRange || job.salaryRange,
    score: match.score,
    rationale: match.rationale,
    matchingSkills: match.matchingSkills || [],
    missingSkills: match.missingSkills || [],
  };
}

export const jobController = {
  async getMatches(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const ver = req.user.profileVersion || 1;
      const cacheKey = CacheKeys.response(userId, "matches", ver);

      // Check L1 response cache
      const cached = await get(cacheKey);
      if (cached) {
        const matches = cached.map(serializeMatch);
        return res
          .status(200)
          .json({ data: { totalMatches: matches.length, matches, fromCache: true } });
      }

      let matches = await discoveryGraph.getUserMatches(userId);

      // If no matches exist yet, run initial discovery
      if (!matches || matches.length === 0) {
        const run = await discoveryGraph.runDiscovery(req.user, {
          idempotencyKey: requestQuotaIdempotencyKey(req, "match_jobs"),
          requestId: req.id,
        });
        matches = run.matches || [];
      }

      matches = matches.map(serializeMatch);

      // Cache matches response for 60s
      await set(cacheKey, matches, TTL.RESPONSE);

      res.status(200).json({
        data: {
          totalMatches: matches.length,
          matches,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async searchCatalog(req, res, next) {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
      const filters = {
        q: String(req.query.q || "").trim(),
        location: String(req.query.location || "").trim(),
        countryCode: String(req.query.countryCode || "").trim(),
        source: String(req.query.source || "").trim(),
        remoteType: String(req.query.remoteType || "").trim(),
      };
      const result = await jobIngestionService.searchJobs({ ...filters, page, limit });
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async runDiscovery(req, res, next) {
    try {
      const result = await discoveryGraph.runDiscovery(req.user, {
        idempotencyKey: requestQuotaIdempotencyKey(req, "match_jobs"),
        requestId: req.id,
      });
      const matches = result.matches.map(serializeMatch);
      res.status(200).json({
        data: {
          message: "Discovery run completed successfully",
          totalFound: matches.length,
          totalMatches: matches.length,
          matches,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async recordFeedback(req, res, next) {
    try {
      const { id } = req.params;
      const { feedback, reason } = feedbackSchema.parse(req.body);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;

      const updated = await discoveryGraph.recordFeedback(userId, id, feedback, reason);

      // If negative feedback, write a feedback memory so agent learns preferences
      if (feedback === "thumbs_down" && reason) {
        await longTermMemory.writeMemory({
          userId,
          userPlan: req.user.plan,
          type: "feedback",
          key: `dislikes_job_${id}`,
          content: `Candidate disliked job: ${reason}`,
          importance: 3,
          confidence: 0.85,
        });
      }

      res.status(200).json({
        data: {
          message: "Feedback recorded successfully",
          match: updated,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
