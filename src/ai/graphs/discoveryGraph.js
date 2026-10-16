import { jobIngestionService } from "../../services/jobs/jobIngestionService.js";
import { profileRepository } from "../../repositories/profileRepository.js";
import { embeddingService } from "../../services/embeddingService.js";
import { Match } from "../../models/Match.js";
import { isMongoReady } from "../../config/database.js";
import { acceptQuota } from "../../middleware/quotaGate.js";
import { logger } from "../../shared/utils/logger.js";
import { scoreJobMatch, MATCH_SCORE_VERSION, extractJobFeatures } from "../../services/jobs/matching.js";
import { HiddenJob } from "../../models/HiddenJob.js";

const inMemoryMatches = [];

const locationAliases = new Map([
  ["cochin", "kochi"],
  ["trivandrum", "thiruvananthapuram"],
  ["bombay", "mumbai"],
  ["bangalore", "bengaluru"],
]);
const locationGroups = new Map([
  ["kochi", ["kochi", "kerala", "india"]],
  ["thiruvananthapuram", ["thiruvananthapuram", "kerala", "india"]],
  ["bengaluru", ["bengaluru", "karnataka", "india"]],
  ["mumbai", ["mumbai", "maharashtra", "india"]],
  ["dubai", ["dubai", "uae", "united arab emirates"]],
  ["london", ["london", "united kingdom", "uk"]],
  ["kerala", ["kerala", "india"]],
  ["india", ["india"]],
]);
function normalizeLocation(value = "") {
  const normalized = String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return locationAliases.get(normalized) || normalized;
}
export function locationTierForJob(job, locations = [], countryCodes = []) {
  if (!locations.length) return 1;
  const location = normalizeLocation(job.location);
  const structured = job.structuredLocation || {};
  const exact = locations.some((value) => {
    const wanted = normalizeLocation(value);
    return wanted && location && (location.includes(wanted) || wanted.includes(location));
  });
  if (exact) return 1;
  const regionValues = [
    structured.state,
    structured.region,
    structured.country,
    structured.countryCode,
    job.location,
  ].map(normalizeLocation);
  if (
    locations.some((value) => {
      const wanted = normalizeLocation(value);
      const group = locationGroups.get(wanted) || [wanted];
      return (
        wanted &&
        (regionValues.some(
          (item) => item && group.some((term) => item.includes(term) || term.includes(item)),
        ) ||
          group.some((term) => regionValues.includes(term)))
      );
    })
  )
    return 2;
  if (job.remoteType === "remote") {
    const eligible = (structured.eligibleCountryCodes || []).map((code) =>
      String(code).toUpperCase(),
    );
    if (countryCodes.length && countryCodes.some((code) => eligible.includes(code))) return 3;
    if (
      !eligible.length &&
      (!structured.remoteScope ||
        structured.remoteScope === "unknown" ||
        structured.remoteScope === "country" ||
        structured.remoteScope === "region")
    )
      return 3;
    if (structured.remoteScope === "worldwide") return 4;
  }
  return 2;
}

