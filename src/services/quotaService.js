import * as Sentry from "@sentry/node";
import { getRedisClient, isRedisReady } from "../config/redis.js";
import { env } from "../config/env.js";
import { PLAN_CONFIG, PLANS } from "../shared/constants/plans.js";
import { UsageEvent } from "../models/UsageEvent.js";
import { isMongoReady } from "../config/database.js";
import { logger } from "../shared/utils/logger.js";
import { interviewRepository } from "../repositories/interviewRepository.js";

// In-memory counters for offline/test mode
const inMemoryCounters = new Map();

function getDayKey(date = new Date()) {
  return date.toISOString().split("T")[0];
}

function getMonthKey(date = new Date()) {
  const parts = date.toISOString().split("T")[0].split("-");
  return `${parts[0]}-${parts[1]}`;
}

export const quotaService = {
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
  async checkQuota(user, feature) {
    // 1. Check Global AI Kill Switch
    if (env.AI_KILL_SWITCH) {
      const err = new Error("AI services are temporarily unavailable. Please try again later.");
      err.statusCode = 503;
      err.code = "AI_KILL_SWITCH_ACTIVE";
      throw err;
    }

    const plan = user.plan || PLANS.FREE;
    const planConfig = PLAN_CONFIG[plan] || PLAN_CONFIG[PLANS.FREE];
    const userId = user._id ? user._id.toString() : user.id;
    const day = getDayKey();
    const month = getMonthKey();

    // 2. Check Daily USD Budget
    const dailySpend = await this.getDailySpendUsd(userId, day);
    const userBudget = planConfig.quotas.dailyUsdBudget || env.DAILY_USER_USD_BUDGET;
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
  async incrementQuota(userId, feature) {
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
    } else {
      key = `quota:${userId}:chat:${day}`;
      ttl = 86400 * 2;
    }

    return this.incrWithExpire(key, ttl);
  },

  /**
   * Record token usage & cost asynchronously
   */
  async recordUsage({
    userId,
    userPlan = PLANS.FREE,
    feature,
    model,
    inputTokens = 0,
    outputTokens = 0,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
    costUsd = 0.0,
    latencyMs = 0,
  }) {
    const day = getDayKey();

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

      const alertThreshold = planRevenue * 0.25;
      if (totalMonthSpend > alertThreshold) {
        logger.warn(
          { userId, userPlan, totalMonthSpend, planRevenue, threshold: alertThreshold },
          "ALERT: User LLM cost exceeded 25% of subscription revenue!",
        );
        if (env.SENTRY_DSN) {
          Sentry.captureMessage(
            `User ${userId} LLM cost ($${totalMonthSpend.toFixed(2)}) > 25% of ${userPlan} revenue ($${planRevenue})`,
            "warning",
          );
        }
      }
    }

    // 3. Write through to Mongo usageEvents collection asynchronously
    if (isMongoReady()) {
      UsageEvent.create({
        userId,
        feature,
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        costUsd,
        latencyMs,
      }).catch((err) => {
        logger.error({ err: err.message }, "Failed to write usageEvent to MongoDB");
      });
    }
  },

  async getCounter(key) {
    if (!isRedisReady()) {
      return inMemoryCounters.get(key) || 0;
    }
    try {
      const redis = getRedisClient();
      const val = await redis.get(key);
      return val ? parseInt(val, 10) : 0;
    } catch {
      return inMemoryCounters.get(key) || 0;
    }
  },

  async incrWithExpire(key, ttlSeconds) {
    if (!isRedisReady()) {
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
      const next = (inMemoryCounters.get(key) || 0) + 1;
      inMemoryCounters.set(key, next);
      return next;
    }
  },

  async incrByFloat(key, amount, ttlSeconds) {
    if (!isRedisReady()) {
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
      const current = inMemoryCounters.get(key) || 0;
      const next = current + amount;
      inMemoryCounters.set(key, next);
      return next;
    }
  },

  async getDailySpendUsd(userId, day = getDayKey()) {
    const key = `spend:user:${userId}:${day}`;
    if (!isRedisReady()) {
      return inMemoryCounters.get(key) || 0.0;
    }
    try {
      const redis = getRedisClient();
      const val = await redis.get(key);
      return val ? parseFloat(val) : 0.0;
    } catch {
      return inMemoryCounters.get(key) || 0.0;
    }
  },

  async getGlobalDailySpendUsd(day = getDayKey()) {
    const key = `spend:global:${day}`;
    if (!isRedisReady()) {
      return inMemoryCounters.get(key) || 0.0;
    }
    try {
      const redis = getRedisClient();
      const val = await redis.get(key);
      return val ? parseFloat(val) : 0.0;
    } catch {
      return inMemoryCounters.get(key) || 0.0;
    }
  },
};
