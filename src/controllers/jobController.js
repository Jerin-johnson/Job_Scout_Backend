import { discoveryGraph } from "../ai/graphs/discoveryGraph.js";
import { get, set, CacheKeys, TTL } from "../shared/cache.js";
import { del } from "../shared/cache.js";
import { longTermMemory } from "../ai/memory/longTerm.js";
import { jobIngestionService } from "../services/jobs/jobIngestionService.js";
import { latestEcbReferenceRates, convertAmount, isFxRateStale } from "../services/jobs/fxRates.js";
import { getJobRiskFlags } from "../services/jobs/jobRisk.js";
import { classifyEligibility, profileApplicantCountries } from "../services/jobs/eligibility.js";
import { requestCompanyTracking } from "../services/jobs/trackedCompanyService.js";
import { z } from "zod";
import { getMatchRefresh, requestMatchRefresh } from "../services/matchRefreshService.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { MATCH_SCORE_VERSION, scoreJobMatch, extractJobFeatures } from "../services/jobs/matching.js";
import { Job } from "../models/Job.js";
import { JobDetail } from "../models/JobDetail.js";
import { JobVector } from "../models/JobVector.js";
import mongoose from "mongoose";
import { HiddenJob } from "../models/HiddenJob.js";
import { suggestTargetRoleCorrections } from "../services/jobs/roleNormalization.js";
import { recordInteraction, recordImpressions } from "../services/jobs/interactionEvents.js";
import { getCatalogVersion } from "../services/jobs/catalogVersion.js";

const feedbackSchema = z.object({
  feedback: z.enum(["thumbs_up", "thumbs_down"]),
  reason: z.string().optional().default(""),
});

