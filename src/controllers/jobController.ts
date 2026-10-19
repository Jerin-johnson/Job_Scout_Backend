import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { discoveryGraph } from "../ai/graphs/discoveryGraph.js";
import { get, set, del, CacheKeys, TTL } from "../shared/cache.js";
import { longTermMemory } from "../ai/memory/longTerm.js";
import { jobIngestionService } from "../services/jobs/jobIngestionService.js";
import { latestEcbReferenceRates, convertAmount, isFxRateStale } from "../services/jobs/fxRates.js";
import { getJobRiskFlags } from "../services/jobs/jobRisk.js";
import { classifyEligibility, profileApplicantCountries } from "../services/jobs/eligibility.js";
import { requestCompanyTracking } from "../services/jobs/trackedCompanyService.js";
import { getMatchRefresh, requestMatchRefresh } from "../services/matchRefreshService.js";
import { profileRepository } from "../repositories/profileRepository.js";
import {
  MATCH_SCORE_VERSION,
  scoreJobMatch,
  extractJobFeatures,
} from "../services/jobs/matching.js";
import { Job } from "../models/Job.js";
import { JobDetail } from "../models/JobDetail.js";
import { JobVector } from "../models/JobVector.js";
import { HiddenJob } from "../models/HiddenJob.js";
import { suggestTargetRoleCorrections } from "../services/jobs/roleNormalization.js";
import { recordInteraction, recordImpressions } from "../services/jobs/interactionEvents.js";
import { getCatalogVersion } from "../services/jobs/catalogVersion.js";
import { savedSearchService } from "../services/jobs/savedSearchService.js";

const feedbackSchema = z.object({
  feedback: z.enum(["thumbs_up", "thumbs_down"]),
  reason: z.string().optional().default(""),
});

const savedSearchFiltersSchema = z
  .object({
    q: z.string().trim().max(120).optional().default(""),
    location: z.string().trim().max(120).optional().default(""),
    countryCode: z.string().trim().max(2).optional().default(""),
    occupation: z.string().trim().max(60).optional().default(""),
    remoteType: z.enum(["", "remote", "hybrid", "onsite"]).optional().default(""),
    source: z.string().trim().max(60).optional().default(""),
    postedWithinDays: z.number().int().min(0).max(365).optional().default(0),
    minimumSalaryInr: z.number().min(0).nullable().optional().default(null),
    eligibility: z.enum(["", "eligible", "unknown"]).optional().default(""),
    showAnyway: z.boolean().optional().default(false),
  })
  .default({});

const quietHoursSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    startHourUtc: z.number().int().min(0).max(23).optional().default(22),
    endHourUtc: z.number().int().min(0).max(23).optional().default(7),
  })
  .optional();

const createSavedSearchSchema = z.object({
  name: z.string().trim().max(80).optional(),
  filters: savedSearchFiltersSchema,
  alertFrequency: z.enum(["none", "instant", "daily"]).optional().default("daily"),
  alertChannels: z
    .array(z.enum(["in_app", "email"]))
    .min(1)
    .max(2)
    .optional()
    .default(["in_app", "email"]),
  quietHours: quietHoursSchema,
  enabled: z.boolean().optional().default(true),
});

const updateSavedSearchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  filters: savedSearchFiltersSchema.optional(),
  alertFrequency: z.enum(["none", "instant", "daily"]).optional(),
  alertChannels: z
    .array(z.enum(["in_app", "email"]))
    .min(1)
    .max(2)
    .optional(),
  quietHours: quietHoursSchema,
  enabled: z.boolean().optional(),
});

interface MatchRecord {
  jobId?: unknown;
  jobDetails?: Record<string, unknown>;
  title?: string;
  company?: string;
  location?: string;
  sourceUrl?: string;
  sourceBoard?: string;
  salaryRange?: unknown;
  score?: number;
  scoreBand?: string;
  scoreVersion?: string;
  scoreBreakdown?: Record<string, unknown>;
  reasons?: string[];
  rationale?: string;
  matchingSkills?: string[];
  missingSkills?: string[];
  postedAt?: Date | string | null;
  postedDateKnown?: boolean;
  locationTier?: number | null;
  locationLabel?: string;
  eligibility?: string;
  eligibilityDetails?: Record<string, unknown>;
  [key: string]: unknown;
}

