import * as Sentry from "@sentry/node";
import { getRedisClient, isRedisReady } from "../config/redis.js";
import { env } from "../config/env.js";
import { PLAN_CONFIG, PLANS } from "../shared/constants/plans.js";
import { UsageEvent } from "../models/UsageEvent.js";
import { isMongoReady } from "../config/database.js";
import { logger } from "../shared/utils/logger.js";
import { interviewRepository } from "../repositories/interviewRepository.js";
import { MODEL_PRICING_VERSION } from "../ai/modelPricingCatalog.js";

// In-memory counters for offline/test mode
const inMemoryCounters = new Map();
const inMemoryIdempotency = new Map();

const IDEMPOTENT_INCREMENT_SCRIPT = `
local prior = redis.call('GET', KEYS[2])
if prior then return { tonumber(prior), 0 } end
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if limit > 0 and current >= limit then return { current, -1 } end
local next = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
redis.call('SET', KEYS[2], next, 'EX', tonumber(ARGV[3]), 'NX')
return { next, 1 }
`;

function quotaStoreError() {
  const error = new Error("AI usage controls are temporarily unavailable. Please retry shortly.");
  error.statusCode = 503;
  error.code = "AI_USAGE_STORE_UNAVAILABLE";
  error.retryable = true;
  return error;
}

function requireQuotaStore() {
  if (isRedisReady()) return true;
  if (env.NODE_ENV !== "production" && env.AI_ALLOW_MOCKS) return false;
  throw quotaStoreError();
}

function inMemoryModeAllowed() {
  return env.NODE_ENV !== "production" && env.AI_ALLOW_MOCKS;
}

function counterLimit(plan, feature) {
  const quotas = (PLAN_CONFIG[plan] || PLAN_CONFIG[PLANS.FREE]).quotas;
  if (feature === "chat") return quotas.chatMessagesDaily;
  if (feature === "chat_tool") return quotas.chatToolCallsDaily || 25;
  if (feature === "match_jobs") return quotas.dailyMatches;
  if (feature === "tailor_resume") return quotas.tailoredDocsMonthly;
  if (feature === "resume_match_suggestions") return quotas.resumeMatchSuggestionsMonthly;
  return 0;
}

function quotaLimitError(feature, count, limit) {
  const label =
    feature === "chat"
      ? "Daily chat"
      : feature === "chat_tool"
        ? "Daily chat tool"
        : feature === "match_jobs"
          ? "Daily job match"
          : feature === "resume_match_suggestions"
            ? "Monthly resume match suggestions"
            : "Monthly tailored resume";
  const error = new Error(`${label} quota reached (${count}/${limit}).`);
  error.statusCode = 429;
  error.code = "QUOTA_EXCEEDED";
  return error;
}

function getDayKey(date = new Date()) {
  return date.toISOString().split("T")[0];
}

function getMonthKey(date = new Date()) {
  const parts = date.toISOString().split("T")[0].split("-");
  return `${parts[0]}-${parts[1]}`;
}

