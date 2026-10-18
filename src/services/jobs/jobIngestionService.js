import { Job } from "../../models/Job.js";
import { JobDetail } from "../../models/JobDetail.js";
import { JobVector } from "../../models/JobVector.js";
import { JobSource } from "../../models/JobSource.js";
import { Profile } from "../../models/Profile.js";
import { env } from "../../config/env.js";
import { isMongoReady } from "../../config/database.js";
import { getRedisClient, isRedisReady } from "../../config/redis.js";
import { embeddingService } from "../embeddingService.js";
import { get, set, CacheKeys, TTL } from "../../shared/cache.js";
import { logger } from "../../shared/utils/logger.js";
import { SOURCE_POLICIES, isSourcePolicyComplete, isSourceActivationAllowed, isSourceEnabledByEnvironment } from "./sourcePolicies.js";
import { extractJobFeatures, canonicalSkill } from "./matching.js";
import { normalizeRoleForMatching } from "./roleNormalization.js";
import { classifyJobOccupation } from "./occupationClassification.js";
import { parseJobEligibility, profileApplicantCountries } from "./eligibility.js";
import { latestReferenceRates, convertAmount } from "./fxRates.js";
import { PLACE_SUGGESTIONS, ROLE_SUGGESTIONS } from "../profileSuggestionCatalog.js";
import { splitJobForStorage, encodeCatalogCursor, decodeCatalogCursor } from "./jobStorage.js";

const MAX_DESCRIPTION_CHARS = 24000;
const MAX_CANDIDATES = 400;
const BATCH_SIZE = 32;
const BULK_WRITE_BATCH_SIZE = 500;
const inMemoryJobs = new Map();
const adapterFactories = Object.create(null);
const sourceSeedPromises = new Map();
const ATS_SOURCE_PRIORITY = new Map([
  ["greenhouse", 0],
  ["lever", 0],
  ["ashby", 0],
  ["smartrecruiters", 0],
  ["recruitee", 0],
  ["workable", 0],
  ["usajobs", 0],
]);

export function registerJobAdapterFactory(key, factory) {
  if (!/^[a-z0-9_-]+$/.test(key) || typeof factory !== "function")
    throw new TypeError("A valid adapter key and factory are required.");
  if (adapterFactories[key]) throw new Error(`Job source adapter already registered: ${key}`);
  adapterFactories[key] = factory;
  return () => {
    delete adapterFactories[key];
  };
}

const dayStart = (date = new Date()) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function cleanNormalizedJob(job, source) {
  const normalized = {
    ...job,
    sourceBoard: source.key,
    sourceJobId: String(job.sourceJobId || "").slice(0, 200),
    canonicalUrl: String(job.canonicalUrl || job.sourceUrl || "").slice(0, 2000),
    sourceUrl: String(job.sourceUrl || job.canonicalUrl || "").slice(0, 2000),
    rawDescription: String(job.rawDescription || "").slice(0, MAX_DESCRIPTION_CHARS),
    requirements: Array.isArray(job.requirements) ? job.requirements.slice(0, 60).map(String) : [],
    tags: Array.isArray(job.tags) ? job.tags.slice(0, 60).map(String) : [],
    structuredLocation: {
      countryCode: String(job.structuredLocation?.countryCode || "")
        .toUpperCase()
        .slice(0, 2),
      region: String(job.structuredLocation?.region || "").slice(0, 120),
      city: String(job.structuredLocation?.city || "").slice(0, 120),
      remoteScope: job.structuredLocation?.remoteScope || "unknown",
      eligibleCountryCodes: (job.structuredLocation?.eligibleCountryCodes || [])
        .map((code) => String(code).toUpperCase().slice(0, 2))
        .filter(Boolean)
        .slice(0, 100),
      workAuthorization: (job.structuredLocation?.workAuthorization || []).map(String).slice(0, 20),
    },
    occupationCodes: Array.isArray(job.occupationCodes)
      ? job.occupationCodes.slice(0, 20).map(String)
      : [],
    sourceCategory: String(job.sourceCategory || job.category || "").slice(0, 160),
  };
  normalized.groupKey = source.adapter.generateGroupKey?.({
    canonicalUrl: normalized.canonicalUrl,
    company: normalized.company,
    title: normalized.title,
    location: normalized.location,
    employmentType: normalized.employmentType,
    postedAt: normalized.postedAt,
  }) || "";
  const contentHash = (source.adapter || null)?.generateContentHash?.(normalized);
  normalized.contentHash = contentHash || job.contentHash;
  normalized.identityKey = source.adapter.generateIdentity({
    source: source.key,
    sourceJobId: normalized.sourceJobId,
    canonicalUrl: normalized.canonicalUrl,
    title: normalized.title,
    company: normalized.company,
    location: normalized.location,
  });
  const now = new Date();
  normalized.features = extractJobFeatures(normalized);
  normalized.eligibility = parseJobEligibility({ ...normalized, ...job });
  Object.assign(normalized, classifyJobOccupation(normalized));
  const postedAt =
    normalized.postedAt instanceof Date && !Number.isNaN(normalized.postedAt.getTime())
      ? normalized.postedAt
      : null;
  const sourceExpiresAt =
    job.sourceExpiresAt instanceof Date && !Number.isNaN(job.sourceExpiresAt.getTime())
      ? job.sourceExpiresAt
      : null;
  const policyExpiry = new Date(
    (postedAt?.getTime() || now.getTime()) + source.retentionDays * 86400000,
  );
  normalized.postedAt = postedAt;
  normalized.postedDateKnown = Boolean(postedAt);
  normalized.firstSeenAt = now;
  normalized.lastSeenAt = now;
  normalized.contentUpdatedAt = now;
  normalized.status = "active";
  normalized.sourceExpiresAt = sourceExpiresAt;
  normalized.expiresAt =
    sourceExpiresAt && sourceExpiresAt < policyExpiry ? sourceExpiresAt : policyExpiry;
  if (
    normalized.compensation?.currency === "USD" &&
    normalized.compensation?.payPeriod === "year"
  ) {
    normalized.compensation.normalizedCurrency = "USD";
    normalized.compensation.normalizedAnnualMin = normalized.compensation.min ?? null;
    normalized.compensation.normalizedAnnualMax = normalized.compensation.max ?? null;
    normalized.compensation.normalizedAt = now;
  }
  normalized.provenance = [
    {
      source: source.key,
      sourceJobId: normalized.sourceJobId,
      canonicalUrl: normalized.canonicalUrl,
      attributionText: source.attributionText,
      attributionUrl: source.attributionUrl,
      seenAt: now,
    },
  ];
  return normalized;
}

function setContentHash(job, adapter) {
  job.contentHash = adapter.generateContentHash(job);
  job.recordHash = adapter.generateRecordHash(job);
}

/**
 * Link only exact entity/canonical-URL groups. Similarity vectors are never used
 * for identity. A source's own ATS posting is preferred as the canonical record.
 */
export async function updateVariantGroups(groupKeys) {
  if (!isMongoReady()) return 0;
  const keys = [...new Set((groupKeys || []).filter((key) => typeof key === "string" && key))];
  if (!keys.length) return 0;
  const candidates = await Job.find({
    groupKey: { $in: keys },
    status: "active",
    expiresAt: { $gt: new Date() },
  }).select("_id groupKey sourceBoard sourceUrl canonicalUrl firstSeenAt postedAt").lean();
  const groups = new Map();
  for (const job of candidates) {
    const group = groups.get(job.groupKey) || [];
    group.push(job);
    groups.set(job.groupKey, group);
  }
  const operations = [];
  for (const group of groups.values()) {
    const priority = (job) => ATS_SOURCE_PRIORITY.get(job.sourceBoard) ?? 10;
    group.sort((a, b) => priority(a) - priority(b)
      || (new Date(b.postedAt || 0).getTime() - new Date(a.postedAt || 0).getTime())
      || String(a.sourceBoard).localeCompare(String(b.sourceBoard))
      || String(a._id).localeCompare(String(b._id)));
    const [canonical, ...variants] = group;
    const boundedVariants = variants.slice(0, 10).map((variant) => ({
      source: variant.sourceBoard,
      url: variant.sourceUrl || variant.canonicalUrl || "",
      seenAt: variant.firstSeenAt || new Date(),
    }));
    for (const job of group) {
      operations.push({
        updateOne: {
          filter: { _id: job._id },
          update: { $set: {
            canonicalJobId: job._id.equals(canonical._id) ? null : canonical._id,
            variants: job._id.equals(canonical._id) ? boundedVariants : [],
          } },
        },
      });
    }
  }
  if (operations.length) await Job.bulkWrite(operations, { ordered: false });
  return operations.length;
}

