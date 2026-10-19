import { Profile } from "../../models/Profile.js";
import { isMongoReady } from "../../config/database.js";
import { canonicalSkill } from "./matching.js";
import { normalizeRoleForMatching } from "./roleNormalization.js";
import { profileApplicantCountries } from "./eligibility.js";

export const INCREMENTAL_MATCH_BUDGET = Object.freeze({
  maxJobTokens: 64,
  maxUsersPerRun: 250,
  minTokenOverlap: 1,
});

function splitNormalizedTokens(text = "") {
  return String(normalizeRoleForMatching(text))
    .toLowerCase()
    .split(/[^\p{L}\p{N}.+#]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && token.length <= 32);
}

/**
 * Build inverted-index match tokens and country codes for a user Profile document
 * so newly ingested jobs can query only affected users via multikey index.
 */
export function buildProfileMatchIndex(profile = {}) {
  const tokenSet = new Set();

  for (const skill of profile?.skills || []) {
    const rawName = String(skill?.name || "")
      .trim()
      .toLowerCase();
    const canonical = canonicalSkill(skill?.name || "");
    if (canonical && canonical.length > 1) {
      const lower = canonical.toLowerCase();
      tokenSet.add(lower);
      const stem = lower.replace(/\.js$/i, "");
      if (stem.length > 1) tokenSet.add(stem);
    }
    if (rawName && rawName.length > 1 && rawName.length <= 32) {
      tokenSet.add(rawName);
      const rawStem = rawName.replace(/\.js$/i, "");
      if (rawStem.length > 1) tokenSet.add(rawStem);
    }
  }

  const roleStrings = [
    ...(profile?.preferences?.targetRoles || []),
    ...(profile?.careerProfile?.targetRoles || []).map(
      (role) => role?.customRoleLabel || String(role?.roleCode || "").replace(/[-_]+/g, " "),
    ),
    ...(profile?.roles || []).map((role) => role?.title),
  ].filter(Boolean);

  for (const roleText of roleStrings) {
    for (const token of splitNormalizedTokens(roleText)) {
      tokenSet.add(token);
    }
  }

  for (const occCode of profile?.preferences?.occupationCodes || []) {
    const clean = String(occCode || "")
      .trim()
      .toLowerCase();
    if (clean) tokenSet.add(`occ:${clean}`);
  }

  const countrySet = new Set(
    [
      ...profileApplicantCountries(profile || {}),
      ...(profile?.preferences?.preferredCountryCodes || []).map((code) =>
        String(code || "").toUpperCase(),
      ),
    ].filter((code) => /^[A-Z]{2}$/.test(code)),
  );

  return {
    matchTokens: [...tokenSet].slice(0, 64),
    matchCountryCodes: [...countrySet].slice(0, 20),
  };
}

/**
 * Extract bounded demand tokens and country codes from a batch of newly ingested or updated jobs.
 */
export function extractBatchJobDemandIndex(
  jobs = [],
  { maxTokens = INCREMENTAL_MATCH_BUDGET.maxJobTokens } = {},
) {
  const tokenCounts = new Map();
  const occupationCodes = new Set();
  const countryCodes = new Set();
  let hasWorldwideOrUnknown = false;

  const bumpToken = (token, weight = 1) => {
    const clean = String(token || "")
      .trim()
      .toLowerCase();
    if (!clean || clean.length < 2 || clean.length > 36) return;
    tokenCounts.set(clean, (tokenCounts.get(clean) || 0) + weight);
  };

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || job.status === "closed") continue;
    for (const token of job?.features?.titleTokens || splitNormalizedTokens(job?.title || "")) {
      bumpToken(token, 3);
    }
    for (const skill of job?.features?.skills || []) {
      bumpToken(canonicalSkill(skill) || skill, 2);
    }
    for (const occCode of job?.occupationCodes || []) {
      const clean = String(occCode || "")
        .trim()
        .toLowerCase();
      if (clean) {
        occupationCodes.add(clean);
        bumpToken(`occ:${clean}`, 2);
      }
    }
    if (job?.occupation && job.occupation !== "unclassified") {
      bumpToken(job.occupation, 1);
    }

    const scope =
      job?.eligibility?.remoteScope || job?.structuredLocation?.remoteScope || "unknown";
    if (scope === "worldwide" || scope === "unknown") {
      hasWorldwideOrUnknown = true;
    }
    const jobCountries = [
      job?.structuredLocation?.countryCode,
      ...(job?.structuredLocation?.eligibleCountryCodes || []),
      ...(job?.eligibility?.countries || []),
    ]
      .map((code) => String(code || "").toUpperCase())
      .filter((code) => /^[A-Z]{2}$/.test(code));
    if (!jobCountries.length) {
      hasWorldwideOrUnknown = true;
    } else {
      for (const code of jobCountries) countryCodes.add(code);
    }
  }

  const sortedTokens = [...tokenCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, Number(maxTokens) || INCREMENTAL_MATCH_BUDGET.maxJobTokens))
    .map(([token]) => token);

  return {
    tokens: sortedTokens,
    tokenWeights: Object.fromEntries(
      sortedTokens.map((token) => [token, tokenCounts.get(token) || 1]),
    ),
    occupationCodes: [...occupationCodes].slice(0, 20),
    countryCodes: [...countryCodes],
    hasWorldwideOrUnknown,
  };
}

