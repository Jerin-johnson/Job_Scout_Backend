import { jobIngestionService } from "../../external-services/jobs/ingestion/JobIngestionEngine.js";
import { profileRepository } from "../../database/mongoose/repositories/MongooseProfileRepository.js";
import { embeddingService } from "../embeddingService.js";
import { Match } from "../../database/mongoose/models/MatchModel.js";
import { isMongoReady } from "../../database/database.js";
import { acceptQuota } from "../../../presentation/http/middleware/quotaGate.js";
import { logger } from "../../../shared/utils/logger.js";
import {
  scoreJobMatch,
  MATCH_SCORE_VERSION,
  extractJobFeatures,
} from "../../../domain/services/jobs/matching.js";
import { HiddenJob } from "../../database/mongoose/models/HiddenJobModel.js";
import { PLACE_SUGGESTIONS } from "../../../domain/services/profile/profileSuggestionCatalog.js";
import { profileApplicantCountries } from "../../../domain/services/jobs/eligibility.js";
import { latestReferenceRates } from "../../database/mongoose/repositories/MongooseFxRateRepository.js";
import type { IProfileDocument } from "../../database/mongoose/models/ProfileModel.js";

export interface UserLike {
  _id?: unknown;
  id?: string;
  name?: string;
  email?: string;
  plan?: string;
  profileVersion?: number;
  [key: string]: unknown;
}

export interface CandidateJob {
  _id?: unknown;
  contentHash?: string;
  title?: string;
  company?: string;
  location?: string;
  remoteType?: string;
  locationTier?: number;
  structuredLocation?: {
    state?: string;
    region?: string;
    country?: string;
    countryCode?: string;
    eligibleCountryCodes?: string[];
    remoteScope?: string;
  };
  eligibility?: {
    countries?: string[];
    remoteScope?: string;
  };
  salaryRange?: {
    min?: number;
    max?: number;
  };
  postedAt?: Date | string;
  postedDateKnown?: boolean;
  features?: unknown;
  embedding?: unknown[];
  sourceUrl?: string;
  sourceBoard?: string;
  [key: string]: unknown;
}

export interface FinalizedMatch {
  userId: string;
  jobId: string;
  score: number;
  scoreBand: string;
  scoreVersion: string;
  scoreBreakdown?: unknown;
  rationale: string;
  reasons: string[];
  matchingSkills: unknown[];
  missingSkills: unknown[];
  features: unknown;
  locationTier?: number;
  locationLabel: string;
  eligibility?: unknown;
  eligibilityDetails?: unknown;
  title: string;
  company: string;
  location?: string;
  sourceUrl?: string;
  sourceBoard?: string;
  salaryRange?: { min?: number; max?: number };
  postedAt?: Date | string;
  jobDetails: {
    title: string;
    company: string;
    location?: string;
    salaryRange?: { min?: number; max?: number };
    sourceUrl?: string;
    sourceBoard?: string;
  };
}

export interface DiscoveryFunnel {
  catalogSize: number;
  afterStatusDates: number;
  afterWorkMode: number;
  candidateCap: number;
  lexicalCandidates: number;
  afterLocationTiering: number;
  candidatesWithEmbeddings: number;
  profileEmbeddingAvailable: boolean;
  embeddingProvider: string;
  embeddingDimension: number;
  afterScoreThreshold: number;
  fallbackUnderThreshold: number;
  written: number;
  returned: number;
  scoreVersion: string;
}

export interface DiscoveryResult {
  totalCandidates?: number;
  matches: FinalizedMatch[];
  locationTier?: number | null;
  locationLabel?: string;
  funnel?: DiscoveryFunnel;
  emptyReason: string;
  broadenActions: string[];
}

interface InMemMatch extends FinalizedMatch {
  userFeedback?: string;
  feedbackReason?: string;
}

const inMemoryMatches: InMemMatch[] = [];