async function ensureSourceRecords() {
  if (!isMongoReady()) return;
  const databaseKey = JobSource.db.name || "default";
  if (sourceSeedPromises.has(databaseKey)) return sourceSeedPromises.get(databaseKey);
  const seedPromise = (async () => {
    for (const policy of SOURCE_POLICIES) {
      if (!isSourcePolicyComplete(policy))
        throw new Error(`Incomplete source policy: ${policy.key}`);
      await JobSource.updateOne(
        { key: policy.key },
        { $setOnInsert: policy },
        { upsert: true },
      );
      const registryPolicy = {
        displayName: policy.displayName,
        adapterModule: policy.adapterModule,
        termsUrl: policy.termsUrl,
        termsReference: policy.termsReference,
        attributionText: policy.attributionText,
        attributionUrl: policy.attributionUrl,
        retentionDays: policy.retentionDays,
        retentionRule: policy.retentionRule,
        staleAfterDays: policy.staleAfterDays,
        quotaPolicy: policy.quotaPolicy,
        quota: policy.quota,
        termsVerifiedAt: policy.termsVerifiedAt,
        activationRequirements: policy.activationRequirements || [],
        activationStatus: policy.activationStatus || "terms_verified",
      };
      await JobSource.updateOne(
        { key: policy.key },
        { $set: registryPolicy },
      );
      // A local measurement can be enabled with one explicit flag. Production
      // still requires the persisted admin kill switch and never auto-enables.
      if (policy.key === "jobicy" && env.NODE_ENV !== "production" && env.ENABLE_JOBICY_INGESTION) {
        await JobSource.updateOne(
          { key: policy.key, approved: true },
          { $set: { enabled: true, runState: "idle" } },
        );
      }
    }
  })();
  sourceSeedPromises.set(databaseKey, seedPromise);
  try {
    await seedPromise;
  } catch (error) {
    sourceSeedPromises.delete(databaseKey);
    throw error;
  }
}

async function listSourceRecords({ enabledOnly = false } = {}) {
  if (isMongoReady()) {
    await ensureSourceRecords();
    const query = enabledOnly ? { enabled: true, approved: true } : {};
    const records = await JobSource.find(query).lean();
    return enabledOnly ? records.filter((source) => isSourcePolicyComplete(source) && isSourceActivationAllowed(source) && isSourceEnabledByEnvironment(source.key)) : records;
  }
  return SOURCE_POLICIES.filter((source) => !enabledOnly || (source.enabled && source.approved && isSourceActivationAllowed(source) && isSourceEnabledByEnvironment(source.key)));
}

export async function reserveSourceRequest(sourceKey, maxPerDay) {
  if (!isMongoReady()) return true;
  if (typeof maxPerDay === "object" && maxPerDay?.limits) {
    const now = new Date();
    const minuteStart = new Date(now); minuteStart.setUTCSeconds(0, 0);
    const dateStart = dayStart(now);
    const weekStart = new Date(dateStart); weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const windows = [
      ["quotaMinuteStart", "quotaMinuteUsed", minuteStart, maxPerDay.limits.perMinute],
      ["quotaWindowStart", "quotaUsed", dateStart, maxPerDay.limits.perDay || maxPerDay.requestsPerDay],
      ["quotaWeekStart", "quotaWeekUsed", weekStart, maxPerDay.limits.perWeek],
      ["quotaMonthStart", "quotaMonthUsed", monthStart, maxPerDay.limits.perMonth],
    ].filter(([, , , limit]) => Number.isFinite(Number(limit)) && Number(limit) > 0);
    const nextUsed = ([startField, usedField, start]) => ({ $cond: [{ $lt: [{ $ifNull: [`$${startField}`, new Date(0)] }, start] }, 1, { $add: [{ $ifNull: [`$${usedField}`, 0] }, 1] }] });
    const expression = { $and: windows.map(([startField, usedField, start, limit]) => ({ $lte: [nextUsed([startField, usedField, start]), Number(limit)] })) };
    const updates = Object.fromEntries(windows.flatMap(([startField, usedField, start]) => [[startField, { $cond: [{ $lt: [{ $ifNull: [`$${startField}`, new Date(0)] }, start] }, start, `$${startField}`] }], [usedField, nextUsed([startField, usedField, start])]]));
    const reserved = await JobSource.findOneAndUpdate({ key: sourceKey, enabled: true, approved: true, $expr: expression }, [{ $set: { ...updates, lastRequestAt: now } }], { new: true, projection: { quotaUsed: 1 } }).lean();
    return Boolean(reserved);
  }
  const windowStart = dayStart();
  const oldWindow = { $lt: [{ $ifNull: ["$quotaWindowStart", new Date(0)] }, windowStart] };
  const usedExpr = {
    $cond: [oldWindow, 1, { $add: [{ $ifNull: ["$quotaUsed", 0] }, 1] }],
  };
  const windowExpr = { $cond: [oldWindow, windowStart, "$quotaWindowStart"] };
  const reserved = await JobSource.findOneAndUpdate(
    { key: sourceKey, enabled: true, approved: true, $expr: { $lte: [usedExpr, maxPerDay] } },
    [{ $set: { quotaWindowStart: windowExpr, quotaUsed: usedExpr, lastRequestAt: new Date() } }],
    { new: true, projection: { quotaUsed: 1 } },
  ).lean();
  return Boolean(reserved);
}

function quotaExceeded(sourceKey) {
  const error = new Error(`Daily request budget reached for ${sourceKey}`);
  error.code = "SOURCE_QUOTA_EXHAUSTED";
  return error;
}

async function* iterateJobs(jobs) {
  if (jobs && typeof jobs[Symbol.asyncIterator] === "function") {
    yield* jobs;
    return;
  }
  if (Array.isArray(jobs)) yield* jobs;
}

async function getAggregatedDemandTerms() {
  if (!isMongoReady()) return [];
  const cachedTerms = await get(CacheKeys.jobDemand());
  if (Array.isArray(cachedTerms)) return cachedTerms;
  let aggregated;
  try {
    aggregated = await Profile.aggregate([
      {
        $project: {
          terms: {
            $concatArrays: [
              {
                $map: {
                  input: { $slice: [{ $ifNull: ["$preferences.targetRoles", []] }, 5] },
                  as: "value",
                  in: { kind: "role", value: "$$value" },
                },
              },
              {
                $map: {
                  input: { $slice: [{ $ifNull: ["$careerProfile.targetRoles", []] }, 5] },
                  as: "role",
                  in: { kind: "role", value: { $ifNull: ["$$role.customRoleLabel", "$$role.roleCode"] } },
                },
              },
              {
                $map: {
                  input: { $slice: [{ $concatArrays: [{ $ifNull: ["$careerProfile.targetLocations", []] }, [{ $ifNull: ["$careerProfile.homeLocation", {}] }]] }, 8] },
                  as: "location",
                  in: { kind: "location", value: { $ifNull: ["$$location.cityCode", { $ifNull: ["$$location.countryCode", "$$location.scope"] }] } },
                },
              },
              {
                $map: {
                  input: { $slice: [{ $ifNull: ["$preferences.preferredLocations", []] }, 5] },
                  as: "value",
                  in: { kind: "location", value: "$$value" },
                },
              },
              {
                $map: {
                  input: { $slice: [{ $ifNull: ["$preferences.preferredCountryCodes", []] }, 5] },
                  as: "value",
                  in: { kind: "location", value: "$$value" },
                },
              },
            ],
          },
        },
      },
      { $unwind: "$terms" },
      {
        $project: {
          kind: "$terms.kind",
          value: {
            $toLower: {
              $trim: {
                input: {
                  $convert: { input: "$terms.value", to: "string", onError: "", onNull: "" },
                },
              },
            },
          },
        },
      },
      { $match: { value: { $regex: "^[a-z0-9][a-z0-9 +.#-]{2,48}$" } } },
      { $group: { _id: { kind: "$kind", value: "$value" }, count: { $sum: 1 } } },
      { $match: { count: { $gte: 3 } } },
      { $sort: { count: -1, "_id.kind": 1, "_id.value": 1 } },
      { $limit: 40 },
    ]).option({ maxTimeMS: 1000 });
  } catch (error) {
    logger.warn(
      { errorCode: error.code || "DEMAND_AGGREGATION_FAILED" },
      "Could not refresh aggregated job demand; using broad catalog ingestion",
    );
    return [];
  }
  const resolveRole = (value) => ROLE_SUGGESTIONS.find((role) => role.code === value)?.label || value.replace(/[-_]+/g, " ");
  const resolveLocation = (value) => {
    const place = PLACE_SUGGESTIONS.find((item) => item.code === value);
    if (place) return place.label.toLowerCase();
    if (/^[a-z]{2}$/i.test(value)) return (PLACE_SUGGESTIONS.find((item) => item.countryCode === value.toUpperCase())?.country || value).toLowerCase();
    if (value === "anywhere_in_india") return "india";
    return value.toLowerCase();
  };
  const roles = aggregated.filter((item) => item._id.kind === "role").slice(0, 12).map((item) => ({ ...item, _id: { ...item._id, value: resolveRole(item._id.value) } }));
  const locations = aggregated.filter((item) => item._id.kind === "location").slice(0, 8).map((item) => ({ ...item, _id: { ...item._id, value: resolveLocation(item._id.value) } }));
  const terms = [];
  for (const role of roles) {
    terms.push(role._id.value);
    for (const location of locations.slice(0, 2))
      terms.push(`${role._id.value} ${location._id.value}`.slice(0, 50));
  }
  if (!roles.length) terms.push(...locations.map((location) => location._id.value));
  const resolvedTerms = [...new Set(terms)].slice(0, 32);
  await set(CacheKeys.jobDemand(), resolvedTerms, 21600);
  return resolvedTerms;
}