function serializeMatch(match: MatchRecord): Record<string, unknown> {
  const job =
    match.jobId && typeof match.jobId === "object"
      ? (match.jobId as Record<string, unknown>)
      : match.jobDetails || {};
  const postedDateKnown =
    job.postedDateKnown ??
    (job.postedAt && job.createdAt
      ? Math.abs(new Date(job.postedAt as string).getTime() - new Date(job.createdAt as string).getTime()) >
        5 * 60_000
      : false);

  const score = typeof match.score === "number" ? match.score : 0;

  return {
    jobId: String(job._id || match.jobId || ""),
    title: match.title || job.title || "Job title unavailable",
    company: match.company || job.company || "Company unavailable",
    location: match.location || job.location || "",
    sourceUrl: match.sourceUrl || job.sourceUrl || "",
    sourceBoard: match.sourceBoard || job.sourceBoard || "",
    salaryRange: match.salaryRange || job.salaryRange,
    score,
    scoreBand:
      match.scoreBand ||
      (score >= 80
        ? "strong"
        : score >= 65
          ? "good"
          : score >= 50
            ? "fair"
            : "low"),
    scoreVersion: match.scoreVersion || "legacy",
    scoreBreakdown: match.scoreBreakdown || {},
    reasons: match.reasons || (match.rationale ? [match.rationale] : []),
    rationale: match.rationale,
    matchingSkills: match.matchingSkills || [],
    missingSkills: match.missingSkills || [],
    postedAt: postedDateKnown ? match.postedAt || job.postedAt || null : null,
    postedDateKnown: Boolean(postedDateKnown),
    locationTier: match.locationTier || null,
    locationLabel: match.locationLabel || "",
    eligibility: match.eligibility || "unknown",
    eligibilityDetails: match.eligibilityDetails || {},
  };
}

function profileApplicantCountry(profile: Record<string, unknown> | null | undefined): string {
  const career = profile?.careerProfile as Record<string, unknown> | undefined;
  const homeLoc = career?.homeLocation as Record<string, unknown> | undefined;
  const prefs = profile?.preferences as Record<string, unknown> | undefined;
  const prefCodes = prefs?.preferredCountryCodes as string[] | undefined;

  return String(
    homeLoc?.countryCode ||
      (homeLoc?.scope === "anywhere_in_india" ? "IN" : "") ||
      prefCodes?.[0] ||
      "",
  ).toUpperCase();
}

