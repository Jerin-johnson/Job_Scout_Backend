import { routeRequest } from "../ai/router.js";
import { invokeLLM, formatCachedPrompt } from "../ai/llm.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { z } from "zod";

const chatRequestSchema = z.object({
  prompt: z.string().min(1, "Prompt cannot be empty").max(2000),
  threadId: z.string().optional(),
});

export const aiController = {
  /**
   * Route inspection / Dry-run endpoint
   */
  async route(req, res, next) {
    try {
      const { prompt } = chatRequestSchema.parse(req.body);
      const decision = await routeRequest({
        prompt,
        user: req.user,
        contextVersion: req.user.profileVersion || 1,
      });

      res.status(200).json({ data: { decision } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * SSE Streaming Chat Endpoint
   */
  async streamChat(req, res, next) {
    try {
      const { prompt } = chatRequestSchema.parse(req.body);

      // 1. Establish SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      // 2. Execute AI Router (Tier 0 & Tier 1 parallel race)
      const decision = await routeRequest({
        prompt,
        user: req.user,
        contextVersion: req.user.profileVersion || 1,
      });

      // Send router decision progress event
      res.write(
        `event: routing\ndata: ${JSON.stringify({
          tier: decision.tier,
          intent: decision.intent,
          confidence: decision.confidence,
          latencyMs: decision.latencyMs,
        })}\n\n`,
      );

      // Handle Tier 0 instant responses (< 50ms)
      if (decision.tier === 0) {
        if (decision.cachedOutput) {
          res.write(`event: token\ndata: ${JSON.stringify({ text: decision.cachedOutput })}\n\n`);
        } else if (decision.hitType === "slash_command") {
          res.write(
            `event: token\ndata: ${JSON.stringify({
              text: `[Executing command ${prompt}: opening application tracker]`,
            })}\n\n`,
          );
        } else {
          res.write(
            `event: token\ndata: ${JSON.stringify({
              text: `[Database query executed: 0 active applications this week]`,
            })}\n\n`,
          );
        }

        res.write(`event: done\ndata: ${JSON.stringify({ finishReason: "stop", tier: 0 })}\n\n`);
        return res.end();
      }

      // 3. For Tier 1 and Tier 2, fetch candidate pinned facts
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const profile = await profileRepository.findByUserId(userId);

      const pinnedFacts = profile ? (profile.skills || []).map((s) => s.name).join(", ") : "";

      const promptMessages = formatCachedPrompt({
        systemPrompt:
          "You are JobScout, an elite AI career agent. Be concise, direct, and actionable.",
        pinnedContext: pinnedFacts,
        userMessage: prompt,
      });

      // Emit progress event
      res.write(
        `event: progress\ndata: ${JSON.stringify({ step: "llm_invocation", tier: decision.tier })}\n\n`,
      );

      // 4. Stream response from LLM wrapper
      const response = await invokeLLM({
        user: req.user,
        tier: decision.tier === 2 ? "strong" : "small",
        feature: "chat",
        prompt: promptMessages,
      });

      const responseText = typeof response === "string" ? response : JSON.stringify(response);

      // Stream text chunks
      res.write(`event: token\ndata: ${JSON.stringify({ text: responseText })}\n\n`);
      res.write(
        `event: done\ndata: ${JSON.stringify({
          finishReason: "stop",
          tier: decision.tier,
          latencyMs: decision.latencyMs,
        })}\n\n`,
      );

      res.end();
    } catch (err) {
      if (!res.headersSent) {
        return next(err);
      }
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      res.end();
    }
  },
};
