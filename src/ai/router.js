import { z } from "zod";
import { get, CacheKeys } from "../shared/cache.js";
import { computeSha256 } from "../shared/utils/crypto.js";
import { invokeLLM } from "./llm.js";
import { RoutingLog } from "../models/RoutingLog.js";
import { isMongoReady } from "../config/database.js";
import { logger } from "../shared/utils/logger.js";

// Classifier Output Schema
export const routerClassifierSchema = z.object({
  intent: z.enum([
    "chat_simple",
    "extract",
    "db_lookup",
    "match_jobs",
    "tailor_resume",
    "interview_prep",
    "full_strategy",
    "track_application",
  ]),
  complexity: z.enum(["low", "medium", "high"]),
  needsTools: z.boolean(),
  needsMemory: z.boolean(),
  memoryTypes: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  entities: z.record(z.any()).default({}),
});

// Deterministic slash commands mapping directly to Tier 0 handlers
const SLASH_COMMANDS = {
  "/track": { intent: "track_application", action: "view_board" },
  "/status": { intent: "db_lookup", action: "application_status" },
  "/export": { intent: "extract", action: "export_data" },
  "/stats": { intent: "db_lookup", action: "view_stats" },
};

// Deterministic natural language queries that map straight to Tier 0 DB queries
const DETERMINISTIC_PATTERNS = [
  {
    pattern: /^show (my )?applications?( this week)?$/i,
    intent: "db_lookup",
    query: "applications_recent",
  },
  { pattern: /^list (my )?applications?$/i, intent: "db_lookup", query: "applications_all" },
  { pattern: /^what is my (current )?plan\??$/i, intent: "db_lookup", query: "user_plan" },
  {
    pattern: /^how many credits? (do I have|left)\??$/i,
    intent: "db_lookup",
    query: "quota_balance",
  },
];

/**
 * Tier 0 Check: Slash commands, deterministic DB regex, and exact cache lookup
 */
async function checkTier0({ prompt, user: _user, contextVersion = 1 }) {
  const normalized = prompt.trim();

  // 1. Slash commands ($0.00 cost)
  const lowerPrompt = normalized.toLowerCase();
  for (const [cmd, details] of Object.entries(SLASH_COMMANDS)) {
    if (lowerPrompt === cmd || lowerPrompt.startsWith(`${cmd} `)) {
      return {
        tier: 0,
        hitType: "slash_command",
        intent: details.intent,
        complexity: "low",
        confidence: 1.0,
        data: details,
      };
    }
  }

  // 2. Deterministic Regex Lookups ($0.00 cost)
  for (const item of DETERMINISTIC_PATTERNS) {
    if (item.pattern.test(normalized)) {
      return {
        tier: 0,
        hitType: "deterministic_query",
        intent: item.intent,
        complexity: "low",
        confidence: 1.0,
        query: item.query,
      };
    }
  }

  // 3. Exact Cache Lookup in Redis (SHA256(prompt + contextVersion))
  const promptHash = computeSha256(`${normalized}:v${contextVersion}`);
  const cacheKey = CacheKeys.exactQuery(promptHash);
  const cachedResponse = await get(cacheKey);

  if (cachedResponse) {
    return {
      tier: 0,
      hitType: "exact_cache",
      intent: cachedResponse.intent || "chat_simple",
      complexity: "low",
      confidence: 1.0,
      cachedOutput: cachedResponse.output,
    };
  }

  return null;
}

/**
 * Tier 1 Classifier: Uses Small Model (Haiku) to determine intent, complexity, and tools
 */