const locationAliases = new Map<string, string>([
  ["cochin", "kochi"],
  ["trivandrum", "thiruvananthapuram"],
  ["bombay", "mumbai"],
  ["bangalore", "bengaluru"],
]);

const locationGroups = new Map<string, string[]>([
  ["kochi", ["kochi", "kerala", "india"]],
  ["thiruvananthapuram", ["thiruvananthapuram", "kerala", "india"]],
  ["bengaluru", ["bengaluru", "karnataka", "india"]],
  ["mumbai", ["mumbai", "maharashtra", "india"]],
  ["dubai", ["dubai", "uae", "united arab emirates"]],
  ["london", ["london", "united kingdom", "uk"]],
  ["kerala", ["kerala", "india"]],
  ["india", ["india"]],
]);

function normalizeLocation(value: unknown = ""): string {
  const normalized = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return locationAliases.get(normalized) || normalized;
}

export function locationTierForJob(
  job: CandidateJob | Record<string, unknown>,
  locations: string[] = [],
  countryCodes: string[] = [],
): number {
  if (!locations.length) return 1;
  const location = normalizeLocation(job.location);
  const structured = (job.structuredLocation || {}) as {
    state?: string;
    region?: string;
    country?: string;
    countryCode?: string;
    eligibleCountryCodes?: string[];
    remoteScope?: string;
  };
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
    const eligible = [
      ...(structured.eligibleCountryCodes || []),
      ...((job.eligibility as { countries?: string[] } | undefined)?.countries || []),
    ].map((code) => String(code).toUpperCase());
    const remoteScope =
      (job.eligibility as { remoteScope?: string } | undefined)?.remoteScope ||
      structured.remoteScope;
    if (countryCodes.length && countryCodes.some((code) => eligible.includes(code))) return 3;
    if (
      !eligible.length &&
      (!remoteScope ||
        remoteScope === "unknown" ||
        remoteScope === "country" ||
        remoteScope === "region")
    )
      return 3;
    if (remoteScope === "worldwide") return 4;
  }
  return 2;
}

interface CareerLocationEntry {
  cityCode?: string;
  scope?: string;
  countryCode?: string;
}

function careerProfileLocationLabels(
  profile: {
    careerProfile?: { homeLocation?: CareerLocationEntry; targetLocations?: CareerLocationEntry[] };
  } = {},
): string[] {
  const locationEntries = [
    profile.careerProfile?.homeLocation,
    ...(profile.careerProfile?.targetLocations || []),
  ];
  const items: string[] = [];
  for (const entry of locationEntries) {
    if (!entry) continue;
    if (entry.cityCode) {
      const place = PLACE_SUGGESTIONS.find((item) => item.code === entry.cityCode);
      if (place) {
        if (place.label) {
          if (Array.isArray(place.label)) items.push(...place.label.map(String));
          else items.push(String(place.label));
        }
        if (place.country) {
          if (Array.isArray(place.country)) items.push(...place.country.map(String));
          else items.push(String(place.country));
        }
      }
    } else if (entry.scope === "anywhere_in_india") {
      items.push("India");
    } else if (entry.countryCode) {
      const country = PLACE_SUGGESTIONS.find(
        (item) => item.countryCode === entry.countryCode,
      )?.country;
      if (country) {
        if (Array.isArray(country)) items.push(...country.map(String));
        else items.push(String(country));
      }
    }
  }
  return [...new Set(items)];
}

