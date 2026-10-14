export const PLANS = {
  FREE: "free",
  PRO: "pro",
  PREMIUM: "premium",
};

export const ROLES = {
  USER: "user",
  ADMIN: "admin",
};

export const PLAN_CONFIG = {
  [PLANS.FREE]: {
    name: "Free Tier",
    priceUsd: 0,
    priceInr: 0,
    quotas: {
      dailyMatches: 5,
      tailoredDocsMonthly: 1,
      chatMessagesDaily: 20,
      maxMemories: 50,
      dailyUsdBudget: 0.1,
    },
    features: {
      dailyMatching: false,
      tracker: false,
      interviewPrep: false,
      mockInterview: false,
      followUpAutomation: false,
    },
  },
  [PLANS.PRO]: {
    name: "Pro Tier",
    priceUsd: 15,
    priceInr: 1200,
    quotas: {
      dailyMatches: 50,
      tailoredDocsMonthly: 30,
      chatMessagesDaily: 200,
      maxMemories: 300,
      dailyUsdBudget: 1.5,
    },
    features: {
      dailyMatching: true,
      tracker: true,
      interviewPrep: true,
      mockInterview: false,
      followUpAutomation: false,
    },
  },
  [PLANS.PREMIUM]: {
    name: "Premium Tier",
    priceUsd: 35,
    priceInr: 2800,
    quotas: {
      dailyMatches: 200,
      tailoredDocsMonthly: 500, // fair-use cap
      chatMessagesDaily: 1000,
      maxMemories: 1000,
      dailyUsdBudget: 5.0,
    },
    features: {
      dailyMatching: true,
      tracker: true,
      interviewPrep: true,
      mockInterview: true,
      followUpAutomation: true,
    },
  },
};