export const jobController = {
  async coverage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as { _id?: string; id?: string };
      const userId = user._id || user.id;
      const profile = await profileRepository.findByUserId(userId as string);
      const report = await (
        jobIngestionService.coverageReport as (profile: unknown) => Promise<unknown>
      )(profile);
      res.status(200).json({ data: report });
    } catch (error) {
      next(error);
    }
  },

  async trackCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { careersUrl } = z
        .object({ careersUrl: z.string().url().max(500) })
        .strict()
        .parse(req.body);
      const user = req.user as { _id?: string; id?: string };
      const userId = user._id || user.id;
      const company = await requestCompanyTracking(careersUrl, userId as string);
      res.status(202).json({
        data: { company, message: "Company board verified and queued for admin review." },
      });
    } catch (error) {
      next(error);
    }
  },

  async getMatches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as { _id?: { toString(): string }; id?: string; profileVersion?: number };
      const userId = user._id ? user._id.toString() : (user.id as string);
      const ver = user.profileVersion || 1;
      const catalogVersion = await getCatalogVersion();
      const cacheKey = CacheKeys.response(
        userId,
        `matches:${MATCH_SCORE_VERSION}:catalog-${catalogVersion}`,
        ver,
      );

      // Check L1 response cache
      const cached = await get(cacheKey);
      if (cached) {
        if (!Array.isArray(cached)) {
          res.status(200).json({ data: { ...(cached as Record<string, unknown>), fromCache: true } });
          return;
        }
      }

      let matches = await discoveryGraph.getUserMatches(userId);
      matches = (matches as MatchRecord[]).map(serializeMatch);

      const [profile, sources] = await Promise.all([
        profileRepository.findByUserId(userId),
        jobIngestionService.publicSources(),
      ]);

      const profObj = profile as Record<string, unknown> | null;
      const prefs = profObj?.preferences as Record<string, unknown> | undefined;
      const roles = profObj?.roles as unknown[] | undefined;
      const skills = profObj?.skills as unknown[] | undefined;
      const education = profObj?.education as unknown[] | undefined;
      const targetRoles = prefs?.targetRoles as unknown[] | undefined;
      const prefLocs = prefs?.preferredLocations as unknown[] | undefined;

      const hasProfileFacts = Boolean(
        roles?.length ||
        skills?.length ||
        education?.length ||
        targetRoles?.length ||
        prefLocs?.length,
      );

      const refresh = (await getMatchRefresh(userId, ver)) as Record<string, unknown> | null;
      let inlineEmptyReason = "";

      if (!matches.length && hasProfileFacts && !["queued", "running"].includes(refresh?.status as string)) {
        const result = await (
          discoveryGraph.runDiscovery as (user: unknown, opts: Record<string, unknown>) => Promise<unknown>
        )(req.user, {
          quotaAccepted: true,
          requestId: req.id,
        });
        matches = ((await discoveryGraph.getUserMatches(userId)) as MatchRecord[]).map(serializeMatch);
        inlineEmptyReason = (result as { emptyReason?: string })?.emptyReason || "";
        if ((result as { matches?: unknown[] })?.matches?.length) await del(cacheKey);
      }

      const emptyReason = matches.length
        ? ""
        : !hasProfileFacts
          ? "profile_missing"
          : (refresh?.emptyReason as string) ||
            inlineEmptyReason ||
            (sources.every((source: { indexedCount: number }) => source.indexedCount === 0)
              ? "catalog_empty"
              : "no_candidates");

      const payload = {
        totalMatches: matches.length,
        matches,
        refresh,
        broadenActions: (refresh?.broadenActions as unknown[]) || [],
        sources,
        profileReady: hasProfileFacts,
        otherRolesOnly:
          matches.length > 0 &&
          matches.every((match: Record<string, unknown>) => typeof match.score === "number" && match.score < 50),
        roleSuggestions: suggestTargetRoleCorrections(profile || {}),
        emptyReason,
      };

      await set(cacheKey, payload, matches.length ? TTL.RESPONSE : 3);
      res.status(200).json({ data: payload });
    } catch (err) {
      next(err);
    }
  },

  async searchCatalog(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, Number.parseInt(String(req.query.page), 10) || 1);
      const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit), 10) || 20));
      const cursor = String(req.query.cursor || "").slice(0, 512);
      const filters = {
        q: String(req.query.q || "").trim(),
        location: String(req.query.location || "").trim(),
        countryCode: String(req.query.countryCode || "").trim(),
        source: String(req.query.source || "").trim(),
        remoteType: String(req.query.remoteType || "").trim(),
        occupation: String(req.query.occupation || "").trim(),
        eligibility: String(req.query.eligibility || "").trim(),
        postedWithinDays: Math.min(
          365,
          Math.max(0, Number.parseInt(String(req.query.postedWithinDays), 10) || 0),
        ),
        minimumSalaryInr:
          req.query.minimumSalaryInr === undefined ? null : Number(req.query.minimumSalaryInr),
        showAnyway: req.query.showAnyway === "true",
        sort: String(req.query.sort || "").trim(),
      };

      const user = req.user as { _id?: string; id?: string; role?: string; jobAnalyticsConsent?: { version?: string } };
      const userId = user._id || user.id;
      const hiddenJobIds = await HiddenJob.distinct("jobId", { userId });
      const profile = await profileRepository.findByUserId(userId as string);
      const result = (await (
        jobIngestionService.searchJobs as (opts: unknown) => Promise<Record<string, unknown>>
      )({
        ...filters,
        eligibilityCountryCodes: profileApplicantCountries(profile || {}),
        page,
        cursor,
        limit,
        excludeJobIds: hiddenJobIds,
      })) as Record<string, unknown>;

      if (["admin", "super_admin"].includes(user.role || "")) {
        const sourceBudgets = (await jobIngestionService.sourceBudgets()) as Array<{ worker?: Record<string, unknown> }>;
        result.worker = sourceBudgets[0]?.worker || {
          online: false,
          status: "offline",
          lastSeenAt: null,
        };
      }

      const rates = (await latestEcbReferenceRates().catch(() => null)) as {
        ratesPerEur?: Record<string, number>;
        date?: string;
        source?: string;
      } | null;

      if (Array.isArray(result.jobs)) {
        result.jobs = (result.jobs as Array<Record<string, unknown>>).map((job: Record<string, unknown>) => {
          const match = profile ? scoreJobMatch(profile, job) : null;
          const salary = job.compensation as { min?: number; max?: number; currency?: string; payPeriod?: string } | undefined;
          const salaryRange = job.salaryRange as { min?: number; max?: number; currency?: string } | undefined;
          const amountMin = salary?.min ?? salaryRange?.min;
          const amountMax = salary?.max ?? salaryRange?.max;
          const currency = salary?.currency || salaryRange?.currency;

          const profObj = profile as Record<string, unknown> | null;
          const career = profObj?.careerProfile as Record<string, unknown> | undefined;
          const comp = career?.compensation as { currencyCode?: string } | undefined;
          const targetCurrency =
            comp?.currencyCode ||
            (profileApplicantCountry(profile) === "IN" ? "INR" : currency);

          const {
            rawDescription: _rawDescription,
            requirements: _requirements,
            provenance: _provenance,
            ...publicJob
          } = job;

          return {
            ...publicJob,
            ...(match || {}),
            eligibility: match?.eligibility || classifyEligibility(job, profile || {}).status,
            eligibilityDetails:
              match?.eligibilityDetails || classifyEligibility(job, profile || {}),
            riskFlags: getJobRiskFlags(job),
            salaryDisplay:
              currency && targetCurrency
                ? {
                    currency: String(currency).toUpperCase(),
                    targetCurrency: String(targetCurrency).toUpperCase(),
                    converted:
                      String(currency).toUpperCase() !== String(targetCurrency).toUpperCase(),
                    min: amountMin || null,
                    max: amountMax || null,
                    convertedMin:
                      currency === targetCurrency
                        ? amountMin
                        : rates?.ratesPerEur
                          ? convertAmount(amountMin, currency, targetCurrency, rates.ratesPerEur)
                          : null,
                    convertedMax:
                      currency === targetCurrency
                        ? amountMax
                        : rates?.ratesPerEur
                          ? convertAmount(amountMax, currency, targetCurrency, rates.ratesPerEur)
                          : null,
                    rateDate: rates?.date || null,
                    rateSource: rates?.source || null,
                    rateStale: isFxRateStale(rates),
                    period: salary?.payPeriod || "unknown",
                  }
                : null,
          };
        });

        if (req.query.sort === "best-match") {
          (result.jobs as Array<{ score?: number }>).sort(
            (a, b) => (b.score || 0) - (a.score || 0),
          );
        }

        const analyticsConsented = user.jobAnalyticsConsent?.version === "job-analytics-v1";
        await recordImpressions(userId, result.jobs as Record<string, unknown>[], analyticsConsented);
        if ((result.jobs as unknown[]).length === 0) {
          await (
            recordInteraction as (opts: unknown) => Promise<unknown>
          )({
            userId,
            consented: analyticsConsented,
            event: "zero_result",
            source: filters.source || "mixed",
            occupation: filters.occupation || "unknown",
            country: filters.countryCode || "unknown",
          });
        }
      }

      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async getJobDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.sendStatus(404);
        return;
      }
      let job = (await Job.findOne({
        _id: req.params.id,
        status: "active",
        expiresAt: { $gt: new Date() },
      })
        .select("-embedding -rawPayload")
        .lean()) as Record<string, unknown> | null;

      if (!job) {
        res.sendStatus(404);
        return;
      }

      const canonicalJob = (job.canonicalJobId
        ? await Job.findOne({
            _id: job.canonicalJobId as string,
            status: "active",
            expiresAt: { $gt: new Date() },
          })
            .select("sourceBoard sourceUrl canonicalUrl variants")
            .lean()
        : job) as Record<string, unknown> | null;

      const variantLinks = [
        ...(canonicalJob?._id && String(canonicalJob._id) !== String(job._id)
          ? [
              {
                source: canonicalJob.sourceBoard as string | undefined,
                url: (canonicalJob.sourceUrl || canonicalJob.canonicalUrl || "") as string,
              },
            ]
          : []),
        ...((canonicalJob?.variants as Array<{ source?: string; url?: string }>) || []),
      ];

      const alsoListedOn = variantLinks
        .filter(
          (variant) =>
            variant.source !== job?.sourceBoard ||
            variant.url !== (job?.sourceUrl || job?.canonicalUrl || ""),
        )
        .slice(0, 10);

      const detail = (await JobDetail.findOne({ jobId: job._id, expiresAt: { $gt: new Date() } })
        .select("description requirements provenance")
        .lean()) as Record<string, unknown> | null;

      if (detail) {
        job = {
          ...job,
          rawDescription: detail.description,
          requirements: detail.requirements,
          provenance: detail.provenance,
        };
      }

      const user = req.user as { _id?: string; id?: string; jobAnalyticsConsent?: { version?: string } };
      const userId = user._id || user.id;

      const jobLoc = job?.structuredLocation as { countryCode?: string } | undefined;
      await (
        recordInteraction as (opts: unknown) => Promise<unknown>
      )({
        userId,
        consented: user.jobAnalyticsConsent?.version === "job-analytics-v1",
        event: "click",
        source: job?.sourceBoard,
        occupation: job?.occupation,
        country: jobLoc?.countryCode,
      });

      const profile = await profileRepository.findByUserId(userId as string);
      const match = profile && job ? scoreJobMatch(profile, job) : null;
      const eligibilityDetails = classifyEligibility(job || {}, profile || {});
      const salary = job?.compensation as { min?: number; max?: number; currency?: string; payPeriod?: string } | undefined;
      const salaryRange = job?.salaryRange as { min?: number; max?: number; currency?: string } | undefined;
      const amountMin = salary?.min ?? salaryRange?.min;
      const amountMax = salary?.max ?? salaryRange?.max;
      const currency = salary?.currency || salaryRange?.currency;

      const profObj = profile as Record<string, unknown> | null;
      const career = profObj?.careerProfile as Record<string, unknown> | undefined;
      const comp = career?.compensation as { currencyCode?: string } | undefined;
      const targetCurrency =
        comp?.currencyCode ||
        (profileApplicantCountry(profile) === "IN" ? "INR" : currency);

      const rates = (await latestEcbReferenceRates().catch(() => null)) as {
        ratesPerEur?: Record<string, number>;
        date?: string;
        source?: string;
      } | null;
      const salaryDisplay =
        currency && targetCurrency
          ? {
              currency: String(currency).toUpperCase(),
              targetCurrency: String(targetCurrency).toUpperCase(),
              converted: String(currency).toUpperCase() !== String(targetCurrency).toUpperCase(),
              min: amountMin || null,
              max: amountMax || null,
              convertedMin:
                currency === targetCurrency
                  ? amountMin
                  : rates?.ratesPerEur
                    ? convertAmount(amountMin, currency, targetCurrency, rates.ratesPerEur)
                    : null,
              convertedMax:
                currency === targetCurrency
                  ? amountMax
                  : rates?.ratesPerEur
                    ? convertAmount(amountMax, currency, targetCurrency, rates.ratesPerEur)
                    : null,
              rateDate: rates?.date || null,
              rateSource: rates?.source || null,
              rateStale: isFxRateStale(rates),
              period: salary?.payPeriod || "unknown",
            }
          : null;

      const similar = await Job.find({
        _id: { $ne: job._id },
        status: "active",
        expiresAt: { $gt: new Date() },
        $or: [{ features: { $exists: true, $ne: {} } }, { sourceBoard: job.sourceBoard }],
      })
        .select(
          "title company location sourceBoard sourceUrl postedAt postedDateKnown salaryRange requirements tags features",
        )
        .limit(100)
        .lean();

      const jobFeatures = job?.features as { skills?: string[]; occupation?: string } | undefined;
      const sourceCounts = new Map((jobFeatures?.skills || []).map((skill: string) => [skill, 1]));

      const similarJobs = similar
        .map((item) => {
          const itemRec = item as Record<string, unknown>;
          const features = (itemRec.features as { skills?: string[]; occupation?: string }) || extractJobFeatures(item);
          const shared = (features.skills || []).filter((skill: string) => sourceCounts.has(skill)).length;
          const titleSame =
            jobFeatures?.occupation && features.occupation === jobFeatures.occupation ? 3 : 0;
          return { ...itemRec, _similarity: shared + titleSame };
        })
        .sort((a, b) => b._similarity - a._similarity)
        .slice(0, 3)
        .map(({ _similarity: _sim, ...item }) => item);

      res.json({
        data: {
          job: {
            ...job,
            alsoListedOn,
            eligibility: match?.eligibility || eligibilityDetails.status,
            eligibilityDetails: match?.eligibilityDetails || eligibilityDetails,
            riskFlags: getJobRiskFlags(job || {}),
            salaryDisplay,
          },
          match,
          similarJobs,
          companyInfoProvided: Boolean(
            job?.companyDescription || job?.companyWebsite || job?.industry,
          ),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async recordApplyClick(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.sendStatus(404);
        return;
      }
      const result = await Job.updateOne(
        { _id: req.params.id, status: "active", expiresAt: { $gt: new Date() } },
        { $inc: { applyClickCount: 1 } },
      );
      if (!result.matchedCount) {
        res.sendStatus(404);
        return;
      }

      const job = (await Job.findById(req.params.id)
        .select("sourceBoard occupation structuredLocation.countryCode")
        .lean()) as Record<string, unknown> | null;

      const user = req.user as { _id?: string; id?: string; jobAnalyticsConsent?: { version?: string } };
      const jobLoc = job?.structuredLocation as { countryCode?: string } | undefined;
      await (
        recordInteraction as (opts: unknown) => Promise<unknown>
      )({
        userId: user._id || user.id,
        consented: user.jobAnalyticsConsent?.version === "job-analytics-v1",
        event: "apply_click",
        source: job?.sourceBoard,
        occupation: job?.occupation,
        country: jobLoc?.countryCode,
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async hideJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.sendStatus(404);
        return;
      }
      const job = (await Job.findOne({
        _id: req.params.id,
        status: "active",
        expiresAt: { $gt: new Date() },
      })
        .select("_id")
        .lean()) as { _id: unknown } | null;
      if (!job) {
        res.sendStatus(404);
        return;
      }

      const user = req.user as { _id?: string; id?: string; jobAnalyticsConsent?: { version?: string } };
      const userId = user._id || user.id;

      await HiddenJob.updateOne(
        { userId, jobId: job._id },
        { $setOnInsert: { userId, jobId: job._id } },
        { upsert: true },
      );

      const details = (await Job.findById(job._id)
        .select("sourceBoard occupation structuredLocation.countryCode")
        .lean()) as Record<string, unknown> | null;

      const detailLoc = details?.structuredLocation as { countryCode?: string } | undefined;
      await (
        recordInteraction as (opts: unknown) => Promise<unknown>
      )({
        userId,
        consented: user.jobAnalyticsConsent?.version === "job-analytics-v1",
        event: "hide",
        source: details?.sourceBoard,
        occupation: details?.occupation,
        country: detailLoc?.countryCode,
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async reportJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.sendStatus(404);
        return;
      }
      const parsed = z
        .object({ reason: z.enum(["expired", "broken_link", "misleading", "spam", "other"]) })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "INVALID_REPORT_REASON",
            message: "Choose a report reason.",
            requestId: req.id,
          },
        });
        return;
      }

      const job = (await Job.findOne({ _id: req.params.id }).select("_id").lean()) as { _id: unknown } | null;
      if (!job) {
        res.sendStatus(404);
        return;
      }

      await Job.updateOne(
        { _id: job._id },
        { $inc: { [`reportCounts.${parsed.data.reason}`]: 1 } },
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async getMatchRefresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as { _id?: { toString(): string }; id?: string; profileVersion?: number };
      const userId = user._id ? user._id.toString() : (user.id as string);
      const refresh = await getMatchRefresh(userId, user.profileVersion || 1);
      res.status(200).json({ data: { refresh } });
    } catch (err) {
      next(err);
    }
  },

  async getMatchDebug(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (process.env.NODE_ENV === "production") {
        res.sendStatus(404);
        return;
      }
      const user = req.user as { _id?: { toString(): string }; id?: string; profileVersion?: number };
      const userId = user._id ? user._id.toString() : (user.id as string);
      const profile = await profileRepository.findByUserId(userId);
      const jobs = await (
        jobIngestionService.getCandidateJobs as (opts: Record<string, unknown>) => Promise<unknown[]>
      )({ profile, limit: 400 });
      const retrieval = (jobs as unknown as { retrievalStats?: Record<string, unknown> }).retrievalStats || {
        activeCatalogCount: (jobs as unknown[]).length,
        eligibleCount: (jobs as unknown[]).length,
        candidateCap: 400,
        lexicalCandidateCount: 0,
      };

      const profObj = profile as Record<string, unknown> | null;
      const prefs = profObj?.preferences as Record<string, unknown> | undefined;
      const locations = (prefs?.preferredLocations as string[]) || [];
      const codes = (prefs?.preferredCountryCodes as string[]) || [];

      const { locationTierForJob } = await import("../ai/graphs/discoveryGraph.js");
      const jobList = jobs as Array<Record<string, unknown>>;
      const bestTier = jobList.length
        ? Math.min(...jobList.map((job) => locationTierForJob(job, locations, codes)))
        : null;
      const tiered =
        bestTier === null
          ? []
          : jobList.filter((job) => locationTierForJob(job, locations, codes) === bestTier);

      const scored = tiered.map((job) => ({
        job,
        ...scoreJobMatch(profile || {}, { ...job, locationTier: bestTier }),
      }));

      const [stored, refresh, catalogJobs] = await Promise.all([
        discoveryGraph.getUserMatches(userId),
        getMatchRefresh(userId, user.profileVersion || 1),
        Job.find({ status: "active", expiresAt: { $gt: new Date() } })
          .select("title features")
          .lean(),
      ]);

      const candidatesWithEmbeddings = jobList.length
        ? await JobVector.countDocuments({
            jobId: { $in: jobList.map((job) => job._id).filter(Boolean) },
          })
        : 0;

      const embedding = (
        await import("../services/embeddingService.js")
      ).embeddingService.getConfig();

      const availableScores = scored.filter((item) => !item.hardBlocked);
      const scoreDistribution = Array.from({ length: 10 }, (_, index) => ({
        range: `${index * 10}-${index * 10 + 9}`,
        count: 0,
      }));

      for (const item of availableScores) {
        scoreDistribution[Math.min(9, Math.floor(item.score / 10))].count += 1;
      }

      const occupationCounts = new Map<string, number>();
      for (const job of catalogJobs) {
        const family = extractJobFeatures(job).occupation || "other/uncategorized";
        occupationCounts.set(family, (occupationCounts.get(family) || 0) + 1);
      }

      const roles = profObj?.roles as unknown[] | undefined;
      const skills = profObj?.skills as unknown[] | undefined;
      const edu = profObj?.education as unknown[] | undefined;
      const targetRoles = prefs?.targetRoles as unknown[] | undefined;

      const profileFactCounts = {
        skills: skills?.length || 0,
        roles: roles?.length || 0,
        education: edu?.length || 0,
        targetRoles: targetRoles?.length || 0,
        preferredLocations: locations.length,
        preferredCountryCodes: codes.length,
      };

      res.json({
        data: {
          funnel: {
            catalogSize: retrieval.activeCatalogCount,
            afterStatusDates: retrieval.activeCatalogCount,
            afterWorkMode: retrieval.eligibleCount,
            candidateCap: retrieval.candidateCap,
            lexicalCandidates: retrieval.lexicalCandidateCount,
            afterLocationTiering: tiered.length,
            candidatesWithEmbeddings,
            profileEmbeddingAvailable: false,
            embeddingProvider: embedding.provider,
            embeddingModel: embedding.model,
            embeddingDimension: embedding.dimension,
            afterScoreThreshold: availableScores.filter((item) => item.score >= 50).length,
            fallbackUnderThreshold: availableScores.filter((item) => item.score < 50).length,
            written: (stored as unknown[]).length,
            returned: (stored as unknown[]).length,
            refreshStatus: (refresh as Record<string, unknown> | null)?.status || "not-queued",
            refreshErrorCode: (refresh as Record<string, unknown> | null)?.errorCode || "",
            scoreVersion: MATCH_SCORE_VERSION,
          },
          profileFactCounts,
          profileFieldNamesUsed: [
            "skills[].name",
            "roles[].title",
            "roles[].years/startDate/endDate/isCurrent",
            "preferences.targetRoles[]",
            "preferences.preferredLocations[]",
            "preferences.preferredCountryCodes[]",
            "preferences.remotePreference",
            "preferences.minimumSalaryUsd",
          ],
          scoreDistribution,
          top10: availableScores
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map((item) => ({
              title: item.job?.title,
              source: item.job?.sourceBoard,
              score: item.score,
              breakdown: item.breakdown,
              reasons: item.reasons,
            })),
          occupationFamilies: [...occupationCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([family, count]) => ({ family, count })),
          roleSuggestions: suggestTargetRoleCorrections(profile || {}),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async runDiscovery(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = z
        .object({ broaden: z.boolean().optional().default(false) })
        .strict()
        .parse(req.body || {});
      const user = req.user as { _id?: { toString(): string }; id?: string; profileVersion?: number };
      const userId = user._id ? user._id.toString() : (user.id as string);

      const refresh = await requestMatchRefresh(userId, user.profileVersion || 1, {
        broaden: input.broaden,
      });

      await del(
        CacheKeys.response(userId, `matches:${MATCH_SCORE_VERSION}`, user.profileVersion || 1),
      );
      res.status(202).json({ data: { message: "Match refresh queued", refresh } });
    } catch (err: unknown) {
      const errObj = err as { code?: string };
      if (process.env.NODE_ENV !== "production" && errObj?.code === "MATCH_QUEUE_UNAVAILABLE") {
        try {
          const user = req.user as { _id?: { toString(): string }; id?: string; profileVersion?: number };
          const userId = user._id ? user._id.toString() : (user.id as string);
          const result = await (
            discoveryGraph.runDiscovery as (user: unknown, opts: Record<string, unknown>) => Promise<unknown>
          )(req.user, {
            quotaAccepted: true,
            requestId: req.id,
          });
          const { MatchRefresh } = await import("../models/MatchRefresh.js");
          const refresh = await MatchRefresh.findOneAndUpdate(
            { userId, profileVersion: user.profileVersion || 1 },
            {
              $set: {
                status: "done",
                resultCount: (result as { matches: unknown[] }).matches.length,
                emptyReason: (result as { emptyReason?: string }).emptyReason || "",
                completedAt: new Date(),
                nextAllowedAt: new Date(Date.now() + 30_000),
                attemptId: `local-${Date.now()}`,
              },
              $setOnInsert: { userId, profileVersion: user.profileVersion || 1 },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean();

          await del(
            CacheKeys.response(
              userId,
              `matches:${MATCH_SCORE_VERSION}`,
              user.profileVersion || 1,
            ),
          );
          res.status(200).json({ data: { message: "Recommendations refreshed locally", refresh } });
          return;
        } catch (inlineError) {
          next(inlineError);
          return;
        }
      }
      next(err);
    }
  },

  async recordFeedback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { feedback, reason } = feedbackSchema.parse(req.body);
      const user = req.user as {
        _id?: { toString(): string };
        id?: string;
        plan?: string;
        jobAnalyticsConsent?: { version?: string };
      };
      const userId = user._id ? user._id.toString() : (user.id as string);

      const updated = await discoveryGraph.recordFeedback(userId, id, feedback, reason);
      if (!updated) {
        res.status(404).json({
          error: {
            code: "MATCH_NOT_FOUND",
            message: "Recommended job was not found",
            requestId: req.id || "req_unknown",
          },
        });
        return;
      }

      if (feedback === "thumbs_down" && reason) {
        await (
          longTermMemory.writeMemory as (opts: unknown) => Promise<unknown>
        )({
          userId,
          userPlan: user.plan || "free",
          type: "feedback",
          key: `dislikes_job_${id}`,
          content: `Candidate disliked job: ${reason}`,
          importance: 3,
          confidence: 0.85,
        });
      }

      const matchObj = updated as { jobId?: unknown; scoreBand?: string };
      const matchedJob = (
        matchObj.jobId && mongoose.isValidObjectId(matchObj.jobId)
          ? await Job.findById(matchObj.jobId)
              .select("sourceBoard occupation structuredLocation.countryCode")
              .lean()
          : null
      ) as Record<string, unknown> | null;

      const loc = matchedJob?.structuredLocation as { countryCode?: string } | undefined;
      await (
        recordInteraction as (opts: Record<string, unknown>) => Promise<unknown>
      )({
        userId,
        consented: user.jobAnalyticsConsent?.version === "job-analytics-v1",
        event: "match_feedback",
        source: matchedJob?.sourceBoard,
        occupation: matchedJob?.occupation,
        country: loc?.countryCode,
        scoreBand: matchObj.scoreBand,
      });

      res.status(200).json({
        data: {
          message: "Feedback recorded successfully",
          match: updated,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async listSavedSearches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as { _id?: string; id?: string; plan?: string };
      const userId = user?._id || user?.id;
      const result = await (
        savedSearchService.listByUser as (userId: unknown, opts: Record<string, unknown>) => Promise<unknown>
      )(userId, { plan: user?.plan });
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async createSavedSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = createSavedSearchSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "INVALID_SAVED_SEARCH",
            message: parsed.error.issues[0]?.message || "Invalid saved search parameters.",
            requestId: req.id,
          },
        });
        return;
      }
      const created = await savedSearchService.create(req.user, parsed.data);
      res.status(201).json({ data: { savedSearch: created } });
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string };
      if (errObj?.code === "SAVED_SEARCH_LIMIT_REACHED") {
        res.status(403).json({
          error: {
            code: errObj.code,
            message: errObj.message,
            requestId: req.id,
          },
        });
        return;
      }
      next(err);
    }
  },

  async updateSavedSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = updateSavedSearchSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "INVALID_SAVED_SEARCH",
            message: parsed.error.issues[0]?.message || "Invalid saved search update parameters.",
            requestId: req.id,
          },
        });
        return;
      }
      const user = req.user as { _id?: string; id?: string };
      const userId = user?._id || user?.id;
      const updated = await savedSearchService.update(userId, req.params.id, parsed.data);
      if (!updated) {
        res.status(404).json({
          error: {
            code: "SAVED_SEARCH_NOT_FOUND",
            message: "Saved search not found.",
            requestId: req.id,
          },
        });
        return;
      }
      res.status(200).json({ data: { savedSearch: updated } });
    } catch (err) {
      next(err);
    }
  },

  async deleteSavedSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as { _id?: string; id?: string };
      const userId = user?._id || user?.id;
      const removed = await savedSearchService.remove(userId, req.params.id);
      if (!removed) {
        res.status(404).json({
          error: {
            code: "SAVED_SEARCH_NOT_FOUND",
            message: "Saved search not found.",
            requestId: req.id,
          },
        });
        return;
      }
      res.status(200).json({ data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  },

  async previewSavedSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = savedSearchFiltersSchema.safeParse(req.body?.filters ?? req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "INVALID_SAVED_SEARCH",
            message: parsed.error.issues[0]?.message || "Invalid saved search filters.",
            requestId: req.id,
          },
        });
        return;
      }
      const user = req.user as { _id?: string; id?: string } | undefined;
      const userId = user?._id || user?.id;
      const profile = userId ? await profileRepository.findByUserId(userId) : null;
      const eligibilityCountryCodes = profileApplicantCountries(profile || {});
      const preview = await (
        savedSearchService.preview as (filters: unknown, opts: Record<string, unknown>) => Promise<unknown>
      )(parsed.data, {
        limit: Number(req.body?.limit) || 5,
        eligibilityCountryCodes,
      });
      res.status(200).json({ data: preview });
    } catch (err) {
      next(err);
    }
  },

  async unsubscribeSavedSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = String(req.body?.token || req.query?.token || "").trim();
      const user = req.user as { _id?: string; id?: string } | undefined;
      const userId = user?._id || user?.id || "";
      const updated = await savedSearchService.unsubscribe(req.params.id, { token, userId });
      if (!updated) {
        res.status(404).json({
          error: {
            code: "SAVED_SEARCH_NOT_FOUND",
            message: "Saved search or unsubscribe token is invalid.",
            requestId: req.id,
          },
        });
        return;
      }
      res.status(200).json({
        data: {
          unsubscribed: true,
          savedSearch: updated,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
