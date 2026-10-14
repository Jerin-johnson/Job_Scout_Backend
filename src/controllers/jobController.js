import { discoveryGraph } from "../ai/graphs/discoveryGraph.js";
import { get, set, CacheKeys, TTL } from "../shared/cache.js";
import { longTermMemory } from "../ai/memory/longTerm.js";
import { z } from "zod";

const feedbackSchema = z.object({
  feedback: z.enum(["thumbs_up", "thumbs_down"]),
  reason: z.string().optional().default(""),
});

export const jobController = {
  async getMatches(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const ver = req.user.profileVersion || 1;
      const cacheKey = CacheKeys.response(userId, "matches", ver);

      // Check L1 response cache
      const cached = await get(cacheKey);
      if (cached) {
        return res.status(200).json({ data: { matches: cached, fromCache: true } });
      }

      let matches = await discoveryGraph.getUserMatches(userId);

      // If no matches exist yet, run initial discovery
      if (!matches || matches.length === 0) {
        const run = await discoveryGraph.runDiscovery(req.user);
        matches = run.matches || [];
      }

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

  async runDiscovery(req, res, next) {
    try {
      const result = await discoveryGraph.runDiscovery(req.user);
      res.status(200).json({
        data: {
          message: "Discovery run completed successfully",
          totalFound: result.matches.length,
          matches: result.matches,
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