function serializeMatch(match) {
  const job = match.jobId && typeof match.jobId === "object" ? match.jobId : match.jobDetails || {};
  const postedDateKnown =
    job.postedDateKnown ??
    (job.postedAt && job.createdAt
      ? Math.abs(new Date(job.postedAt) - new Date(job.createdAt)) > 5 * 60_000
      : false);
  return {
    jobId: String(job._id || match.jobId),
    title: match.title || job.title || "Job title unavailable",
    company: match.company || job.company || "Company unavailable",
    location: match.location || job.location || "",
    sourceUrl: match.sourceUrl || job.sourceUrl || "",
    sourceBoard: match.sourceBoard || job.sourceBoard || "",
    salaryRange: match.salaryRange || job.salaryRange,
    score: match.score,
    scoreBand: match.scoreBand || (match.score >= 80 ? "strong" : match.score >= 65 ? "good" : match.score >= 50 ? "fair" : "low"),
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

export const jobController = {
  async coverage(req, res, next) {
    try {
      const profile = await profileRepository.findByUserId(req.user._id || req.user.id);
      const report = await jobIngestionService.coverageReport(profile);
      return res.status(200).json({ data: report });
    } catch (error) { return next(error); }
  },
  async trackCompany(req, res, next) {
    try {
      const { careersUrl } = z.object({ careersUrl: z.string().url().max(500) }).strict().parse(req.body);
      const company = await requestCompanyTracking(careersUrl, req.user._id || req.user.id);
      return res.status(202).json({ data: { company, message: "Company board verified and queued for admin review." } });
    } catch (error) { return next(error); }
  },
  async getMatches(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const ver = req.user.profileVersion || 1;
      const catalogVersion = await getCatalogVersion();
      const cacheKey = CacheKeys.response(userId, `matches:${MATCH_SCORE_VERSION}:catalog-${catalogVersion}`, ver);

      // Check L1 response cache
      const cached = await get(cacheKey);
      if (cached) {
        if (!Array.isArray(cached))
          return res.status(200).json({ data: { ...cached, fromCache: true } });
      }

      let matches = await discoveryGraph.getUserMatches(userId);

      matches = matches.map(serializeMatch);
      const [profile, sources] = await Promise.all([
        profileRepository.findByUserId(userId),
        jobIngestionService.publicSources(),
      ]);
      const hasProfileFacts = Boolean(
        profile?.roles?.length ||
        profile?.skills?.length ||
        profile?.education?.length ||
        profile?.preferences?.targetRoles?.length ||
        profile?.preferences?.preferredLocations?.length,
      );
      const refresh = await getMatchRefresh(userId, ver);
      let inlineEmptyReason = "";
      // A missing Redis/worker process must not make the user wait for a paid
      // provider or leave Recommended empty. Compute the deterministic result
      // synchronously once; normal worker refreshes remain asynchronous.
      if (!matches.length && hasProfileFacts && !["queued", "running"].includes(refresh?.status)) {
        const result = await discoveryGraph.runDiscovery(req.user, { quotaAccepted: true, requestId: req.id });
        matches = (await discoveryGraph.getUserMatches(userId)).map(serializeMatch);
        inlineEmptyReason = result.emptyReason || "";
        if (result.matches?.length) await del(cacheKey);
      }
      const emptyReason = matches.length
        ? ""
        : !hasProfileFacts
          ? "profile_missing"
          : refresh?.emptyReason || inlineEmptyReason ||
            (sources.every((source) => source.indexedCount === 0)
              ? "catalog_empty"
              : "no_candidates");

      // Cache matches response for 60s
      const payload = {
        totalMatches: matches.length,
        matches,
        refresh,
        broadenActions: refresh?.broadenActions || [],
        sources,
        profileReady: hasProfileFacts,
        otherRolesOnly: matches.length > 0 && matches.every((match) => match.score < 50),
        roleSuggestions: suggestTargetRoleCorrections(profile || {}),
        emptyReason,
      };
      await set(cacheKey, payload, matches.length ? TTL.RESPONSE : 3);
      res.status(200).json({ data: payload });
    } catch (err) {
      next(err);
    }
  },

  async searchCatalog(req, res, next) {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
      const cursor = String(req.query.cursor || "").slice(0, 512);
      const filters = {
        q: String(req.query.q || "").trim(),
        location: String(req.query.location || "").trim(),
        countryCode: String(req.query.countryCode || "").trim(),
        source: String(req.query.source || "").trim(),
        remoteType: String(req.query.remoteType || "").trim(),
        occupation: String(req.query.occupation || "").trim(),
        eligibility: String(req.query.eligibility || "").trim(),
        postedWithinDays: Math.min(365, Math.max(0, Number.parseInt(req.query.postedWithinDays, 10) || 0)),
        minimumSalaryInr: req.query.minimumSalaryInr === undefined ? null : Number(req.query.minimumSalaryInr),
        showAnyway: req.query.showAnyway === "true",
      };
      const userId = req.user._id || req.user.id;
      const hiddenJobIds = await HiddenJob.distinct("jobId", { userId });
      const profile = await profileRepository.findByUserId(userId);
      const result = await jobIngestionService.searchJobs({ ...filters, eligibilityCountryCodes: profileApplicantCountries(profile || {}), page, cursor, limit, excludeJobIds: hiddenJobIds });
      if (["admin", "super_admin"].includes(req.user.role)) {
        const sourceBudgets = await jobIngestionService.sourceBudgets();
        result.worker = sourceBudgets[0]?.worker || { online: false, status: "offline", lastSeenAt: null };
      }
      const rates = await latestEcbReferenceRates().catch(() => null);
      if (Array.isArray(result.jobs)) {
        result.jobs = result.jobs.map((job) => {
          const match = profile ? scoreJobMatch(profile, job) : null;
          const salary = job.compensation;
          const salaryRange = job.salaryRange;
          const amountMin = salary?.min ?? salaryRange?.min;
          const amountMax = salary?.max ?? salaryRange?.max;
          const currency = salary?.currency || salaryRange?.currency;
          const targetCurrency = profile?.careerProfile?.compensation?.currencyCode || (profileApplicantCountry(profile) === "IN" ? "INR" : currency);
          const { rawDescription: _rawDescription, requirements: _requirements, provenance: _provenance, ...publicJob } = job;
          const mapped = {
            ...publicJob,
            ...(match || {}),
            eligibility: match?.eligibility || classifyEligibility(job, profile || {}).status,
            eligibilityDetails: match?.eligibilityDetails || classifyEligibility(job, profile || {}),
            riskFlags: getJobRiskFlags(job),
            salaryDisplay: currency && targetCurrency ? {
              currency: String(currency).toUpperCase(), targetCurrency: String(targetCurrency).toUpperCase(),
              converted: String(currency).toUpperCase() !== String(targetCurrency).toUpperCase(),
              min: amountMin || null, max: amountMax || null,
              convertedMin: currency === targetCurrency ? amountMin : rates ? convertAmount(amountMin, currency, targetCurrency, rates.ratesPerEur) : null,
              convertedMax: currency === targetCurrency ? amountMax : rates ? convertAmount(amountMax, currency, targetCurrency, rates.ratesPerEur) : null,
              rateDate: rates?.date || null, rateSource: rates?.source || null,
              rateStale: isFxRateStale(rates),
              period: salary?.payPeriod || "unknown",
            } : null,
          };
          return mapped;
        });
        if (req.query.sort === "best-match") result.jobs.sort((a, b) => b.score - a.score);
        const analyticsConsented = req.user.jobAnalyticsConsent?.version === "job-analytics-v1";
        await recordImpressions(userId, result.jobs, analyticsConsented);
        if (result.jobs.length === 0) await recordInteraction({ userId, consented: analyticsConsented, event: "zero_result", source: filters.source || "mixed", occupation: filters.occupation || "unknown", country: filters.countryCode || "unknown" });
      }
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async getJobDetails(req, res, next) {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
      let job = await Job.findOne({ _id: req.params.id, status: "active", expiresAt: { $gt: new Date() } }).select("-embedding -rawPayload").lean();
      if (!job) return res.sendStatus(404);
      const canonicalJob = job.canonicalJobId
        ? await Job.findOne({ _id: job.canonicalJobId, status: "active", expiresAt: { $gt: new Date() } })
            .select("sourceBoard sourceUrl canonicalUrl variants")
            .lean()
        : job;
      const variantLinks = [
        ...(canonicalJob?._id && String(canonicalJob._id) !== String(job._id)
          ? [{ source: canonicalJob.sourceBoard, url: canonicalJob.sourceUrl || canonicalJob.canonicalUrl || "" }]
          : []),
        ...(canonicalJob?.variants || []),
      ];
      const alsoListedOn = variantLinks
        .filter((variant) => variant.source !== job.sourceBoard || variant.url !== (job.sourceUrl || job.canonicalUrl || ""))
        .slice(0, 10);
      const detail = await JobDetail.findOne({ jobId: job._id, expiresAt: { $gt: new Date() } }).select("description requirements provenance").lean();
      if (detail) job = { ...job, rawDescription: detail.description, requirements: detail.requirements, provenance: detail.provenance };
      const userId = req.user._id || req.user.id;
      await recordInteraction({ userId, consented: req.user.jobAnalyticsConsent?.version === "job-analytics-v1", event: "click", source: job.sourceBoard, occupation: job.occupation, country: job.structuredLocation?.countryCode });
      const profile = await profileRepository.findByUserId(userId);
      const match = profile ? scoreJobMatch(profile, job) : null;
      const eligibilityDetails = classifyEligibility(job, profile || {});
      const salary = job.compensation;
      const salaryRange = job.salaryRange;
      const amountMin = salary?.min ?? salaryRange?.min;
      const amountMax = salary?.max ?? salaryRange?.max;
      const currency = salary?.currency || salaryRange?.currency;
      const targetCurrency = profile?.careerProfile?.compensation?.currencyCode || (profileApplicantCountry(profile) === "IN" ? "INR" : currency);
      const rates = await latestEcbReferenceRates().catch(() => null);
      const salaryDisplay = currency && targetCurrency ? {
        currency: String(currency).toUpperCase(), targetCurrency: String(targetCurrency).toUpperCase(),
          converted: String(currency).toUpperCase() !== String(targetCurrency).toUpperCase(),
        min: amountMin || null, max: amountMax || null,
          convertedMin: currency === targetCurrency ? amountMin : rates ? convertAmount(amountMin, currency, targetCurrency, rates.ratesPerEur) : null,
          convertedMax: currency === targetCurrency ? amountMax : rates ? convertAmount(amountMax, currency, targetCurrency, rates.ratesPerEur) : null,
        rateDate: rates?.date || null, rateSource: rates?.source || null, rateStale: isFxRateStale(rates),
        period: salary?.payPeriod || "unknown",
      } : null;
      const similar = await Job.find({
        _id: { $ne: job._id }, status: "active", expiresAt: { $gt: new Date() },
        $or: [{ features: { $exists: true, $ne: {} } }, { sourceBoard: job.sourceBoard }],
      }).select("title company location sourceBoard sourceUrl postedAt postedDateKnown salaryRange requirements tags features").limit(100).lean();
      const sourceCounts = new Map((job.features?.skills || []).map((skill) => [skill, 1]));
      const similarJobs = similar.map((item) => {
        const features = item.features || extractJobFeatures(item);
        const shared = features.skills.filter((skill) => sourceCounts.has(skill)).length;
        const titleSame = job.features?.occupation && features.occupation === job.features.occupation ? 3 : 0;
        return { ...item, _similarity: shared + titleSame };
      }).sort((a, b) => b._similarity - a._similarity).slice(0, 3).map(({ _similarity, ...item }) => item);
      res.json({ data: { job: { ...job, alsoListedOn, eligibility: match?.eligibility || eligibilityDetails.status, eligibilityDetails: match?.eligibilityDetails || eligibilityDetails, riskFlags: getJobRiskFlags(job), salaryDisplay }, match, similarJobs, companyInfoProvided: Boolean(job.companyDescription || job.companyWebsite || job.industry) } });
    } catch (err) { next(err); }
  },

  async recordApplyClick(req, res, next) {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
      const result = await Job.updateOne({ _id: req.params.id, status: "active", expiresAt: { $gt: new Date() } }, { $inc: { applyClickCount: 1 } });
      if (!result.matchedCount) return res.sendStatus(404);
      const job = await Job.findById(req.params.id).select("sourceBoard occupation structuredLocation.countryCode").lean();
      await recordInteraction({ userId: req.user._id || req.user.id, consented: req.user.jobAnalyticsConsent?.version === "job-analytics-v1", event: "apply_click", source: job?.sourceBoard, occupation: job?.occupation, country: job?.structuredLocation?.countryCode });
      res.status(204).end();
    } catch (err) { next(err); }
  },

  async hideJob(req, res, next) {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
      const job = await Job.findOne({ _id: req.params.id, status: "active", expiresAt: { $gt: new Date() } }).select("_id").lean();
      if (!job) return res.sendStatus(404);
      const userId = req.user._id || req.user.id;
      await HiddenJob.updateOne({ userId, jobId: job._id }, { $setOnInsert: { userId, jobId: job._id } }, { upsert: true });
      const details = await Job.findById(job._id).select("sourceBoard occupation structuredLocation.countryCode").lean();
      await recordInteraction({ userId, consented: req.user.jobAnalyticsConsent?.version === "job-analytics-v1", event: "hide", source: details?.sourceBoard, occupation: details?.occupation, country: details?.structuredLocation?.countryCode });
      res.status(204).end();
    } catch (err) { next(err); }
  },

  async reportJob(req, res, next) {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
      const parsed = z.object({ reason: z.enum(["expired", "broken_link", "misleading", "spam", "other"]) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_REPORT_REASON", message: "Choose a report reason.", requestId: req.id } });
      const job = await Job.findOne({ _id: req.params.id }).select("_id").lean();
      if (!job) return res.sendStatus(404);
      await Job.updateOne({ _id: job._id }, { $inc: { [`reportCounts.${parsed.data.reason}`]: 1 } });
      res.status(204).end();
    } catch (err) { next(err); }
  },

  async getMatchRefresh(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const refresh = await getMatchRefresh(userId, req.user.profileVersion || 1);
      res.status(200).json({ data: { refresh } });
    } catch (err) {
      next(err);
    }
  },

  async getMatchDebug(req, res, next) {
    try {
      if (process.env.NODE_ENV === "production") return res.sendStatus(404);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const profile = await profileRepository.findByUserId(userId);
      const jobs = await jobIngestionService.getCandidateJobs({ profile, limit: 400 });
      const retrieval = jobs.retrievalStats || { activeCatalogCount: jobs.length, eligibleCount: jobs.length, candidateCap: 400, lexicalCandidateCount: 0 };
      const locations = profile?.preferences?.preferredLocations || [];
      const codes = profile?.preferences?.preferredCountryCodes || [];
      const { locationTierForJob } = await import("../ai/graphs/discoveryGraph.js");
      const bestTier = jobs.length ? Math.min(...jobs.map((job) => locationTierForJob(job, locations, codes))) : null;
      const tiered = bestTier === null ? [] : jobs.filter((job) => locationTierForJob(job, locations, codes) === bestTier);
      const scored = tiered.map((job) => ({ job, ...scoreJobMatch(profile || {}, { ...job, locationTier: bestTier }) }));
      const [stored, refresh, catalogJobs] = await Promise.all([
        discoveryGraph.getUserMatches(userId),
        getMatchRefresh(userId, req.user.profileVersion || 1),
        Job.find({ status: "active", expiresAt: { $gt: new Date() } }).select("title features").lean(),
      ]);
      const candidatesWithEmbeddings = jobs.length
        ? await JobVector.countDocuments({ jobId: { $in: jobs.map((job) => job._id).filter(Boolean) } })
        : 0;
      const embedding = (await import("../services/embeddingService.js")).embeddingService.getConfig();
      const availableScores = scored.filter((item) => !item.hardBlocked);
      const scoreDistribution = Array.from({ length: 10 }, (_, index) => ({
        range: `${index * 10}-${index * 10 + 9}`,
        count: 0,
      }));
      for (const item of availableScores) scoreDistribution[Math.min(9, Math.floor(item.score / 10))].count += 1;
      const occupationCounts = new Map();
      for (const job of catalogJobs) {
        const family = extractJobFeatures(job).occupation || "other/uncategorized";
        occupationCounts.set(family, (occupationCounts.get(family) || 0) + 1);
      }
      const profileFactCounts = {
        skills: profile?.skills?.length || 0,
        roles: profile?.roles?.length || 0,
        education: profile?.education?.length || 0,
        targetRoles: profile?.preferences?.targetRoles?.length || 0,
        preferredLocations: profile?.preferences?.preferredLocations?.length || 0,
        preferredCountryCodes: profile?.preferences?.preferredCountryCodes?.length || 0,
      };
      res.json({ data: {
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
        written: stored.length,
        returned: stored.length,
        refreshStatus: refresh?.status || "not-queued",
        refreshErrorCode: refresh?.errorCode || "",
        scoreVersion: MATCH_SCORE_VERSION,
        },
        profileFactCounts,
        profileFieldNamesUsed: ["skills[].name", "roles[].title", "roles[].years/startDate/endDate/isCurrent", "preferences.targetRoles[]", "preferences.preferredLocations[]", "preferences.preferredCountryCodes[]", "preferences.remotePreference", "preferences.minimumSalaryUsd"],
        scoreDistribution,
        top10: availableScores.sort((a, b) => b.score - a.score).slice(0, 10).map((item) => ({ title: item.job?.title, source: item.job?.sourceBoard, score: item.score, breakdown: item.breakdown, reasons: item.reasons })),
        occupationFamilies: [...occupationCounts.entries()].sort((a, b) => b[1] - a[1]).map(([family, count]) => ({ family, count })),
        roleSuggestions: suggestTargetRoleCorrections(profile || {}),
      } });
    } catch (err) { next(err); }
  },

  async runDiscovery(req, res, next) {
    try {
      const input = z
        .object({ broaden: z.boolean().optional().default(false) })
        .strict()
        .parse(req.body || {});
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const refresh = await requestMatchRefresh(userId, req.user.profileVersion || 1, {
        broaden: input.broaden,
      });
      await del(CacheKeys.response(userId, `matches:${MATCH_SCORE_VERSION}`, req.user.profileVersion || 1));
      res.status(202).json({ data: { message: "Match refresh queued", refresh } });
    } catch (err) {
      if (process.env.NODE_ENV !== "production" && err?.code === "MATCH_QUEUE_UNAVAILABLE") {
        try {
          const userId = req.user._id ? req.user._id.toString() : req.user.id;
          const result = await discoveryGraph.runDiscovery(req.user, { quotaAccepted: true, requestId: req.id });
          const { MatchRefresh } = await import("../models/MatchRefresh.js");
          const refresh = await MatchRefresh.findOneAndUpdate(
            { userId, profileVersion: req.user.profileVersion || 1 },
            { $set: { status: "done", resultCount: result.matches.length, emptyReason: result.emptyReason || "", completedAt: new Date(), nextAllowedAt: new Date(Date.now() + 30_000), attemptId: `local-${Date.now()}` }, $setOnInsert: { userId, profileVersion: req.user.profileVersion || 1 } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean();
          await del(CacheKeys.response(userId, `matches:${MATCH_SCORE_VERSION}`, req.user.profileVersion || 1));
          return res.status(200).json({ data: { message: "Recommendations refreshed locally", refresh } });
        } catch (inlineError) { return next(inlineError); }
      }
      next(err);
    }
  },

  async recordFeedback(req, res, next) {
    try {
      const { id } = req.params;
      const { feedback, reason } = feedbackSchema.parse(req.body);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;

      const updated = await discoveryGraph.recordFeedback(userId, id, feedback, reason);
      if (!updated)
        return res.status(404).json({
          error: {
            code: "MATCH_NOT_FOUND",
            message: "Recommended job was not found",
            requestId: req.id || "req_unknown",
          },
        });

      // If negative feedback, write a feedback memory so agent learns preferences
      if (feedback === "thumbs_down" && reason) {
        await longTermMemory.writeMemory({
          userId,
          userPlan: req.user.plan,
          type: "feedback",
          key: `dislikes_job_${id}`,
          content: `Candidate disliked job: ${reason}`,
          importance: 3,
          confidence: 0.85,
        });
      }

      const matchedJob = updated.jobId && mongoose.isValidObjectId(updated.jobId) ? await Job.findById(updated.jobId).select("sourceBoard occupation structuredLocation.countryCode").lean() : null;
      await recordInteraction({ userId, consented: req.user.jobAnalyticsConsent?.version === "job-analytics-v1", event: "match_feedback", source: matchedJob?.sourceBoard, occupation: matchedJob?.occupation, country: matchedJob?.structuredLocation?.countryCode, scoreBand: updated.scoreBand });

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
};

function profileApplicantCountry(profile) {
  return String(profile?.careerProfile?.homeLocation?.countryCode || (profile?.careerProfile?.homeLocation?.scope === "anywhere_in_india" ? "IN" : "") || profile?.preferences?.preferredCountryCodes?.[0] || "").toUpperCase();
}