async function runTier1Classifier({ prompt, user, signal }) {
  const classifierPrompt = [
    {
      role: "system",
      content:
        "You are the JobScout AI Router. Classify the user query into intent, complexity, tool necessity, and confidence (0 to 1). Return strictly structured output.",
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  return invokeLLM({
    user,
    tier: "small",
    feature: "router_classify",
    prompt: classifierPrompt,
    schema: routerClassifierSchema,
    signal,
  });
}

/**
 * Log routing decision asynchronously for metrics and misroute auditing
 */
async function logRoutingDecision({
  userId,
  tier,
  intent,
  complexity,
  confidence,
  escalated,
  cacheHit,
  latencyMs,
  costUsd,
}) {
  if (isMongoReady() && userId) {
    RoutingLog.create({
      userId,
      tier,
      intent,
      complexity,
      confidence,
      escalated,
      cacheHit,
      latencyMs,
      costUsd,
    }).catch((err) => {
      logger.warn({ err: err.message }, "Failed to write routingLog to MongoDB");
    });
  }
}

/**
 * The 3-Tier AI Router:
 * Races Tier 0 and Tier 1 in parallel. Aborts Tier 1 on Tier 0 hit.
 * Escalate to Tier 2 only if confidence < 0.7 or validation fails.
 */
export async function routeRequest({ prompt, user, contextVersion = 1 }) {
  const start = performance.now();
  const abortController = new AbortController();

  try {
    // 1. Race Tier 0 and Tier 1 in PARALLEL
    const tier0Promise = checkTier0({ prompt, user, contextVersion });
    const tier1Promise = runTier1Classifier({
      prompt,
      user,
      signal: abortController.signal,
    }).catch((err) => {
      if (abortController.signal.aborted) return null;
      throw err;
    });

    // Check Tier 0 result
    const tier0Result = await tier0Promise;

    if (tier0Result) {
      // Tier 0 instant hit! Abort Tier 1 classifier to save tokens & latency
      abortController.abort();
      const latencyMs = Math.round(performance.now() - start);

      const decision = {
        tier: 0,
        intent: tier0Result.intent,
        complexity: tier0Result.complexity,
        confidence: tier0Result.confidence,
        hitType: tier0Result.hitType,
        cachedOutput: tier0Result.cachedOutput || null,
        query: tier0Result.query || null,
        escalated: false,
        latencyMs,
        costUsd: 0.0,
      };

      logRoutingDecision({
        userId: user?._id || user?.id,
        ...decision,
        cacheHit: tier0Result.hitType === "exact_cache",
      });

      return decision;
    }

    // Tier 0 missed: await Tier 1 classifier
    const tier1Result = await tier1Promise;

    // 2. Evaluate Tier 1 Output
    let selectedTier = 1;
    let escalated = false;

    // Escalate to Tier 2 if confidence < 0.7 or if intent requires heavy multi-step workflow
    const heavyIntents = new Set([
      "match_jobs",
      "tailor_resume",
      "interview_prep",
      "full_strategy",
    ]);

    if (
      tier1Result.confidence < 0.7 ||
      tier1Result.complexity === "high" ||
      heavyIntents.has(tier1Result.intent)
    ) {
      selectedTier = 2;
      escalated = tier1Result.confidence < 0.7;
    }

    const latencyMs = Math.round(performance.now() - start);
    const costUsd = selectedTier === 2 ? 0.0015 : 0.0003;

    const decision = {
      tier: selectedTier,
      intent: tier1Result.intent,
      complexity: tier1Result.complexity,
      confidence: tier1Result.confidence,
      needsTools: tier1Result.needsTools,
      needsMemory: tier1Result.needsMemory,
      entities: tier1Result.entities,
      escalated,
      latencyMs,
      costUsd,
    };

    logRoutingDecision({
      userId: user?._id || user?.id,
      ...decision,
      cacheHit: false,
    });

    return decision;
  } catch (err) {
    if (abortController.signal.aborted) {
      // Handled cleanly
      return null;
    }
    logger.error({ err: err.message }, "Routing failed; falling back to Tier 1 simple chat");
    return {
      tier: 1,
      intent: "chat_simple",
      complexity: "low",
      confidence: 0.5,
      escalated: false,
      latencyMs: Math.round(performance.now() - start),
      costUsd: 0.0,
    };
  }
}