export async function persistMatchesBulk(matches) {
  if (!isMongoReady() || !matches.length) return { roundTrips: 0 };
  await Match.bulkWrite(
    matches.map((match) => ({
      updateOne: {
        filter: { userId: match.userId, jobId: match.jobId },
        update: { $set: match },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return { roundTrips: 1 };
}

export const discoveryGraph = {
  /** Deterministic lexical-first matching; embeddings are an optional rerank only. */
  async runDiscovery(
    user,
    { idempotencyKey, quotaAccepted = false, broaden = false } = {},
  ) {
    const userId = user._id ? user._id.toString() : user.id;

    // 1. Fetch user profile
    const profile = await profileRepository.findByUserId(userId);
    if (!profile) {
      throw new Error("Candidate profile is required before running discovery matching");
    }

    if (!quotaAccepted)
      await acceptQuota(user, "match_jobs", idempotencyKey || `discovery:${userId}:${Date.now()}`);

    // Discovery is read-only with respect to the catalog. Scheduled workers own ingestion.
    const matchProfile = broaden
      ? {
          ...profile,
          preferences: {
            ...profile.preferences,
            remotePreference: "any",
            preferredCountryCodes: [],
            occupationCodes: [],
            minimumSalaryUsd: 0,
          },
        }
      : profile;
    const hiddenJobIds = isMongoReady() ? await HiddenJob.distinct("jobId", { userId }) : [];
    const jobs = await jobIngestionService.getCandidateJobs({ profile: matchProfile, limit: 400, excludeJobIds: hiddenJobIds });
    const retrieval = jobs.retrievalStats || { activeCatalogCount: jobs.length, eligibleCount: jobs.length, candidateCap: 400, lexicalCandidateCount: 0 };

    if (jobs.length === 0) {
      const allCandidates = await jobIngestionService.getCandidateJobs({
        profile: { preferences: {} },
        limit: 1,
      });
      const preferences = matchProfile.preferences || {};
      const broadenActions = [];
      if (preferences.preferredCountryCodes?.length) broadenActions.push("broaden_country");
      if (preferences.occupationCodes?.length) broadenActions.push("broaden_role");
      if (preferences.minimumSalaryUsd > 0) broadenActions.push("include_salary_unknown_or_lower");
      if (preferences.remotePreference && preferences.remotePreference !== "any")
        broadenActions.push("broaden_work_mode");
      return {
        matches: [],
        emptyReason: allCandidates.length ? "active_jobs_removed_by_filters" : "catalog_empty",
        broadenActions,
      };
    }

    const usableProfile = Boolean(profile.skills?.length || profile.roles?.length || profile.preferences?.targetRoles?.length);
    if (!usableProfile) return { matches: [], emptyReason: "profile_missing", broadenActions: [] };

    // 5. Rule Filter: salary and work arrangement. Location uses ranked
    // fallback tiers and never hard-excludes a remote job by city text.
    const preferences = profile.preferences || {};
    const filtered = jobs.filter((job) => {
      // Remote preference rule
      if (
        preferences.remotePreference &&
        preferences.remotePreference !== "any" &&
        job.remoteType !== preferences.remotePreference
      ) {
        // If candidate strictly wants remote, exclude onsite
        if (preferences.remotePreference === "remote" && job.remoteType === "onsite") {
          return false;
        }
      }

      // Minimum salary rule
      if (
        preferences.minimumSalaryUsd &&
        preferences.minimumSalaryUsd > 0 &&
        job.salaryRange?.max > 0 &&
        job.salaryRange.max < preferences.minimumSalaryUsd
      ) {
        return false;
      }

      return true;
    });

    const locations = (preferences.preferredLocations || []).filter(Boolean).slice(0, 5);
    const countryCodes = (preferences.preferredCountryCodes || []).map((code) =>
      String(code).toUpperCase(),
    );
    for (const candidate of filtered)
      candidate.locationTier = locationTierForJob(candidate, locations, countryCodes);
    const bestTier = filtered.length
      ? Math.min(...filtered.map((item) => item.locationTier))
      : null;
    const tiered = bestTier === null ? [] : filtered.filter((item) => item.locationTier === bestTier);
    const preferredLocation = locations[0] || "your preferred location";
    const locationLabel =
      bestTier === 1
        ? `Jobs matching ${preferredLocation}`
        : bestTier === 2
          ? `Showing regional roles for ${preferredLocation}`
          : bestTier === 3
            ? `No jobs in ${preferredLocation} yet. Showing remote roles; confirm location eligibility before applying.`
            : `No jobs in ${preferredLocation} yet. Showing global remote roles.`;
    const scoredCandidates = tiered.map((job) => {
      const result = scoreJobMatch(profile, { ...job, locationTier: job.locationTier });
      return { job, ...result };
    });
    const scored = scoredCandidates.filter((candidate) => !candidate.hardBlocked);
    scored.sort((a, b) => b.score - a.score || Number(Boolean(b.job.postedDateKnown)) - Number(Boolean(a.job.postedDateKnown)) || new Date(b.job.postedAt || 0) - new Date(a.job.postedAt || 0));
    const selected = scored.slice(0, 20);
    const finalizedMatches = selected.map(({ job, score, band, reasons, matchingSkills, missingSkills, breakdown, features }) => ({
      userId,
      jobId: job._id ? job._id.toString() : job.contentHash,
      score,
      scoreBand: band,
      scoreVersion: MATCH_SCORE_VERSION,
      scoreBreakdown: breakdown,
      rationale: reasons.join(" · "),
      reasons,
      matchingSkills,
      missingSkills,
      features: job.features || features || extractJobFeatures(job),
      locationTier: job.locationTier,
      locationLabel,
      title: job.title,
      company: job.company,
      location: job.location,
      sourceUrl: job.sourceUrl,
      sourceBoard: job.sourceBoard,
      salaryRange: job.salaryRange,
      postedAt: job.postedAt,
      jobDetails: {
        title: job.title,
        company: job.company,
        location: job.location,
        salaryRange: job.salaryRange,
        sourceUrl: job.sourceUrl,
        sourceBoard: job.sourceBoard,
      },
    }));

    await persistMatchesBulk(finalizedMatches);

    const funnel = {
      catalogSize: retrieval.activeCatalogCount,
      afterStatusDates: retrieval.activeCatalogCount,
      afterWorkMode: retrieval.eligibleCount,
      candidateCap: retrieval.candidateCap,
      lexicalCandidates: retrieval.lexicalCandidateCount,
      afterLocationTiering: tiered.length,
      candidatesWithEmbeddings: jobs.filter((job) => job.embedding?.length > 0).length,
      profileEmbeddingAvailable: false,
      embeddingProvider: embeddingService.getConfig().provider,
      embeddingDimension: embeddingService.getConfig().dimension,
      afterScoreThreshold: scored.filter((item) => item.score >= 50).length,
      fallbackUnderThreshold: scored.filter((item) => item.score < 50).length,
      written: finalizedMatches.length,
      returned: finalizedMatches.length,
      scoreVersion: MATCH_SCORE_VERSION,
    };
    logger.info({ event: "job_match_funnel", ...funnel }, "Job match funnel completed");

    return {
      totalCandidates: filtered.length,
      matches: finalizedMatches,
      locationTier: bestTier,
      locationLabel,
      funnel,
      emptyReason: scored.length ? "" : tiered.length ? "known_hard_blockers" : "no_candidates",
    };
  },

  async getUserMatches(userId) {
    const uid = userId.toString();
    if (isMongoReady()) {
      return Match.find({ userId: uid, scoreVersion: MATCH_SCORE_VERSION })
        .populate(
          "jobId",
          "title company location sourceUrl salaryRange sourceBoard postedAt postedDateKnown createdAt",
        )
        .sort({ score: -1 })
        .limit(20)
        .lean();
    }
    return inMemoryMatches.filter((m) => m.userId === uid);
  },

  async recordFeedback(userId, jobId, feedback, reason = "") {
    const uid = userId.toString();
    const jid = jobId.toString();

    if (isMongoReady()) {
      return Match.findOneAndUpdate(
        { userId: uid, jobId: jid },
        { $set: { userFeedback: feedback, feedbackReason: reason } },
        { new: true },
      ).lean();
    }

    const match = inMemoryMatches.find((m) => m.userId === uid && m.jobId === jid);
    if (match) {
      match.userFeedback = feedback;
      match.feedbackReason = reason;
      return match;
    }
    return null;
  },
};