export async function persistMatchesBulk(
  matches: FinalizedMatch[],
): Promise<{ roundTrips: number }> {
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

export interface RunDiscoveryOptions {
  idempotencyKey?: string;
  quotaAccepted?: boolean;
  broaden?: boolean;
}

export const discoveryGraph = {
  /** Deterministic lexical-first matching; embeddings are an optional rerank only. */
  async runDiscovery(
    user: UserLike,
    { idempotencyKey, quotaAccepted = false, broaden = false }: RunDiscoveryOptions = {},
  ): Promise<DiscoveryResult> {
    const userId = user._id ? String(user._id) : String(user.id || "anon");

    // 1. Fetch user profile
    const profile = await profileRepository.findByUserId(userId);
    if (!profile) {
      throw new Error("Candidate profile is required before running discovery matching");
    }

    if (!quotaAccepted)
      await acceptQuota(
        user as unknown as Parameters<typeof acceptQuota>[0],
        "match_jobs",
        idempotencyKey || `discovery:${userId}:${Date.now()}`,
      );

    const pObj = profile as unknown as {
      preferences?: {
        remotePreference?: "remote" | "hybrid" | "onsite" | "any";
        preferredLocations?: string[];
        preferredCountryCodes?: string[];
        occupationCodes?: string[];
        minimumSalaryUsd?: number;
        targetRoles?: string[];
      };
      careerProfile?: {
        homeLocation?: CareerLocationEntry;
        targetLocations?: CareerLocationEntry[];
        targetRoles?: unknown[];
        experience?: { isFresher?: boolean; confirmedYears?: number };
      };
      skills?: unknown[];
      roles?: unknown[];
      toObject?: () => Record<string, unknown>;
    };

    // Discovery is read-only with respect to the catalog. Scheduled workers own ingestion.
    const matchProfile = broaden
      ? {
          ...pObj,
          preferences: {
            ...pObj.preferences,
            remotePreference: "any" as const,
            preferredCountryCodes: [],
            occupationCodes: [],
            minimumSalaryUsd: 0,
          },
          careerProfile: pObj.careerProfile
            ? { ...pObj.careerProfile, targetLocations: [] }
            : undefined,
        }
      : pObj;

    const hiddenJobIds = isMongoReady() ? await HiddenJob.distinct("jobId", { userId }) : [];
    const ingestion = jobIngestionService as unknown as {
      getCandidateJobs: (opts: Record<string, unknown>) => Promise<
        CandidateJob[] & {
          retrievalStats?: {
            activeCatalogCount: number;
            eligibleCount: number;
            candidateCap: number;
            lexicalCandidateCount: number;
          };
        }
      >;
    };
    const jobs = await ingestion.getCandidateJobs({
      profile: matchProfile,
      limit: 400,
      excludeJobIds: hiddenJobIds,
    });
    const retrieval = jobs.retrievalStats || {
      activeCatalogCount: jobs.length,
      eligibleCount: jobs.length,
      candidateCap: 400,
      lexicalCandidateCount: 0,
    };

    if (jobs.length === 0) {
      const allCandidates = await ingestion.getCandidateJobs({
        profile: { preferences: {} },
        limit: 1,
      });
      const preferences = matchProfile.preferences || {};
      const broadenActions: string[] = [];
      if (preferences.preferredCountryCodes?.length) broadenActions.push("broaden_country");
      if (preferences.occupationCodes?.length) broadenActions.push("broaden_role");
      if ((preferences.minimumSalaryUsd || 0) > 0)
        broadenActions.push("include_salary_unknown_or_lower");
      if (preferences.remotePreference && preferences.remotePreference !== "any")
        broadenActions.push("broaden_work_mode");
      return {
        matches: [],
        emptyReason: allCandidates.length ? "active_jobs_removed_by_filters" : "catalog_empty",
        broadenActions,
      };
    }

    const cp = pObj.careerProfile;
    const usableProfile = Boolean(
      pObj.skills?.length ||
      pObj.roles?.length ||
      pObj.preferences?.targetRoles?.length ||
      cp?.targetRoles?.length ||
      cp?.experience?.isFresher ||
      Number.isFinite(cp?.experience?.confirmedYears),
    );
    if (!usableProfile) return { matches: [], emptyReason: "profile_missing", broadenActions: [] };

    // 5. Rule Filter: salary and work arrangement. Location uses ranked
    // fallback tiers and never hard-excludes a remote job by city text.
    const preferences = pObj.preferences || {};
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
        job.salaryRange?.max &&
        job.salaryRange.max > 0 &&
        job.salaryRange.max < preferences.minimumSalaryUsd
      ) {
        return false;
      }

      return true;
    });

    const locations = [
      ...new Set(
        [
          ...(preferences.preferredLocations || []),
          ...careerProfileLocationLabels(matchProfile),
        ].filter(Boolean),
      ),
    ].slice(0, 10);
    const countryCodes = profileApplicantCountries(matchProfile as unknown as IProfileDocument);
    for (const candidate of filtered)
      candidate.locationTier = locationTierForJob(candidate, locations, countryCodes);
    const bestTier = filtered.length
      ? Math.min(...filtered.map((item) => item.locationTier || 2))
      : null;
    const tiered =
      bestTier === null ? [] : filtered.filter((item) => item.locationTier === bestTier);
    const preferredLocation = locations[0] || "your preferred location";
    const locationLabel =
      bestTier === 1
        ? `Jobs matching ${preferredLocation}`
        : bestTier === 2
          ? `Showing regional roles for ${preferredLocation}`
          : bestTier === 3
            ? `No jobs in ${preferredLocation} yet. Showing remote roles; confirm location eligibility before applying.`
            : `No jobs in ${preferredLocation} yet. Showing global remote roles.`;
    const fxRates =
      (MATCH_SCORE_VERSION as string) === "lexical-v4"
        ? await latestReferenceRates().catch(() => null)
        : null;
    const scoredCandidates = tiered.map((job) => {
      const result = scoreJobMatch(
        profile as unknown as IProfileDocument,
        { ...job, locationTier: job.locationTier },
        {
          ratesPerEur:
            (fxRates as { ratesPerEur?: Record<string, number> } | null)?.ratesPerEur || null,
        } as unknown as Parameters<typeof scoreJobMatch>[2],
      );
      return { job, ...result };
    });
    const scored = scoredCandidates.filter((candidate) => !candidate.hardBlocked);
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        Number(Boolean(b.job.postedDateKnown)) - Number(Boolean(a.job.postedDateKnown)) ||
        new Date(b.job.postedAt || 0).getTime() - new Date(a.job.postedAt || 0).getTime(),
    );
    const selected = scored.slice(0, 20);
    const finalizedMatches: FinalizedMatch[] = selected.map(
      ({
        job,
        score,
        band,
        reasons,
        matchingSkills,
        missingSkills,
        breakdown,
        features,
        eligibility,
        eligibilityDetails,
      }) => ({
        userId,
        jobId: job._id ? String(job._id) : String(job.contentHash || ""),
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
        eligibility,
        eligibilityDetails,
        title: job.title || "Job Title",
        company: job.company || "Company",
        location: job.location,
        sourceUrl: job.sourceUrl,
        sourceBoard: job.sourceBoard,
        salaryRange: job.salaryRange,
        postedAt: job.postedAt,
        jobDetails: {
          title: job.title || "Job Title",
          company: job.company || "Company",
          location: job.location,
          salaryRange: job.salaryRange,
          sourceUrl: job.sourceUrl,
          sourceBoard: job.sourceBoard,
        },
      }),
    );

    await persistMatchesBulk(finalizedMatches);

    const funnel: DiscoveryFunnel = {
      catalogSize: retrieval.activeCatalogCount,
      afterStatusDates: retrieval.activeCatalogCount,
      afterWorkMode: retrieval.eligibleCount,
      candidateCap: retrieval.candidateCap,
      lexicalCandidates: retrieval.lexicalCandidateCount,
      afterLocationTiering: tiered.length,
      candidatesWithEmbeddings: jobs.filter((job) => (job.embedding?.length || 0) > 0).length,
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
      broadenActions: [],
    };
  },

  async getUserMatches(userId: string | unknown): Promise<unknown[]> {
    const uid = String(userId);
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

  async recordFeedback(
    userId: string | unknown,
    jobId: string | unknown,
    feedback: string,
    reason = "",
  ): Promise<unknown> {
    const uid = String(userId);
    const jid = String(jobId);

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
