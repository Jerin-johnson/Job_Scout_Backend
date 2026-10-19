export const PLANS = {
  FREE: "free",
  PRO: "pro",
  PREMIUM: "premium",
};

export const ROLES = {
  USER: "user",
  ADMIN: "admin",
  SUPER_ADMIN: "super_admin",
};

export const PLAN_CONFIG = {
  [PLANS.FREE]: {
    name: "Free Tier",
    priceUsd: 0,
    priceInr: 0,
    quotas: {
      dailyMatches: 5,
      tailoredDocsMonthly: 1,
      resumeMatchSuggestionsMonthly: 2,
      chatMessagesDaily: 20,
      chatToolCallsPerTurn: 2,
      chatToolCallsDaily: 25,
      chatTurnTokenBudget: 4000,
      maxMemories: 50,
      dailyUsdBudget: 0.1,
      savedSearchesMax: 3,
      dailyAlertsMax: 2,
    },
    features: {
      dailyMatching: false,
      tracker: false,
      interviewPrep: false,
      mockInterview: false,
      followUpAutomation: false,
      chatModelTier: "small",
    },
  },
  [PLANS.PRO]: {
    name: "Pro Tier",
    priceUsd: 15,
    priceInr: 1200,
    quotas: {
      dailyMatches: 50,
      tailoredDocsMonthly: 30,
      resumeMatchSuggestionsMonthly: 30,
      chatMessagesDaily: 200,
      chatToolCallsPerTurn: 4,
      chatToolCallsDaily: 250,
      chatTurnTokenBudget: 6000,
      maxMemories: 300,
      dailyUsdBudget: 1.5,
      savedSearchesMax: 15,
      dailyAlertsMax: 10,
    },
    features: {
      dailyMatching: true,
      tracker: true,
      interviewPrep: true,
      mockInterview: false,
      followUpAutomation: false,
      chatModelTier: "strong",
    },
  },
  [PLANS.PREMIUM]: {
    name: "Premium Tier",
    priceUsd: 35,
    priceInr: 2800,
    quotas: {
      dailyMatches: 200,
      tailoredDocsMonthly: 500, // fair-use cap
      resumeMatchSuggestionsMonthly: 100,
      chatMessagesDaily: 1000,
      chatToolCallsPerTurn: 4,
      chatToolCallsDaily: 1000,
      chatTurnTokenBudget: 8000,
      maxMemories: 1000,
      dailyUsdBudget: 5.0,
      savedSearchesMax: 50,
      dailyAlertsMax: 25,
    },
    features: {
      dailyMatching: true,
      tracker: true,
      interviewPrep: true,
      mockInterview: true,
      followUpAutomation: true,
      chatModelTier: "strong",
    },
  },
};