export const jobIngestionService = {
  async ensureSources() {
    await ensureSourceRecords();
    return listSourceRecords();
  },

  async getDemandTerms() {
    return getAggregatedDemandTerms();
  },

  async getAdapter(source) {
    let adapter;
    const testOrExtensionFactory = adapterFactories[source.key];
    if (testOrExtensionFactory) {
      adapter = testOrExtensionFactory(source);
    } else if (/^[A-Za-z0-9_-]+Adapter\.js$/.test(source.adapterModule || "")) {
      const adapterModule = await import(
        new URL(`./adapters/${source.adapterModule}`, import.meta.url)
      );
      const Adapter = adapterModule.default;
      if (typeof Adapter !== "function") return null;
      adapter = new Adapter({ ...source.quota, key: source.key });
    } else {
      return null;
    }
    adapter.consumeQuota = async () => {
      if (!(await reserveSourceRequest(source.key, source.quota.limits ? source.quota : source.quota.requestsPerDay)))
        throw quotaExceeded(source.key);
    };
    return adapter;
  },

  async getAdapters() {
    const sources = await listSourceRecords({ enabledOnly: true });
    return (await Promise.all(sources.map((source) => this.getAdapter(source)))).filter(Boolean);
  },

  async ingestAll(options = {}) {
    const sources = await listSourceRecords({ enabledOnly: true });
    const results = [];
    for (const source of sources) {
      try {
        results.push(await this.ingestSource(source.key, options));
      } catch (error) {
        logger.warn(
          { source: source.key, errorCode: error.code || "SOURCE_INGESTION_FAILED" },
          "Job source ingestion failed",
        );
        results.push({
          source: source.key,
          errors: 1,
          errorCode: error.code || "SOURCE_INGESTION_FAILED",
        });
      }
    }
    return {
      ingested: results.reduce((sum, result) => sum + (result.created || 0), 0),
      embedded: results.reduce((sum, result) => sum + (result.embedded || 0), 0),
      sources: results.map((result) => result.source),
      results,
    };
  },

  async ingestSource(sourceKey, { user, requestId } = {}) {
    if (!isMongoReady() && env.NODE_ENV === "production") {
      const error = new Error("The job source registry is unavailable.");
      error.statusCode = 503;
      error.code = "SOURCE_REGISTRY_UNAVAILABLE";
      throw error;
    }
    const source = isMongoReady()
      ? await JobSource.findOne({ key: sourceKey, enabled: true, approved: true }).lean()
      : SOURCE_POLICIES.find((item) => item.key === sourceKey && item.enabled && item.approved);
    if (!source || !isSourcePolicyComplete(source) || !isSourceActivationAllowed(source) || !isSourceEnabledByEnvironment(sourceKey))
      return { source: sourceKey, skipped: true, reason: "disabled_or_unapproved" };
    if (source.circuit?.openUntil && new Date(source.circuit.openUntil) > new Date()) {
      return { source: sourceKey, skipped: true, reason: "circuit_open" };
    }
    const adapter = await this.getAdapter(source);
    if (!adapter) return { source: sourceKey, skipped: true, reason: "adapter_not_registered" };
    source.adapter = adapter;
    const started = Date.now();
    let created = 0;
    let updated = 0;
    let duplicates = 0;
    let fetched = 0;
    let embedded = 0;
    let cursor = source.cursor || null;
    let etag = source.etag || null;
    let lastModified = source.lastModified || null;
    const fullSyncDue =
      !cursor &&
      (!source.lastFullSyncAt ||
        Date.now() - new Date(source.lastFullSyncAt).getTime() >= 86400000);
    const demandTerms =
      adapter.capabilities.demandSearch && !fullSyncDue ? await getAggregatedDemandTerms() : [];
    const demandIndex = demandTerms.length
      ? Number(source.demandCursor || 0) % demandTerms.length
      : 0;
    const demandTerm = cursor ? source.demandTerm || null : demandTerms[demandIndex] || null;
    const conditionalQuery = demandTerm || "__all__";
    if (source.conditionalQuery !== conditionalQuery) {
      etag = null;
      lastModified = null;
    }
    const coverageCountryCounts = Object.create(null);
    const coverageOccupationCounts = Object.create(null);
    let statusCheckRequests = 0;
    let fullSyncCompleted = false;

    try {
      if (isMongoReady()) {
        const now = new Date();
        const claimed = await JobSource.findOneAndUpdate(
          {
            key: sourceKey,
            enabled: true,
            approved: true,
            $or: [
              { runState: { $ne: "running" } },
              { runLeaseExpiresAt: { $lte: now } },
              { runLeaseExpiresAt: null },
            ],
            $and: [
              {
                $or: [
                  { lastRunAt: null },
                  { lastRunAt: { $lte: new Date(now.getTime() - source.quota.intervalMs) } },
                ],
              },
            ],
          },
          {
            $set: {
              runState: "running",
              lastRunAt: now,
              runLeaseExpiresAt: new Date(now.getTime() + 10 * 60000),
            },
          },
          { new: true },
        ).lean();
        if (!claimed) return { source: sourceKey, skipped: true, reason: "interval_or_run_lock" };
      }
      if (
        adapter.capabilities.statusCheck &&
        isMongoReady() &&
        (!source.lastLinkCheckAt ||
          Date.now() - new Date(source.lastLinkCheckAt).getTime() >= 86400000)
      ) {
        const sample = await Job.find({ sourceBoard: sourceKey, status: "active" })
          .sort({ sourceCheckedAt: 1, lastSeenAt: 1 })
          .limit(100)
          .select("sourceJobId")
          .lean();
        if (!sample.length) {
          await JobSource.updateOne({ key: sourceKey }, { $set: { lastLinkCheckAt: new Date() } });
        } else {
          try {
            const statuses = await adapter.checkStatuses(
              sample.map((job) => job.sourceJobId).filter((id) => /^\d+$/.test(String(id))),
            );
            statusCheckRequests = 1;
            const checkedAt = new Date();
            const updates = statuses
              .filter(
                (item) =>
                  /^\d+$/.test(String(item.id)) &&
                  ["active", "closed", "unknown"].includes(item.status),
              )
              .map((item) => ({
                updateOne: {
                  filter: { sourceBoard: sourceKey, sourceJobId: String(item.id) },
                  update:
                    item.status === "closed"
                      ? {
                          $set: {
                            status: "closed",
                            sourceExpiresAt: checkedAt,
                            expiresAt: checkedAt,
                            sourceCheckedAt: checkedAt,
                          },
                        }
                      : { $set: { sourceCheckedAt: checkedAt } },
                },
              }));
            if (updates.length) await Job.bulkWrite(updates, { ordered: false });
            await JobSource.updateOne({ key: sourceKey }, { $set: { lastLinkCheckAt: checkedAt } });
          } catch (error) {
            if (error.code === "SOURCE_QUOTA_EXHAUSTED") statusCheckRequests = 1;
            else
              logger.warn(
                { source: sourceKey, errorCode: error.code || `HTTP_${error.status || "NETWORK"}` },
                "Job source status check failed",
              );
          }
        }
      }
      const pageBudget = Math.max(0, source.quota.requestsPerDay - statusCheckRequests);
      for (let pageNo = 0; pageNo < pageBudget; pageNo += 1) {
        const page = await adapter.fetchPage({ cursor, etag, lastModified, demandTerm });
        if (page.etag) etag = page.etag;
        if (page.lastModified) lastModified = page.lastModified;
        const inactiveIds = [...new Set((page.inactiveIds || []).map((id) => String(id).slice(0, 200)).filter(Boolean))].slice(0, 10000);
        if (inactiveIds.length && isMongoReady()) {
          const inactiveAt = new Date();
          const result = await Job.updateMany(
            { sourceBoard: sourceKey, sourceJobId: { $in: inactiveIds }, status: "active" },
            { $set: { status: "closed", sourceExpiresAt: inactiveAt, expiresAt: inactiveAt, sourceCheckedAt: inactiveAt } },
          );
          updated += result.modifiedCount || 0;
        }
        if (page.notModified) {
          fullSyncCompleted = !demandTerm;
          if (isMongoReady())
            await JobSource.updateOne(
              { key: sourceKey },
              {
                $set: {
                  cursor: null,
                  lastFullSyncAt: fullSyncCompleted ? new Date() : source.lastFullSyncAt,
                  lastSuccessAt: new Date(),
                  demandTerm: null,
                  demandCursor:
                    demandTerms.length && demandTerm
                      ? (demandIndex + 1) % demandTerms.length
                      : source.demandCursor || 0,
                },
              },
            );
          break;
        }
        const processBatch = async (rawJobs) => {
        const normalized = rawJobs.map((job) => cleanNormalizedJob(job, source));
        const seenBatch = new Set();
        for (const job of normalized) {
          setContentHash(job, adapter);
          const country = job.structuredLocation?.countryCode || "unknown";
          const occupation = job.occupationCodes?.[0] || "unmapped";
          coverageCountryCounts[country] = (coverageCountryCounts[country] || 0) + 1;
          coverageOccupationCounts[occupation] = (coverageOccupationCounts[occupation] || 0) + 1;
          if (!job.identityKey || seenBatch.has(job.identityKey)) {
            duplicates += 1;
            continue;
          }
          seenBatch.add(job.identityKey);
        }
        fetched += normalized.length;
        const uniqueJobs = [...new Map(normalized.filter((job) => job.identityKey).map((job) => [job.identityKey, job])).values()];
        const existingDocs =
          isMongoReady() && uniqueJobs.length
            ? await Job.find({ identityKey: { $in: uniqueJobs.map((job) => job.identityKey) } })
                .select("identityKey contentHash recordHash firstSeenAt")
                .lean()
            : [];
        if (existingDocs.length) {
          const vectors = await JobVector.find({ jobId: { $in: existingDocs.map((job) => job._id) } })
            .select("+vector jobId provider model dimension")
            .lean();
          const vectorById = new Map(vectors.map((row) => [String(row.jobId), row]));
          for (const job of existingDocs) {
            const vector = vectorById.get(String(job._id));
            if (vector) {
              job.embedding = vector.vector;
              job.embeddingMetadata = { provider: vector.provider, model: vector.model, dimension: vector.dimension };
            }
          }
        }
        const existingByIdentity = new Map(existingDocs.map((job) => [job.identityKey, job]));
        const changed = [];
        const unchangedOps = [];
        for (const job of uniqueJobs) {
          const existing = existingByIdentity.get(job.identityKey);
          if (existing?.recordHash === job.recordHash) {
            job.lastSeenAt = new Date();
            duplicates += 1;
            if (isMongoReady()) unchangedOps.push({ updateOne: {
              filter: { identityKey: job.identityKey },
              update: { $set: { lastSeenAt: job.lastSeenAt, status: "active" } },
            } });
            else
              inMemoryJobs.set(job.identityKey, {
                ...inMemoryJobs.get(job.identityKey),
                lastSeenAt: job.lastSeenAt,
                status: "active",
              });
            continue;
          }
          if (existing) updated += 1;
          else created += 1;
          if (existing) job.firstSeenAt = existing.firstSeenAt || job.firstSeenAt;
          if (existing?.contentHash === job.contentHash && existing.embedding?.length) {
            job.embedding = existing.embedding;
            job.embeddingMetadata = existing.embeddingMetadata;
          }
          job.provenance[0].seenAt = new Date();
          changed.push(job);
        }

        if (isMongoReady() && unchangedOps.length) {
          for (let offset = 0; offset < unchangedOps.length; offset += BULK_WRITE_BATCH_SIZE) {
            await Job.bulkWrite(unchangedOps.slice(offset, offset + BULK_WRITE_BATCH_SIZE), { ordered: false });
          }
        }

        if (changed.length) {
          if (env.JOB_EMBEDDINGS_ENABLED || process.env.JOB_EMBEDDINGS_ENABLED === "true") {
          const config = embeddingService.getConfig();
          const vectorsByIndex = new Map();
          const missing = [];
          for (let index = 0; index < changed.length; index += 1) {
            const job = changed[index];
            if (job.embedding?.length) {
              vectorsByIndex.set(index, {
                vector: job.embedding,
                metadata: job.embeddingMetadata || {
                  provider: "legacy",
                  model: "unknown",
                  dimension: job.embedding.length,
                },
              });
              continue;
            }
            const key = CacheKeys.embedding(
              job.contentHash,
              config.provider,
              config.model,
              config.dimension,
            );
            const cached = await get(key);
            if (cached?.vector && cached?.metadata) vectorsByIndex.set(index, cached);
            else missing.push({ index, key, job });
          }
          for (let offset = 0; offset < missing.length; offset += BATCH_SIZE) {
            const batch = missing.slice(offset, offset + BATCH_SIZE);
            const vectors = await embeddingService.getEmbeddingsWithMetadata(
              batch.map(
                ({ job }) =>
                  `${job.title} at ${job.company}. Requirements: ${job.requirements.join(", ")}. ${job.rawDescription.slice(0, 500)}`,
              ),
              { user, feature: "match_jobs", requestId },
            );
            embedded += vectors.length;
            await Promise.all(
              vectors.map((value, batchIndex) => set(batch[batchIndex].key, value, TTL.EMBEDDING)),
            );
            batch.forEach((entry, batchIndex) =>
              vectorsByIndex.set(entry.index, vectors[batchIndex]),
            );
          }
          changed.forEach((job, index) => {
            const vector = vectorsByIndex.get(index);
            job.embedding = vector.vector;
            job.embeddingMetadata = vector.metadata;
          });
          }
          if (isMongoReady()) {
            const storageRows = changed.map((job) => ({ job, ...splitJobForStorage(job) }));
            for (let offset = 0; offset < storageRows.length; offset += BULK_WRITE_BATCH_SIZE) {
              const batch = storageRows.slice(offset, offset + BULK_WRITE_BATCH_SIZE);
              await Job.bulkWrite(batch.map(({ job, catalog }) => ({
                updateOne: {
                  filter: { identityKey: job.identityKey },
                  update: { $set: catalog },
                  upsert: true,
                },
              })), { ordered: false });
              const identities = batch.map(({ job }) => job.identityKey);
              const persisted = await Job.find({ identityKey: { $in: identities } }).select("_id identityKey").lean();
              const idByIdentity = new Map(persisted.map((row) => [row.identityKey, row._id]));
              const detailOps = batch.map(({ job, details }) => ({
                updateOne: {
                  filter: { jobId: idByIdentity.get(job.identityKey) },
                  update: { $set: { ...details, expiresAt: job.expiresAt } },
                  upsert: true,
                },
              })).filter((operation) => operation.updateOne.filter.jobId);
              if (detailOps.length) await JobDetail.bulkWrite(detailOps, { ordered: false });
              const vectorOps = batch.filter(({ vector }) => vector).map(({ job, vector }) => ({
                updateOne: {
                  filter: { jobId: idByIdentity.get(job.identityKey) },
                  update: { $set: vector },
                  upsert: true,
                },
              })).filter((operation) => operation.updateOne.filter.jobId);
              if (vectorOps.length) await JobVector.bulkWrite(vectorOps, { ordered: false });
              await updateVariantGroups(batch.map(({ job }) => job.groupKey));
            }
          } else {
            for (const job of changed)
              inMemoryJobs.set(job.identityKey, {
                _id: `job_${job.identityKey.slice(0, 10)}`,
                ...job,
              });
          }
        }
        };
        let rawBatch = [];
        let inactiveBatch = [];
        const flushInactive = async () => {
          if (!inactiveBatch.length || !isMongoReady()) {
            inactiveBatch = [];
            return;
          }
          const inactiveAt = new Date();
          const result = await Job.updateMany(
            { sourceBoard: sourceKey, sourceJobId: { $in: inactiveBatch }, status: "active" },
            { $set: { status: "closed", sourceExpiresAt: inactiveAt, expiresAt: inactiveAt, sourceCheckedAt: inactiveAt } },
          );
          updated += result.modifiedCount || 0;
          inactiveBatch = [];
        };
        const stream = page.events ? iterateJobs(page.events) : iterateJobs(page.jobs);
        for await (const item of stream) {
          if (page.events) {
            const event = item;
            if (event?.type === "delete") {
              const sourceJobId = String(event.sourceJobId || "").slice(0, 200);
              if (sourceJobId) inactiveBatch.push(sourceJobId);
              if (inactiveBatch.length >= BULK_WRITE_BATCH_SIZE) await flushInactive();
              continue;
            }
            if (event?.type !== "upsert" || !event.job) continue;
            rawBatch.push(event.job);
          } else {
            rawBatch.push(item);
          }
          if (rawBatch.length >= BULK_WRITE_BATCH_SIZE) {
            await processBatch(rawBatch);
            rawBatch = [];
          }
        }
        if (rawBatch.length) await processBatch(rawBatch);
        await flushInactive();
        cursor = page.cursor || null;
        if (isMongoReady())
          await JobSource.updateOne(
            { key: sourceKey },
            {
              $set: {
                cursor,
                demandTerm: cursor ? demandTerm : null,
                demandCursor:
                  demandTerms.length && !cursor
                    ? (demandIndex + 1) % demandTerms.length
                    : source.demandCursor || 0,
                conditionalQuery,
                etag,
                lastModified,
                ...(!cursor && !demandTerm ? { lastFullSyncAt: new Date() } : {}),
              },
            },
          );
        if (page.done || !cursor) fullSyncCompleted = !demandTerm;
        if (page.done || !cursor) break;
        // Internal pacing; Jobicy recommends no more than hourly sync passes.
        await sleep(1000);
      }
      const latencyMs = Date.now() - started;
      const coverage = { countryCounts: coverageCountryCounts, occupationCounts: coverageOccupationCounts };
      if (isMongoReady()) {
        if (fullSyncCompleted) {
          const staleBefore = new Date(Date.now() - source.staleAfterDays * 86400000);
          await Job.updateMany(
            { sourceBoard: sourceKey, status: "active", lastSeenAt: { $lt: staleBefore } },
            { $set: { status: "stale" } },
          );
          const activeFilter = {
            sourceBoard: sourceKey,
            status: "active",
            expiresAt: { $gt: new Date() },
          };
          const [countries, occupations] = await Promise.all([
            Job.aggregate([
              { $match: activeFilter },
              {
                $group: {
                  _id: { $ifNull: ["$structuredLocation.countryCode", "unknown"] },
                  count: { $sum: 1 },
                },
              },
              { $limit: 250 },
            ]),
            Job.aggregate([
              { $match: activeFilter },
              { $unwind: { path: "$occupationCodes", preserveNullAndEmptyArrays: true } },
              {
                $group: { _id: { $ifNull: ["$occupationCodes", "unmapped"] }, count: { $sum: 1 } },
              },
              { $limit: 250 },
            ]),
          ]);
          coverage.countryCounts = Object.fromEntries(
            countries.map(({ _id, count }) => [_id || "unknown", count]),
          );
          coverage.occupationCounts = Object.fromEntries(
            occupations.map(({ _id, count }) => [_id || "unmapped", count]),
          );
        }
        const metricsSet = {
          runState: "healthy",
          lastSuccessAt: new Date(),
          runLeaseExpiresAt: null,
          "circuit.failures": 0,
          "circuit.openUntil": null,
          lastErrorCode: "",
          "metrics.latencyMs": latencyMs,
        };
        if (fullSyncCompleted) {
          metricsSet["metrics.countryCounts"] = coverage.countryCounts;
          metricsSet["metrics.occupationCounts"] = coverage.occupationCounts;
        }
        await JobSource.updateOne(
          { key: sourceKey },
          {
            $set: metricsSet,
            $inc: {
              "metrics.fetched": fetched,
              "metrics.created": created,
              "metrics.updated": updated,
              "metrics.duplicates": duplicates,
            },
          },
        );
      }
      return {
        source: sourceKey,
        fetched,
        created,
        updated,
        duplicates,
        errors: 0,
        embedded,
        statusChecks: statusCheckRequests,
        latencyMs,
        quotaUsed: isMongoReady()
          ? (await JobSource.findOne({ key: sourceKey }).select("quotaUsed").lean())?.quotaUsed
          : fetched,
      };
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (sourceKey === "jobicy" && cursor && error.status === 400 && isMongoReady()) {
        await JobSource.updateOne(
          { key: sourceKey },
          { $set: { cursor: null, demandTerm: null, lastFullSyncAt: null } },
        );
      }
      if (error.code === "SOURCE_QUOTA_EXHAUSTED") {
        if (isMongoReady())
          await JobSource.updateOne(
            { key: sourceKey },
            {
              $set: {
                runState: "healthy",
                runLeaseExpiresAt: null,
                "metrics.latencyMs": latencyMs,
              },
            },
          );
        return {
          source: sourceKey,
          fetched,
          created,
          updated,
          duplicates,
          errors: 0,
          embedded,
          partial: true,
          reason: "daily_quota_reached",
          latencyMs,
        };
      }
      if (isMongoReady()) {
        await JobSource.updateOne(
          { key: sourceKey },
          {
            $inc: { "circuit.failures": 1, "metrics.errors": 1 },
            $set: {
              runState: "degraded",
              runLeaseExpiresAt: null,
              lastErrorCode: error.code || `HTTP_${error.status || "NETWORK"}`,
              "metrics.latencyMs": latencyMs,
            },
          },
        );
        const state = await JobSource.findOne({ key: sourceKey }).select("circuit.failures").lean();
        if ((state?.circuit?.failures || 0) >= 5)
          await JobSource.updateOne(
            { key: sourceKey },
            { $set: { "circuit.openUntil": new Date(Date.now() + 5 * 60000) } },
          );
      }
      throw error;
    }
  },

  async getAllJobs() {
    const now = new Date();
    const sources = await listSourceRecords({ enabledOnly: true });
    const enabledKeys = sources.map((source) => source.key);
    if (!enabledKeys.length) return [];
    if (isMongoReady())
      return Job.find({
        sourceBoard: { $in: enabledKeys },
        status: { $ne: "closed" },
        expiresAt: { $gt: now },
      })
        .sort({ postedAt: -1 })
        .limit(MAX_CANDIDATES)
        .select("-embedding -rawPayload")
        .lean();
    return Array.from(inMemoryJobs.values())
      .filter(
        (job) =>
          enabledKeys.includes(job.sourceBoard) &&
          job.status !== "closed" &&
          new Date(job.expiresAt) > now,
      )
      .slice(0, MAX_CANDIDATES);
  },

  async getCandidateJobs({ profile, limit = MAX_CANDIDATES, excludeJobIds = [] } = {}) {
    const safeLimit = Math.min(MAX_CANDIDATES, Math.max(1, Number(limit) || MAX_CANDIDATES));
    const now = new Date();
    const preferences = profile?.preferences || {};
    const filter = { status: "active", expiresAt: { $gt: now } };
    const sources = await listSourceRecords({ enabledOnly: true });
    const enabledKeys = sources.map((source) => source.key);
    if (!enabledKeys.length) return [];
    filter.sourceBoard = { $in: enabledKeys };
    if (["remote", "hybrid", "onsite"].includes(preferences.remotePreference))
      filter.remoteType = preferences.remotePreference;
    const countryCodes = [...new Set([...profileApplicantCountries(profile || {}), ...(preferences.preferredCountryCodes || []).map((code) => String(code).toUpperCase())])].filter((code) => /^[A-Z]{2}$/.test(code));
    if (countryCodes.length) {
      const matchingRegions = countryCodes.some((code) => ["GB", "IE", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "FI", "PL"].includes(code)) ? ["EU"] : [];
      if (countryCodes.some((code) => ["IN", "CN", "JP", "SG", "AU", "NZ", "KR", "TH", "ID", "MY", "PH", "VN"].includes(code))) matchingRegions.push("APAC");
      filter.$or = [
        { "structuredLocation.countryCode": { $in: countryCodes } },
        { "structuredLocation.eligibleCountryCodes": { $in: countryCodes } },
        { "eligibility.countries": { $in: countryCodes } },
        { "structuredLocation.remoteScope": "worldwide" },
        { "structuredLocation.remoteScope": "unknown" },
        { "eligibility.remoteScope": "worldwide" },
        { "eligibility.remoteScope": "unknown" },
        ...(matchingRegions.length ? [{ "eligibility.remoteScope": { $in: matchingRegions } }] : []),
      ];
    }
    const occupationCodes = (preferences.occupationCodes || []).slice(0, 20);
    if (occupationCodes.length) filter.occupationCodes = { $in: occupationCodes };
    if (excludeJobIds.length) filter._id = { $nin: excludeJobIds };
    const minimumSalary = Number(preferences.minimumSalaryUsd) || 0;
    if (minimumSalary > 0) {
      filter.$and = [
        {
          $or: [
            {
              "compensation.normalizedCurrency": "USD",
              "compensation.normalizedAnnualMax": { $gte: minimumSalary },
            },
            { "compensation.normalizedCurrency": { $exists: true, $ne: "USD" } },
            { "compensation.normalizedAnnualMax": null },
            {
              "compensation.normalizedAnnualMax": { $exists: false },
              "salaryRange.max": { $gte: minimumSalary },
            },
            {
              "compensation.normalizedAnnualMax": { $exists: false },
              $or: [{ "salaryRange.max": { $lte: 0 } }, { "salaryRange.max": { $exists: false } }],
            },
          ],
        },
      ];
    }
    // Location is ranked with fallback tiers in discovery. A text-only city
    // preference must never hard-exclude remote jobs from the candidate pool.
    if (isMongoReady()) {
      const roleTerms = [
        ...(profile?.preferences?.targetRoles || []),
        ...(profile?.careerProfile?.targetRoles || []).map((role) => role.customRoleLabel || String(role.roleCode || "").replace(/[-_]+/g, " ")),
        ...(profile?.roles || []).map((role) => role.title),
      ];
      const lexicalTerms = [
        ...new Set(
          [
            ...(profile?.skills || []).map((skill) => canonicalSkill(skill.name)),
            ...roleTerms.flatMap((role) =>
              String(normalizeRoleForMatching(role))
                .toLowerCase()
                .split(/[^\p{L}\p{N}.+#]+/u),
            ),
          ].filter((term) => term && term.length > 1),
        ),
      ].slice(0, 64);
      const safeSelect =
        "title company location remoteType salaryRange compensation tags sourceBoard sourceUrl canonicalUrl sourceJobId postedAt expiresAt structuredLocation eligibility occupationCodes occupation occupationConfidence contentHash features featuresVersion";
      const recentFallbackSelect =
        "title company location remoteType salaryRange compensation tags sourceBoard sourceUrl canonicalUrl sourceJobId postedAt postedDateKnown expiresAt structuredLocation eligibility occupation occupationConfidence occupationCodes contentHash features featuresVersion";
      const base = { ...filter };
      const existingAnd = Array.isArray(base.$and) ? base.$and : [];
      delete base.$and;
      const existingOr = base.$or;
      delete base.$or;
      const commonAnd = [...existingAnd, ...(existingOr ? [{ $or: existingOr }] : [])];
      const recentQuery = { ...base, ...(commonAnd.length ? { $and: commonAnd } : {}) };
      const activeCatalogQuery = {
        status: "active",
        expiresAt: { $gt: now },
        sourceBoard: { $in: enabledKeys },
      };
      const [activeCatalogCount, eligibleCount] = await Promise.all([
        Job.countDocuments(activeCatalogQuery),
        Job.countDocuments(recentQuery),
      ]);
      // Fetch a bounded superset via the separate multikey indexes. The old
      // aggregation scored and sorted every lexical match before applying the
      // candidate cap, which became a catalog-wide scan for broad skill lists.
      const normalizedRoleTerms = [
        ...new Set(
          [...(preferences.targetRoles || []), ...(profile?.careerProfile?.targetRoles || []).map((role) => role.customRoleLabel || String(role.roleCode || "").replace(/[-_]+/g, " ")), ...(profile?.roles || []).map((role) => role.title)]
            .flatMap((role) =>
              String(normalizeRoleForMatching(role))
                .toLowerCase()
                .split(/[^\p{L}\p{N}.+#]+/u),
            )
            .filter((term) => term.length > 1),
        ),
      ].slice(0, 32);
      const occupationTerms = (preferences.occupationCodes || []).slice(0, 20);
      const skillTerms = [
        ...new Set(
          (profile?.skills || []).map((skill) => canonicalSkill(skill.name)).filter(Boolean),
        ),
      ].slice(0, 64);
      const lexicalFetchLimit = safeLimit;
      const lexicalQueries = [];
      if (normalizedRoleTerms.length || occupationTerms.length) {
        const roleOr = [];
        if (normalizedRoleTerms.length)
          roleOr.push({ "features.titleTokens": { $in: normalizedRoleTerms } });
        if (occupationTerms.length) roleOr.push({ occupationCodes: { $in: occupationTerms } });
        lexicalQueries.push(
          Job.find({
            ...base,
            $and: [...commonAnd, { $or: roleOr }],
          })
            .limit(lexicalFetchLimit)
            .select(safeSelect)
            .lean(),
        );
      }
      if (skillTerms.length) {
        lexicalQueries.push(
          Job.find({
            ...base,
            ...(commonAnd.length ? { $and: commonAnd } : {}),
            "features.skills": { $in: skillTerms },
          })
            .limit(lexicalFetchLimit)
            .select(safeSelect)
            .lean(),
        );
      }
      const lexicalBatches = await Promise.all(lexicalQueries);
      const lexicalPool = new Map(lexicalBatches.flat().map((job) => [String(job._id), job]));
      const relevance = (job) => {
        const titleTokens = new Set(job.features?.titleTokens || []);
        const skills = new Set(job.features?.skills || []);
        const tags = new Set(job.tags || []);
      const requirements = new Set(job.requirements || []);
        return (
          normalizedRoleTerms.filter((term) => titleTokens.has(term)).length * 4 +
          skillTerms.filter((term) => skills.has(term)).length * 2 +
          lexicalTerms.filter((term) => tags.has(term) || requirements.has(term)).length
        );
      };
      const lexical = [...lexicalPool.values()]
        .map((job) => ({ job, score: relevance(job) }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            Number(b.job.postedDateKnown) - Number(a.job.postedDateKnown) ||
            new Date(b.job.postedAt || 0) - new Date(a.job.postedAt || 0) ||
            String(a.job._id).localeCompare(String(b.job._id)),
        )
        .slice(0, safeLimit)
        .map(({ job }) => job);
      const remaining = Math.max(0, safeLimit - lexical.length);
      const recentFallbackLimit = Math.min(remaining, env.JOBS_RECENT_FALLBACK_LIMIT);
      const recent = recentFallbackLimit
        ? await Job.find({
            ...recentQuery,
            ...(lexical.length
              ? { _id: { ...(recentQuery._id || {}), $nin: lexical.map((job) => job._id) } }
              : {}),
          })
            .sort({ postedAt: -1, _id: 1 })
            .limit(recentFallbackLimit)
            .select(recentFallbackSelect)
            .lean()
        : [];
      const combined = new Map(lexical.map((job) => [String(job._id), job]));
      for (const job of recent) combined.set(String(job._id), job);
      const result = [...combined.values()].slice(0, safeLimit);
      Object.defineProperty(result, "retrievalStats", {
        enumerable: false,
        value: {
          activeCatalogCount,
          eligibleCount,
          candidateCap: safeLimit,
          lexicalCandidateCount: lexical.length,
        },
      });
      return result;
    }
    const available = Array.from(inMemoryJobs.values())
      .filter((job) => {
        if (new Date(job.expiresAt) <= new Date() || job.status === "closed") return false;
        if (!enabledKeys.includes(job.sourceBoard)) return false;
        if (filter.remoteType && job.remoteType !== filter.remoteType) return false;
        if (
          countryCodes.length &&
          job.structuredLocation?.countryCode &&
          !countryCodes.includes(job.structuredLocation.countryCode) &&
          !job.structuredLocation.eligibleCountryCodes?.some((code) =>
            countryCodes.includes(code),
          ) &&
          job.structuredLocation.remoteScope !== "worldwide"
        )
          return false;
        return true;
      })
      .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
    const result = available.slice(0, Math.min(safeLimit, env.JOBS_RECENT_FALLBACK_LIMIT));
    Object.defineProperty(result, "retrievalStats", {
      enumerable: false,
      value: {
        activeCatalogCount: available.length,
        eligibleCount: available.length,
        candidateCap: safeLimit,
        lexicalCandidateCount: 0,
      },
    });
    return result;
  },

  async searchJobs({
    q = "",
    location = "",
    countryCode = "",
    source = "",
    remoteType = "",
    occupation = "",
    eligibility = "",
    postedWithinDays = 0,
    minimumSalaryInr = null,
    eligibilityCountryCodes = [],
    showAnyway = false,
    excludeJobIds = [],
    page = 1,
    cursor = "",
    limit = 20,
  }) {
    const sources = await listSourceRecords({ enabledOnly: true });
    const enabledKeys = sources.map((item) => item.key);
    if (!enabledKeys.length) return { jobs: [], total: 0, page, limit, pages: 0, sources: [] };
    const filter = {
      sourceBoard: { $in: enabledKeys },
      status: "active",
      expiresAt: { $gt: new Date() },
    };
    if (q) {
      const tokens = [...new Set(String(q).normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) || [])].slice(0, 8);
      if (tokens.length) filter.$and = tokens.map((token) => ({
        $or: [
          { "features.titleTokens": token },
          { "features.companyTokens": token },
        ],
      }));
    }
    if (location) filter.location = new RegExp(safeRegex(location), "i");
    if (occupation && /^[a-z0-9-]{2,60}$/i.test(occupation)) filter.occupation = occupation.toLowerCase();
    if (Number(postedWithinDays) > 0) filter.postedAt = { $gte: new Date(Date.now() - Number(postedWithinDays) * 86400000) };
    if (eligibility === "unknown") filter["eligibility.confidence"] = { $lte: 0.35 };
    if (eligibility === "eligible" && eligibilityCountryCodes.length) {
      const codes = eligibilityCountryCodes.map((code) => String(code).toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code));
      filter.$and = [...(filter.$and || []), { $or: [{ "eligibility.countries": { $in: codes } }, { "structuredLocation.eligibleCountryCodes": { $in: codes } }, { "structuredLocation.countryCode": { $in: codes } }, { "structuredLocation.remoteScope": "worldwide" }] }];
    }
    if (/^[A-Za-z]{2}$/.test(countryCode))
      filter["structuredLocation.countryCode"] = countryCode.toUpperCase();
    if (source) {
      const requestedSource = String(source).toLowerCase();
      if (!enabledKeys.includes(requestedSource))
        return { jobs: [], total: 0, page, limit, pages: 0, sources: await this.publicSources() };
      filter.sourceBoard = requestedSource;
    }
    if (["remote", "hybrid", "onsite"].includes(remoteType)) filter.remoteType = remoteType;
    const minimumInr = Number(minimumSalaryInr);
    if (Number.isFinite(minimumInr) && minimumInr > 0) {
      const rate = await latestReferenceRates().catch(() => null);
      const comparable = [];
      for (const currency of ["INR", "USD", "EUR", "GBP", "CAD", "AUD", "AED", "SAR"]) {
        const requiredAnnual = currency === "INR" ? minimumInr : rate ? convertAmount(minimumInr, "INR", currency, rate.ratesPerEur) : null;
        if (!requiredAnnual) continue;
        comparable.push({ "compensation.currency": currency, "compensation.payPeriod": "year", "compensation.max": { $gte: requiredAnnual } });
        comparable.push({ "compensation.currency": currency, "compensation.payPeriod": "month", "compensation.max": { $gte: requiredAnnual / 12 } });
        comparable.push({ "compensation.normalizedCurrency": currency, "compensation.normalizedAnnualMax": { $gte: requiredAnnual } });
      }
      // Incomparable pay (hourly, contract, unknown, or undisclosed) remains visible.
      const incomparable = [
        { "compensation.payPeriod": { $in: ["hour", "day", "contract", "unknown", null] } },
        { compensation: { $exists: false } },
        { "compensation.max": null },
        { "compensation.max": { $lte: 0 } },
      ];
      filter.$and = [...(filter.$and || []), { $or: [...comparable, ...incomparable] }];
    }
    if (excludeJobIds.length) filter._id = { $nin: excludeJobIds };
    const applicantCountries = eligibilityCountryCodes.map((code) => String(code).toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code));
    if (applicantCountries.length && !showAnyway) {
      const regionCodes = {
        EU: ["GB", "IE", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "FI", "PL"],
        APAC: ["IN", "CN", "JP", "SG", "AU", "NZ", "KR", "TH", "ID", "MY", "PH", "VN"],
      };
      const matchingRegions = Object.entries(regionCodes).filter(([, countries]) => applicantCountries.some((code) => countries.includes(code))).map(([region]) => region);
      const explicitMismatch = {
        $or: [
          { "eligibility.countries": { $exists: true, $ne: [], $nin: applicantCountries } },
          { "eligibility.countries": { $exists: false }, "structuredLocation.countryCode": { $exists: true, $ne: "", $nin: applicantCountries }, "structuredLocation.remoteScope": { $nin: ["worldwide", "unknown"] } },
          ...(matchingRegions.includes("EU") ? [] : [{ "eligibility.remoteScope": "EU" }]),
          ...(matchingRegions.includes("APAC") ? [] : [{ "eligibility.remoteScope": "APAC" }]),
        ],
      };
      filter.$nor = [...(filter.$nor || []), explicitMismatch];
    }
    if (isMongoReady()) {
      const cursorData = decodeCatalogCursor(cursor);
      const cursorFilter = cursorData ? {
        $or: cursorData.postedAt
          ? [
              { postedAt: { $lt: new Date(cursorData.postedAt) } },
              { postedAt: null, _id: { $gt: cursorData.id } },
              { postedAt: new Date(cursorData.postedAt), _id: { $gt: cursorData.id } },
            ]
          : [{ postedAt: null, _id: { $gt: cursorData.id } }],
      } : null;
      const query = cursorFilter ? { $and: [filter, cursorFilter] } : filter;
      const fetchedJobs = await Job.find(query)
        .sort({ postedAt: -1, _id: 1 })
        .limit(limit + 1)
        .select("-embedding -rawPayload -rawDescription -requirements")
        .lean();
      const hasMore = fetchedJobs.length > limit;
      const jobs = fetchedJobs.slice(0, limit);
      const last = jobs.at(-1);
      const nextCursor = hasMore && last
        ? encodeCatalogCursor({ id: String(last._id), postedAt: last.postedAt ? new Date(last.postedAt).toISOString() : null })
        : null;
      const estimateKey = `jobs:catalog:active-count:v2:${enabledKeys.slice().sort().join(",")}`;
      let total = await get(estimateKey).catch(() => null);
      if (!Number.isFinite(Number(total))) {
        total = await Job.countDocuments({
          sourceBoard: { $in: enabledKeys },
          status: "active",
          expiresAt: { $gt: new Date() },
        }).catch(() => jobs.length + Number(hasMore));
        await set(estimateKey, Number(total), 300).catch(() => {});
      }
      return {
        jobs: jobs.map((job) => ({
          ...job,
          postedDateKnown:
            job.postedDateKnown ??
            (job.postedAt && job.createdAt
              ? Math.abs(new Date(job.postedAt) - new Date(job.createdAt)) > 5 * 60_000
              : false),
          jobId: String(job._id),
        })),
        total: Number(total),
        totalIsApproximate: true,
        hasMore,
        nextCursor,
        page: 1,
        limit,
        pages: 0,
        sources: await this.publicSources(),
      };
    }
    const jobs = Array.from(inMemoryJobs.values())
      .filter((job) => {
        if (new Date(job.expiresAt) <= new Date() || job.status === "closed") return false;
        if (!enabledKeys.includes(job.sourceBoard)) return false;
        if (
          q &&
          ![job.title, job.company, ...(job.tags || []), ...(job.requirements || [])]
            .join(" ")
            .toLowerCase()
            .includes(q.toLowerCase())
        )
          return false;
        if (location && !(job.location || "").toLowerCase().includes(location.toLowerCase()))
          return false;
        if (countryCode && job.structuredLocation?.countryCode !== countryCode.toUpperCase())
          return false;
        if (source && job.sourceBoard?.toLowerCase() !== source.toLowerCase()) return false;
        if (remoteType && job.remoteType !== remoteType) return false;
        if (applicantCountries.length && !showAnyway) {
          const countries = job.eligibility?.countries || job.structuredLocation?.eligibleCountryCodes || [];
          const country = job.structuredLocation?.countryCode;
          const scope = job.eligibility?.remoteScope || job.structuredLocation?.remoteScope || "unknown";
          const matchesRegion = scope === "EU" && applicantCountries.some((code) => ["GB", "IE", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "FI", "PL"].includes(code)) || scope === "APAC" && applicantCountries.some((code) => ["IN", "CN", "JP", "SG", "AU", "NZ", "KR", "TH", "ID", "MY", "PH", "VN"].includes(code));
          if (scope !== "worldwide" && !matchesRegion && ((countries.length && !countries.some((code) => applicantCountries.includes(code))) || (country && scope !== "unknown" && !applicantCountries.includes(country)))) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          Number(Boolean(b.postedDateKnown)) - Number(Boolean(a.postedDateKnown)) ||
          new Date(b.postedAt || 0) - new Date(a.postedAt || 0),
      );
    return {
      jobs: jobs.slice((page - 1) * limit, page * limit).map(({ embedding: _embedding, rawDescription: _rawDescription, requirements: _requirements, ...job }) => ({
        ...job,
        jobId: String(job._id || job.identityKey),
      })),
      total: jobs.length,
      page,
      limit,
      pages: Math.ceil(jobs.length / limit),
      totalIsApproximate: false,
      hasMore: jobs.length > page * limit,
      nextCursor: null,
      sources: await this.publicSources(),
    };
  },

  async sourceBudgets() {
    const records = await listSourceRecords();
    const counts =
      isMongoReady() && records.length
        ? await Job.aggregate([
            {
              $match: {
                sourceBoard: { $in: records.map((source) => source.key) },
                status: "active",
                expiresAt: { $gt: new Date() },
              },
            },
            { $group: { _id: "$sourceBoard", count: { $sum: 1 } } },
          ])
        : [];
    const countByKey = new Map(counts.map(({ _id, count }) => [_id, count]));
    let worker = { status: "offline", online: false, lastSeenAt: null };
    if (isRedisReady()) {
      try {
        const redis = getRedisClient();
        const [heartbeat, lastSeenAt] = await Promise.all([
          redis.get("jobscout:worker:heartbeat"),
          redis.get("jobscout:worker:last-seen"),
        ]);
        const online = Boolean(heartbeat);
        worker = { status: online ? "online" : "offline", online, lastSeenAt: lastSeenAt ? new Date(lastSeenAt) : null };
      } catch { /* worker status remains unknown/offline when Redis is unavailable */ }
    }
    return records.map((source) => ({
      worker,
      key: source.key,
      displayName: source.displayName,
      enabled: Boolean(source.enabled && source.approved && isSourcePolicyComplete(source) && isSourceEnabledByEnvironment(source.key) && isSourceActivationAllowed(source)),
      approved: Boolean(source.approved),
      quota: source.quota,
      quotaUsed: new Date(source.quotaWindowStart || 0) < dayStart() ? 0 : source.quotaUsed || 0,
      quotaRemaining: Math.max(
        0,
        source.quota.requestsPerDay -
          (new Date(source.quotaWindowStart || 0) < dayStart() ? 0 : source.quotaUsed || 0),
      ),
      quotaResetsAt: new Date(dayStart().getTime() + 86400000),
      runState: source.runState || "idle",
      lastSuccessAt: source.lastSuccessAt || null,
      lastRunAt: source.lastRunAt || null,
      nextRunAt:
        source.enabled && isSourceEnabledByEnvironment(source.key) && source.quota?.intervalMs
          ? new Date(
              Math.max(
                Date.now(),
                new Date(source.lastRunAt || 0).getTime() + source.quota.intervalMs,
              ),
            )
          : null,
      indexedCount: countByKey.get(source.key) || 0,
      lastErrorCode: source.lastErrorCode || "",
      metrics: source.metrics || {},
      attributionText: source.attributionText,
      attributionUrl: source.attributionUrl,
      termsVerifiedAt: source.termsVerifiedAt,
    }));
  },

  async coverageReport(profile = null) {
    if (!isMongoReady()) return { totalActive: 0, byOccupation: [], byCountry: [], byRemoteScope: [], bySource: [], unknownEligibilityCount: 0, targetLocations: [] };
    const active = { status: "active", expiresAt: { $gt: new Date() } };
    const groupBy = async (field) => Job.aggregate([{ $match: active }, { $group: { _id: { $ifNull: [`$${field}`, "unknown"] }, count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]).option({ maxTimeMS: 2000 });
    const [totalActive, byOccupation, byCountry, byRemoteScope, bySource, unknownEligibilityCount, byOccupationCountry, unclassifiedBySource] = await Promise.all([
      Job.countDocuments(active),
      groupBy("occupation"),
      groupBy("structuredLocation.countryCode"),
      groupBy("eligibility.remoteScope"),
      groupBy("sourceBoard"),
      Job.countDocuments({ ...active, $or: [{ eligibility: { $exists: false } }, { "eligibility.remoteScope": "unknown" }, { "eligibility.confidence": { $lt: 0.5 } }] }),
      Job.aggregate([{ $match: active }, { $group: { _id: { occupation: { $ifNull: ["$occupation", "unclassified"] }, country: { $ifNull: ["$structuredLocation.countryCode", "unknown"] } }, count: { $sum: 1 } } }, { $sort: { count: -1, "_id.occupation": 1 } }]).option({ maxTimeMS: 2000 }),
      Job.aggregate([{ $match: active }, { $group: { _id: "$sourceBoard", total: { $sum: 1 }, unclassified: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$occupation", "unclassified"] }, "unclassified"] }, 1, 0] } } } }, { $sort: { _id: 1 } }]).option({ maxTimeMS: 2000 }),
    ]);
    const locations = [...new Map([
      profile?.careerProfile?.homeLocation,
      ...(profile?.careerProfile?.targetLocations || []),
    ].filter((item) => item?.countryCode).map((item) => [item.countryCode, item])).values()];
    const targetLocations = await Promise.all(locations.map(async (location) => ({
      countryCode: location.countryCode,
      eligibleCount: await Job.countDocuments({ ...active, $or: [{ "eligibility.countries": location.countryCode }, { "eligibility.remoteScope": "worldwide" }] }),
    })));
    return { totalActive, byOccupation, byCountry, byRemoteScope, bySource, unknownEligibilityCount, byOccupationCountry, unclassifiedBySource: unclassifiedBySource.map((item) => ({ ...item, unclassifiedShare: item.total ? Number((item.unclassified / item.total).toFixed(4)) : 0 })), targetLocations };
  },

  async publicSources() {
    const sources = await listSourceRecords({ enabledOnly: true });
    const counts =
      isMongoReady() && sources.length
        ? await Job.aggregate([
            {
              $match: {
                sourceBoard: { $in: sources.map((source) => source.key) },
                status: "active",
                expiresAt: { $gt: new Date() },
              },
            },
            { $group: { _id: "$sourceBoard", count: { $sum: 1 } } },
          ])
        : [];
    const countByKey = new Map(counts.map(({ _id, count }) => [_id, count]));
    return sources.map((source) => ({
      key: source.key,
      displayName: source.displayName,
      attributionText: source.attributionText,
      attributionUrl: source.attributionUrl,
      indexedCount: countByKey.get(source.key) || 0,
    }));
  },

  async setSourceEnabled(sourceKey, enabled) {
    if (!isMongoReady()) {
      const error = new Error("Job source controls require MongoDB.");
      error.statusCode = 503;
      error.code = "SOURCE_REGISTRY_UNAVAILABLE";
      throw error;
    }
    const source = await JobSource.findOne({ key: sourceKey }).lean();
    if (enabled && !isSourceEnabledByEnvironment(sourceKey)) {
      const error = new Error(`Enable ${sourceKey} ingestion with its backend environment flag before turning it on in admin.`);
      error.statusCode = 409;
      error.code = "SOURCE_ENV_DISABLED";
      throw error;
    }
    if (!source || !source.approved || !isSourcePolicyComplete(source) || !isSourceActivationAllowed(source)) {
      const error = new Error("This source has not passed the approved source policy gate.");
      error.statusCode = 404;
      error.code = "SOURCE_NOT_APPROVED";
      throw error;
    }
    await JobSource.updateOne(
      { key: sourceKey },
      { $set: { enabled: Boolean(enabled), runState: enabled ? "idle" : "disabled" } },
    );
    return this.sourceBudgets();
  },

  async setSourceApproved(sourceKey, approved) {
    if (!isMongoReady()) {
      const error = new Error("Job source controls require MongoDB.");
      error.statusCode = 503;
      error.code = "SOURCE_REGISTRY_UNAVAILABLE";
      throw error;
    }
    const source = await JobSource.findOne({ key: sourceKey }).lean();
    if (!source || !isSourcePolicyComplete(source) || (approved && !isSourceActivationAllowed(source))) {
      const error = new Error("This source does not have the required policy metadata.");
      error.statusCode = 404;
      error.code = "SOURCE_POLICY_INCOMPLETE";
      throw error;
    }
    await JobSource.updateOne({ key: sourceKey }, { $set: { approved: Boolean(approved), ...(approved ? {} : { enabled: false, runState: "disabled" }) } });
    return this.sourceBudgets();
  },
};