/**
 * Score and rank candidate profiles against a batch of new jobs, enforcing the
 * per-run user recompute budget.
 */
export function rankAffectedProfilesForNewJobs(
  profiles = [],
  batchIndex = {},
  {
    maxUsers = INCREMENTAL_MATCH_BUDGET.maxUsersPerRun,
    minOverlap = INCREMENTAL_MATCH_BUDGET.minTokenOverlap,
  } = {},
) {
  const tokens = Array.isArray(batchIndex?.tokens) ? batchIndex.tokens : [];
  if (!tokens.length) return [];
  const tokenSet = new Set(tokens);
  const weights = batchIndex?.tokenWeights || {};
  const jobCountrySet = new Set(batchIndex?.countryCodes || []);
  const allowAnyCountry = Boolean(batchIndex?.hasWorldwideOrUnknown || jobCountrySet.size === 0);
  const cap = Math.max(1, Number(maxUsers) || INCREMENTAL_MATCH_BUDGET.maxUsersPerRun);
  const minHits = Math.max(1, Number(minOverlap) || INCREMENTAL_MATCH_BUDGET.minTokenOverlap);

  const scored = [];
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!profile?.userId) continue;
    const indexed =
      Array.isArray(profile.matchTokens) && profile.matchTokens.length
        ? {
            matchTokens: profile.matchTokens,
            matchCountryCodes: profile.matchCountryCodes || [],
          }
        : buildProfileMatchIndex(profile);

    if (!allowAnyCountry && indexed.matchCountryCodes.length > 0) {
      const countryMatch = indexed.matchCountryCodes.some((code) => jobCountrySet.has(code));
      if (!countryMatch) continue;
    }

    const matchedTokens = indexed.matchTokens.filter((token) => tokenSet.has(token));
    if (matchedTokens.length < minHits) continue;

    const overlapScore = matchedTokens.reduce(
      (sum, token) => sum + (Number(weights[token]) || 1),
      0,
    );
    scored.push({
      userId: String(profile.userId),
      profileVersion: Number(profile.version) || 1,
      overlapScore,
      matchedTokenCount: matchedTokens.length,
      matchedTokens: matchedTokens.slice(0, 10),
      updatedAtMs: profile.updatedAt ? new Date(profile.updatedAt).getTime() : 0,
    });
  }

  scored.sort(
    (a, b) =>
      b.overlapScore - a.overlapScore ||
      b.matchedTokenCount - a.matchedTokenCount ||
      b.updatedAtMs - a.updatedAtMs ||
      a.userId.localeCompare(b.userId),
  );

  return scored.slice(0, cap).map(({ updatedAtMs: _updatedAtMs, ...rest }) => rest);
}

/**
 * Query MongoDB using the Profile `matchTokens` multikey index to find only
 * affected users for newly ingested jobs within a bounded per-run budget.
 */
export async function findAffectedUsersForNewJobs(
  newJobs = [],
  { maxUsers = INCREMENTAL_MATCH_BUDGET.maxUsersPerRun } = {},
) {
  const batchIndex = extractBatchJobDemandIndex(newJobs);
  if (!batchIndex.tokens.length || !isMongoReady()) {
    return {
      affectedUsers: [],
      candidateCount: 0,
      budgetMaxUsers: maxUsers,
      batchTokens: batchIndex.tokens,
    };
  }
  const safeMax = Math.max(1, Number(maxUsers) || INCREMENTAL_MATCH_BUDGET.maxUsersPerRun);
  const fetchCap = Math.min(1000, safeMax * 3);
  const query = {
    matchTokens: { $in: batchIndex.tokens },
  };
  const candidates = await Profile.find(query)
    .sort({ updatedAt: -1 })
    .limit(fetchCap)
    .select("userId version updatedAt matchTokens matchCountryCodes")
    .lean();

  const affectedUsers = rankAffectedProfilesForNewJobs(candidates, batchIndex, {
    maxUsers: safeMax,
  });

  return {
    affectedUsers,
    candidateCount: candidates.length,
    budgetMaxUsers: safeMax,
    batchTokens: batchIndex.tokens,
  };
}