export const quotaService = {
  async assertAIEnabled() {
    if (env.AI_KILL_SWITCH) {
      const err = new Error("AI services are temporarily unavailable. Please try again later.");
      err.statusCode = 503;
      err.code = "AI_KILL_SWITCH_ACTIVE";
      throw err;
    }
    requireQuotaStore();
    return true;
  },

  isChatToolsEnabled() {
    return !env.AI_KILL_SWITCH && !env.AI_CHAT_TOOLS_KILL_SWITCH;
  },

  async getChatEntitlements(user) {
    const plan = user?.plan || PLANS.FREE;
    const planConfig = PLAN_CONFIG[plan] || PLAN_CONFIG[PLANS.FREE];
    const userId = user?._id ? user._id.toString() : user?.id ? user.id.toString() : "";
    const day = getDayKey();
    const dailySpend = userId ? await this.getDailySpendUsd(userId, day) : 0;
    const dailyBudget = planConfig.quotas.dailyUsdBudget || env.DAILY_USER_USD_BUDGET;
    const toolCallsToday = userId ? await this.getCounter(`quota:${userId}:chat_tool:${day}`) : 0;
    const toolCallsDailyLimit = planConfig.quotas.chatToolCallsDaily || 25;
    const nearBudget = dailyBudget > 0 && dailySpend >= dailyBudget * 0.8;
    const toolsExhausted = toolCallsToday >= toolCallsDailyLimit;
    const killSwitchActive = !this.isChatToolsEnabled();
    const degraded = nearBudget || toolsExhausted || killSwitchActive;

    return {
      plan,
      maxToolCallsPerTurn: degraded ? 0 : planConfig.quotas.chatToolCallsPerTurn || 2,
      maxToolCallsDaily: toolCallsDailyLimit,
      toolCallsUsedToday: toolCallsToday,
      turnTokenBudget: nearBudget
        ? Math.min(1800, planConfig.quotas.chatTurnTokenBudget || 4000)
        : planConfig.quotas.chatTurnTokenBudget || 4000,
      maxOutputTokens: nearBudget ? 450 : 1200,
      allowedModelTier: nearBudget ? "small" : planConfig.features.chatModelTier || "small",
      degraded,
      degradationReason: killSwitchActive
        ? "kill_switch"
        : nearBudget
          ? "near_budget"
          : toolsExhausted
            ? "daily_tool_limit"
            : null,
      dailySpendUsd: dailySpend,
      dailyBudgetUsd: dailyBudget,
    };
  },

  async reserveUsage({
    user,
    feature = "chat",
    model = "unknown",
    provider = "unknown",
    requestId = null,
    estimatedInputTokens = 0,
    estimatedOutputTokens = 0,
    estimatedCostUsd = 0,
  }) {
    const userId = user?._id ? user._id.toString() : user?.id ? user.id.toString() : null;
    if (!userId) return null;
    const attemptId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      reservationId: attemptId,
      userId,
      userPlan: user?.plan || PLANS.FREE,
      planVersion: user?.planVersion || "unversioned",
      feature,
      provider,
      model,
      requestId,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd,
      startedAt: performance.now(),
    };
  },

  async settleUsage(reservation, actual = {}) {
    if (!reservation?.userId) return null;
    const latencyMs =
      actual.latencyMs ??
      Math.round(performance.now() - (reservation.startedAt || performance.now()));
    await this.recordUsage({
      userId: reservation.userId,
      userPlan: reservation.userPlan,
      planVersion: reservation.planVersion,
      feature: actual.feature || reservation.feature,
      provider: actual.provider || reservation.provider,
      model: actual.model || reservation.model,
      requestId: actual.requestId || reservation.requestId,
      attemptId: reservation.reservationId,
      status: actual.status || "success",
      outcome: actual.outcome || "success",
      usageIsEstimated: actual.usageIsEstimated ?? true,
      inputTokens: actual.inputTokens ?? reservation.estimatedInputTokens ?? 0,
      outputTokens: actual.outputTokens ?? reservation.estimatedOutputTokens ?? 0,
      cacheReadTokens: actual.cacheReadTokens ?? 0,
      cachedInputTokens: actual.cachedInputTokens ?? actual.cacheReadTokens ?? 0,
      cacheWriteTokens: actual.cacheWriteTokens ?? 0,
      costUsd: actual.costUsd ?? reservation.estimatedCostUsd ?? 0,
      latencyMs,
      retryCount: actual.retryCount ?? 0,
    });
    return true;
  },

  async reserveInterviewSession(
    user,
    {
      sessionId,
      day,
      allowFreeTrial = process.env.MOCK_INTERVIEW_FREE_TRIAL_ENABLED === "true",
    } = {},
  ) {
    const plan = user.plan || PLANS.FREE;
    const userId = user._id ? user._id.toString() : user.id;
    const isPremium = plan === PLANS.PREMIUM;
    const limit = Math.max(
      1,
      Number.parseInt(process.env.MOCK_INTERVIEW_PREMIUM_DAILY_LIMIT || "3", 10) || 3,
    );
    if (!isPremium && !allowFreeTrial) {
      const error = new Error("Mock interviews require Premium access");
      error.statusCode = 403;
      error.code = "PLAN_UPGRADE_REQUIRED";
      throw error;
    }

    if (!sessionId || !day) {
      const error = new Error("A session id and user's local quota day are required");
      error.statusCode = 400;
      error.code = "INVALID_QUOTA_RESERVATION";
      throw error;
    }
    const reservation = await interviewRepository.reserveStartQuota({
      userId,
      sessionId,
      day,
      isPremium,
      limit,
    });
    if (!reservation) {
      const error = new Error(`Daily mock interview limit reached (${limit} per day)`);
      error.statusCode = 429;
      error.code = "QUOTA_EXCEEDED";
      throw error;
    }
    return reservation;
  },

  /**
   * Check if user has quota for a specific feature before executing LLM/graph
   */
  async checkQuota(user, feature, { estimatedCostUsd = 0, featureQuotaAccepted = false } = {}) {
    // 1. Check Global AI Kill Switch
    await this.assertAIEnabled();

    const plan = user.plan || PLANS.FREE;
    const planConfig = PLAN_CONFIG[plan] || PLAN_CONFIG[PLANS.FREE];
    const userId = user._id ? user._id.toString() : user.id;
    const day = getDayKey();
    const month = getMonthKey();

    // 2. Check Daily USD Budget
    const dailySpend = await this.getDailySpendUsd(userId, day);
    const userBudget = planConfig.quotas.dailyUsdBudget || env.DAILY_USER_USD_BUDGET;
    if (estimatedCostUsd > 0) {
      const reservationWouldBlock = dailySpend + estimatedCostUsd > userBudget;
      if (reservationWouldBlock) {
        logger.info(
          {
            userId,
            feature,
            userPlan: plan,
            dailySpend,
            estimatedCostUsd,
            userBudget,
            wouldBlock: true,
            mode: "shadow",
          },
          "AI request reservation shadow evaluation",
        );
      }
    }
    if (dailySpend >= userBudget) {
      const err = new Error(
        `Daily AI budget exceeded ($${dailySpend.toFixed(2)} / $${userBudget.toFixed(2)}). Upgrade your plan or wait until tomorrow.`,
      );
      err.statusCode = 429;
      err.code = "DAILY_BUDGET_EXCEEDED";
      throw err;
    }

    // 3. Check Global Daily Spend
    const globalSpend = await this.getGlobalDailySpendUsd(day);
    if (globalSpend >= env.GLOBAL_DAILY_USD_CAP) {
      logger.warn(
        { globalSpend, cap: env.GLOBAL_DAILY_USD_CAP },
        "Global daily USD cap reached! Rejecting heavy actions.",
      );
      const err = new Error(
        "Global service capacity reached for today. Please try again tomorrow.",
      );
      err.statusCode = 429;
      err.code = "GLOBAL_BUDGET_CAP_REACHED";
      throw err;
    }

    if (env.AI_MONTHLY_ALLOWANCE_SHADOW_MODE && planConfig.priceUsd > 0) {
      const monthlySpend = await this.getSpendValue(`spend:user:${userId}:month:${month}`);
      const monthlyAllowance = planConfig.priceUsd * env.AI_MONTHLY_ALLOWANCE_SHADOW_RATIO;
      const monthlyWouldBlock = monthlySpend + estimatedCostUsd > monthlyAllowance;
      if (monthlyWouldBlock) {
        logger.info(
          {
            userId,
            feature,
            userPlan: plan,
            monthlySpend,
            estimatedCostUsd,
            monthlyAllowance,
            wouldBlock: true,
            mode: "shadow",
          },
          "AI monthly allowance shadow evaluation",
        );
      }
    }

    // 4. Feature-specific limits
    if (feature === "chat") {
      const count = await this.getCounter(`quota:${userId}:chat:${day}`);
      const limit = planConfig.quotas.chatMessagesDaily;
      if (count >= limit) {
        const err = new Error(
          `Daily chat quota reached (${count}/${limit} messages). Upgrade to Pro for higher limits.`,
        );
        err.statusCode = 429;
        err.code = "QUOTA_EXCEEDED";
        throw err;
      }
    } else if (feature === "match_jobs") {
      const count = await this.getCounter(`quota:${userId}:match:${day}`);
      const limit = planConfig.quotas.dailyMatches;
      if (count >= limit) {
        const err = new Error(
          `Daily job match quota reached (${count}/${limit} matches). Upgrade your plan for more.`,
        );
        err.statusCode = 429;
        err.code = "QUOTA_EXCEEDED";
        throw err;
      }
    } else if (feature === "tailor_resume") {
      const count = await this.getCounter(`quota:${userId}:tailor:${month}`);
      const limit = planConfig.quotas.tailoredDocsMonthly;
      if (count >= limit) {
        const err = new Error(
          `Monthly tailored resume quota reached (${count}/${limit} docs). Upgrade to continue tailoring.`,
        );
        err.statusCode = 429;
        err.code = "QUOTA_EXCEEDED";
        throw err;
      }
    } else if (feature === "resume_match_suggestions" && !featureQuotaAccepted) {
      const count = await this.getCounter(`quota:${userId}:resume-match-suggestions:${month}`);
      const limit = planConfig.quotas.resumeMatchSuggestionsMonthly;
      if (count >= limit) throw quotaLimitError(feature, count, limit);
    } else if (
      feature === "interview_prep" ||
      feature === "mock_interview" ||
      feature === "mock_interview_trial"
    ) {
      if (!planConfig.features.interviewPrep && feature === "interview_prep") {
        const err = new Error("Interview prep requires a Pro or Premium subscription");
        err.statusCode = 403;
        err.code = "PLAN_UPGRADE_REQUIRED";
        throw err;
      }
      if (!planConfig.features.mockInterview && feature === "mock_interview") {
        const err = new Error("Mock interviews require a Premium subscription");
        err.statusCode = 403;
        err.code = "PLAN_UPGRADE_REQUIRED";
        throw err;
      }
    }

    return true;
  },

  /**
   * Increment quota counter in Redis (INCR + EXPIRE)
   */
  async incrementQuota(userId, feature, idempotencyKey, userPlan = PLANS.FREE) {
    if (!idempotencyKey) {
      const error = new Error("An idempotency key is required to count an AI operation");
      error.statusCode = 400;
      error.code = "IDEMPOTENCY_KEY_REQUIRED";
      throw error;
    }
    const day = getDayKey();
    const month = getMonthKey();
    let key;
    let ttl;

    if (feature === "tailor_resume") {
      key = `quota:${userId}:tailor:${month}`;
      ttl = 32 * 86400; // 32 days
    } else if (feature === "match_jobs") {
      key = `quota:${userId}:match:${day}`;
      ttl = 86400 * 2; // 2 days
    } else if (feature === "chat") {
      key = `quota:${userId}:chat:${day}`;
      ttl = 86400 * 2;
    } else if (feature === "resume_match_suggestions") {
      key = `quota:${userId}:resume-match-suggestions:${month}`;
      ttl = 32 * 86400;
    } else {
      key = `quota:${userId}:${feature}:${day}`;
      ttl = 86400 * 2;
    }

    const idempotencyRedisKey = `quota:idem:${userId}:${feature}:${idempotencyKey}`;
    const limit = counterLimit(userPlan, feature);
    if (!requireQuotaStore()) {
      const now = Date.now();
      for (const [storedKey, expiresAt] of inMemoryIdempotency) {
        if (expiresAt <= now) inMemoryIdempotency.delete(storedKey);
      }
      const prior = inMemoryIdempotency.get(idempotencyRedisKey);
      const current = inMemoryCounters.get(key) || 0;
      if (prior) return current;
      if (limit > 0 && current >= limit) throw quotaLimitError(feature, current, limit);
      const next = current + 1;
      inMemoryCounters.set(key, next);
      inMemoryIdempotency.set(idempotencyRedisKey, now + 24 * 60 * 60 * 1000);
      return next;
    }

    try {
      const redis = getRedisClient();
      const [count, state] = await redis.eval(
        IDEMPOTENT_INCREMENT_SCRIPT,
        2,
        key,
        idempotencyRedisKey,
        limit,
        ttl,
        86400,
      );
      if (Number(state) === -1) throw quotaLimitError(feature, Number(count), limit);
      return Number(count);
    } catch (error) {
      if (error.code === "QUOTA_EXCEEDED") throw error;
      if (env.NODE_ENV === "production" || !env.AI_ALLOW_MOCKS) throw quotaStoreError();
      const next = (inMemoryCounters.get(key) || 0) + 1;
      inMemoryCounters.set(key, next);
      inMemoryIdempotency.set(idempotencyRedisKey, Date.now() + 24 * 60 * 60 * 1000);
      return next;
    }
  },

  /**
   * Record token usage & cost asynchronously
   */
  async recordUsage({
    userId,
    userPlan = PLANS.FREE,
    planVersion = "unversioned",
    feature,
    provider = "unknown",
    model,
    requestId = null,
    attemptId = null,
    status = "success",
    outcome = "success",
    usageIsEstimated = false,
    inputTokens = 0,
    outputTokens = 0,
    cacheReadTokens = 0,
    cachedInputTokens = cacheReadTokens,
    cacheWriteTokens = 0,
    costUsd = 0.0,
    latencyMs = 0,
    retryCount = 0,
    pricingVersion = MODEL_PRICING_VERSION,
  }) {
    const day = getDayKey();

    // Persist the ledger before returning a successful provider result. In production,
    // ledger failure is surfaced to the caller instead of silently dropping spend data.
    if (isMongoReady()) {
      try {
        await UsageEvent.create({
          userId,
          plan: userPlan,
          planVersion,
          feature,
          provider,
          model,
          requestId,
          attemptId,
          status,
          outcome,
          usageIsEstimated,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cachedInputTokens,
          cacheWriteTokens,
          costUsd,
          latencyMs,
          retryCount,
          pricingVersion,
        });
      } catch (cause) {
        logger.error(
          { errorCode: cause?.code || "USAGE_LEDGER_WRITE_FAILED" },
          "Could not persist AI usage ledger row",
        );
        if (env.NODE_ENV === "production") {
          const error = new Error("AI usage ledger is temporarily unavailable.");
          error.statusCode = 503;
          error.code = "AI_USAGE_LEDGER_UNAVAILABLE";
          error.retryable = true;
          throw error;
        }
        throw cause;
      }
    } else if (env.NODE_ENV === "production") {
      const error = new Error("AI usage ledger is temporarily unavailable.");
      error.statusCode = 503;
      error.code = "AI_USAGE_LEDGER_UNAVAILABLE";
      error.retryable = true;
      throw error;
    }

    // 1. Increment Redis spend counters for instant budget checking
    const userSpendKey = `spend:user:${userId}:${day}`;
    const globalSpendKey = `spend:global:${day}`;

    await this.incrByFloat(userSpendKey, costUsd, 86400 * 2);
    await this.incrByFloat(globalSpendKey, costUsd, 86400 * 2);

    // 2. Alert if user's monthly LLM cost exceeds 25% of plan revenue
    const planConfig = PLAN_CONFIG[userPlan] || PLAN_CONFIG[PLANS.FREE];
    const planRevenue = planConfig.priceUsd;
    if (planRevenue > 0 && costUsd > 0) {
      const monthSpendKey = `spend:user:${userId}:month:${getMonthKey()}`;
      const totalMonthSpend = await this.incrByFloat(monthSpendKey, costUsd, 35 * 86400);

      const alertThreshold = planRevenue * env.AI_MONTHLY_ALLOWANCE_SHADOW_RATIO;
      if (totalMonthSpend > alertThreshold) {
        if (env.AI_MONTHLY_ALLOWANCE_SHADOW_MODE) {
          logger.info(
            {
              userId,
              userPlan,
              totalMonthSpend,
              planRevenue,
              threshold: alertThreshold,
              wouldBlock: true,
              mode: "shadow",
            },
            "AI monthly allowance shadow evaluation",
          );
        }
        if (env.SENTRY_DSN) {
          Sentry.captureMessage(
            `User ${userId} LLM cost ($${totalMonthSpend.toFixed(2)}) > 25% of ${userPlan} revenue ($${planRevenue})`,
            "warning",
          );
        }
      }
    }
  },

  async getCounter(key) {
    if (!isRedisReady()) {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      return inMemoryCounters.get(key) || 0;
    }
    try {
      const redis = getRedisClient();
      const val = await redis.get(key);
      return val ? parseInt(val, 10) : 0;
    } catch {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      return inMemoryCounters.get(key) || 0;
    }
  },

  async getSpendValue(key) {
    if (!isRedisReady()) {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      return Number(inMemoryCounters.get(key) || 0);
    }
    try {
      const value = await getRedisClient().get(key);
      return value ? Number.parseFloat(value) || 0 : 0;
    } catch {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      return Number(inMemoryCounters.get(key) || 0);
    }
  },

  async incrWithExpire(key, ttlSeconds) {
    if (!isRedisReady()) {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      const next = (inMemoryCounters.get(key) || 0) + 1;
      inMemoryCounters.set(key, next);
      return next;
    }
    try {
      const redis = getRedisClient();
      const val = await redis.incr(key);
      if (val === 1) {
        await redis.expire(key, ttlSeconds);
      }
      return val;
    } catch {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      const next = (inMemoryCounters.get(key) || 0) + 1;
      inMemoryCounters.set(key, next);
      return next;
    }
  },

  async incrByFloat(key, amount, ttlSeconds) {
    if (!isRedisReady()) {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      const current = inMemoryCounters.get(key) || 0;
      const next = current + amount;
      inMemoryCounters.set(key, next);
      return next;
    }
    try {
      const redis = getRedisClient();
      const val = await redis.incrbyfloat(key, amount);
      const parsed = parseFloat(val);
      if (parsed === amount) {
        await redis.expire(key, ttlSeconds);
      }
      return parsed;
    } catch {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      const current = inMemoryCounters.get(key) || 0;
      const next = current + amount;
      inMemoryCounters.set(key, next);
      return next;
    }
  },

  async getDailySpendUsd(userId, day = getDayKey()) {
    const key = `spend:user:${userId}:${day}`;
    if (!isRedisReady()) {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      return inMemoryCounters.get(key) || 0.0;
    }
    try {
      const redis = getRedisClient();
      const val = await redis.get(key);
      return val ? parseFloat(val) : 0.0;
    } catch {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      return inMemoryCounters.get(key) || 0.0;
    }
  },

  async getGlobalDailySpendUsd(day = getDayKey()) {
    const key = `spend:global:${day}`;
    if (!isRedisReady()) {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      return inMemoryCounters.get(key) || 0.0;
    }
    try {
      const redis = getRedisClient();
      const val = await redis.get(key);
      return val ? parseFloat(val) : 0.0;
    } catch {
      if (!inMemoryModeAllowed()) throw quotaStoreError();
      return inMemoryCounters.get(key) || 0.0;
    }
  },
};
