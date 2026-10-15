import { routeRequest } from "../ai/router.js";
import { invokeLLM, formatCachedPrompt } from "../ai/llm.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { listSelectableChatModels, resolveSelectableChatModel } from "../ai/modelCatalog.js";
import { z } from "zod";

const chatRequestSchema = z.object({
  prompt: z.string().min(1, "Prompt cannot be empty").max(2000),
  threadId: z.string().optional(),
});
const streamChatRequestSchema = chatRequestSchema.extend({ modelId: z.string().min(1).max(100) });

export const aiController = {
  async listChatModels(_req, res) {
    res.status(200).json({ data: { models: listSelectableChatModels() } });
  },

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
      const { prompt, modelId } = streamChatRequestSchema.parse(req.body);
      const selectedModel = resolveSelectableChatModel(modelId);
      if (!selectedModel) {
        return res.status(400).json({
          error: {
            code: "CHAT_MODEL_UNAVAILABLE",
            message: "That model is not available for chat. Choose an enabled free-tier model.",
            requestId: req.id || "req_unknown",
          },
        });
      }

      // Establish SSE headers after validating the chosen model so invalid choices
      // still receive the standard JSON API error envelope.
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      // Explicit model selection skips the separate router model call and cache.
      const decision = { tier: 1, intent: "chat_model_selected", confidence: 1, latencyMs: 0 };

      // Send router decision progress event
      res.write(
        `event: routing\ndata: ${JSON.stringify({
          tier: decision.tier,
          intent: decision.intent,
          confidence: decision.confidence,
          latencyMs: decision.latencyMs,
        })}\n\n`,
      );

      // Fetch candidate pinned facts for the selected model.
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
        tier: "small",
        feature: "chat",
        prompt: promptMessages,
        modelId: selectedModel.id,
      });

      // LangChain chat models return an AIMessage-like object. Stream only the
      // human-readable content instead of leaking usage metadata into chat.
      const responseText =
        typeof response === "string"
          ? response
          : typeof response?.content === "string"
            ? response.content
            : Array.isArray(response?.content)
              ? response.content
                  .map((part) => (typeof part === "string" ? part : part?.text || ""))
                  .filter(Boolean)
                  .join("\n")
              : "";

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
