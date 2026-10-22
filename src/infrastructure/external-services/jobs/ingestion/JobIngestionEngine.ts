import type { FilterQuery } from "mongoose";
import { Job } from "../../../database/mongoose/models/JobModel.js";
import { JobDetail } from "../../../database/mongoose/models/JobDetailModel.js";
import { JobVector } from "../../../database/mongoose/models/JobVectorModel.js";
import { JobSource } from "../../../database/mongoose/models/JobSourceModel.js";
import { Profile } from "../../../database/mongoose/models/ProfileModel.js";
import { env } from "../../../../config/env.js";
import { isMongoReady } from "../../../database/database.js";
import { getRedisClient, isRedisReady } from "../../../cache/redis.js";
import { embeddingService } from "../../../ai/embeddingService.js";
import { get, set, CacheKeys, TTL } from "../../../../shared/cache.js";
import { logger } from "../../../../shared/utils/logger.js";
import {
  SOURCE_POLICIES,
  isSourcePolicyComplete,
  isSourceActivationAllowed,
  isSourceEnabledByEnvironment,
  type SourcePolicy,
  type SourcePolicyDefinition,
} from "../../../../domain/services/jobs/sourcePolicies.js";
import { extractJobFeatures, canonicalSkill } from "../../../../domain/services/jobs/matching.js";
import { normalizeRoleForMatching } from "../../../../domain/services/jobs/roleNormalization.js";
import { classifyJobOccupation } from "../../../../domain/services/jobs/occupationClassification.js";
import {
  parseJobEligibility,
  profileApplicantCountries,
} from "../../../../domain/services/jobs/eligibility.js";
import { latestReferenceRates } from "../../../database/mongoose/repositories/MongooseFxRateRepository.js";
import { convertAmount } from "../../../../domain/services/currency/currencyConverter.js";
import {
  PLACE_SUGGESTIONS,
  ROLE_SUGGESTIONS,
} from "../../../../domain/services/profile/profileSuggestionCatalog.js";
import {
  splitJobForStorage,
  encodeCatalogCursor,
  decodeCatalogCursor,
} from "../../../database/mongoose/storage/jobStorageCompaction.js";
import {
  bumpCatalogVersion,
  getCatalogVersion,
} from "../../../database/mongoose/repositories/MongooseCatalogVersionRepository.js";
import {
  buildSearchTokens,
  expandQueryTokensWithTypos,
  scoreCatalogSearchRelevance,
  compareJobsByRelevance,
  isAfterRelevanceCursor,
} from "../../../../domain/services/jobs/jobSearch.js";
import {
  INGESTION_ALERT_THRESHOLDS,
  appendDeadLetters,
  buildDeadLetterEntry,
  computeCircuitOpenUntil,
  evaluateSourceHealthAlerts,
  isIngestionShuttingDown,
  requestIngestionShutdown,
  resetIngestionShutdown,
  validateRawIngestJob,
  type DeadLetterEntry,
} from "../../../../domain/services/jobs/ingestionResilience.js";
import {
  computeSourceTermExpiry,
  detectRepostSignal,
  sampleJobsForPoliteLinkCheck,
} from "../../../../domain/services/jobs/jobRisk.js";

export interface SourceAdapter {
  capabilities: {
    demandSearch?: boolean;
    [key: string]: unknown;
  };
  generateGroupKey?: (args: {
    canonicalUrl?: string;
    company?: unknown;
    title?: unknown;
    location?: unknown;
    employmentType?: unknown;
    postedAt?: unknown;
  }) => string;
  generateContentHash?: (job: Record<string, unknown>) => string;
  generateRecordHash?: (job: Record<string, unknown>) => string;
  generateIdentity: (args: {
    source: string;
    sourceJobId?: string;
    canonicalUrl?: string;
    title?: unknown;
    company?: unknown;
    location?: unknown;
  }) => string;
  fetchPage: (options: {
    cursor?: string | null;
    etag?: string | null;
    lastModified?: string | null;
    demandTerm?: string | null;
  }) => Promise<{
    jobs?: RawJobInput[];
    events?: Array<{ type?: string; sourceJobId?: string; job?: RawJobInput } | RawJobInput>;
    cursor?: string | null;
    etag?: string | null;
    lastModified?: string | null;
    inactiveIds?: string[];
    notModified?: boolean;
    done?: boolean;
  }>;
  checkStatuses?: (ids: string[]) => Promise<Array<{ id: string; status: string }>>;
  consumeQuota?: () => Promise<boolean>;
  [key: string]: unknown;
}

export interface JobSourceRecord extends SourcePolicyDefinition {
  _id?: unknown;
  adapter?: SourceAdapter;
  cursor?: string | null;
  demandCursor?: number;
  demandTerm?: string | null;
  conditionalQuery?: string;
  etag?: string | null;
  lastModified?: string | null;
  quotaWindowStart?: Date;
  quotaUsed?: number;
  quotaMinuteStart?: Date;
  quotaMinuteUsed?: number;
  quotaWeekStart?: Date;
  quotaWeekUsed?: number;
  quotaMonthStart?: Date;
  quotaMonthUsed?: number;
  lastRequestAt?: Date | null;
  lastRunAt?: Date | null;
  runLeaseExpiresAt?: Date | null;
  lastSuccessAt?: Date | null;
  lastFullSyncAt?: Date | null;
  lastLinkCheckAt?: Date | null;
  runState?: "idle" | "running" | "healthy" | "degraded" | "disabled" | string;
  circuit?: {
    failures?: number;
    openUntil?: Date | string | null;
  };
  metrics?: {
    fetched?: number;
    created?: number;
    updated?: number;
    duplicates?: number;
    errors?: number;
    deadLettered?: number;
    latencyMs?: number;
    countryCounts?: Record<string, number> | Map<string, number>;
    occupationCounts?: Record<string, number> | Map<string, number>;
  };
  deadLetters?: DeadLetterEntry[];
  lastErrorCode?: string;
}

export interface RawJobInput {
  _id?: unknown;
  id?: string;
  jobId?: string;
  sourceJobId?: string;
  sourceBoard?: string;
  canonicalUrl?: string;
  sourceUrl?: string;
  rawDescription?: string;
  requirements?: string[];
  tags?: string[];
  company?: string;
  title?: string;
  location?: string;
  employmentType?: string;
  postedAt?: Date | string | null;
  postedDateKnown?: boolean;
  contentHash?: string;
  recordHash?: string;
  identityKey?: string;
  groupKey?: string;
  sourceExpiresAt?: Date | string | null;
  expiresAt?: Date | string | null;
  repostCount?: number;
  category?: string;
  sourceCategory?: string;
  remoteType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string };
  compensation?: Record<string, unknown>;
  structuredLocation?: {
    countryCode?: string;
    region?: string;
    city?: string;
    remoteScope?: string;
    eligibleCountryCodes?: string[];
    workAuthorization?: string[];
  };
  occupationCodes?: string[];
  occupation?: string;
  occupationConfidence?: number;
  eligibility?: {
    countries?: string[];
    remoteScope?: string;
    confidence?: number;
  };
  searchTokens?: string[];
  features?: Record<string, unknown>;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  contentUpdatedAt?: Date | null;
  status?: string;
  embedding?: number[];
  embeddingMetadata?: {
    provider?: string;
    model?: string;
    dimension?: number;
  };
  provenance?: Array<{
    source?: string;
    url?: string;
    seenAt?: Date;
    attributionText?: string;
    attributionUrl?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface SearchJobsOptions {
  q?: string;
  location?: string;
  countryCode?: string;
  source?: string;
  remoteType?: string;
  occupation?: string;
  eligibility?: string;
  postedWithinDays?: number;
  minimumSalaryInr?: number | null;
  eligibilityCountryCodes?: string[];
  showAnyway?: boolean;
  excludeJobIds?: string[];
  page?: number;
  cursor?: string;
  limit?: number;
  sort?: string;
}

export interface SearchJobsResult {
  jobs: Record<string, unknown>[];
  total: number;
  totalIsApproximate?: boolean;
  catalogVersion?: number;
  facets: Record<string, unknown>;
  typoCorrections?: Record<string, unknown>;
  sort?: string;
  hasMore?: boolean;
  nextCursor?: string | null;
  page: number;
  limit: number;
  pages: number;
  sources: unknown[];
}

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
const COVERAGE_TARGETS = Object.freeze([
  {
    key: "kerala-nursing",
    label: "Kerala nursing",
    target: 100,
    filter: {
      occupation: "nursing",
      "structuredLocation.countryCode": "IN",
      $or: [{ "structuredLocation.region": /kerala/i }, { "structuredLocation.city": /kerala/i }],
    },
  },
  {
    key: "india-fresher-it",
    label: "India fresher IT",
    target: 500,
    filter: {
      occupation: "technology",
      "structuredLocation.countryCode": "IN",
      tags: { $in: ["fresher", "entry-level", "entry level", "junior"] },
    },
  },
  {
    key: "india-remote",
    label: "India remote",
    target: 500,
    filter: {
      $or: [
        { "eligibility.countries": "IN" },
        { "structuredLocation.eligibleCountryCodes": "IN" },
        { "eligibility.remoteScope": "worldwide" },
      ],
    },
  },
  {
    key: "gulf-nursing",
    label: "Gulf nursing",
    target: 100,
    filter: {
      occupation: "nursing",
      "structuredLocation.countryCode": { $in: ["AE", "SA", "QA", "KW", "BH", "OM"] },
    },
  },
  {
    key: "uk-ireland-nursing",
    label: "UK and Ireland nursing",
    target: 250,
    filter: { occupation: "nursing", "structuredLocation.countryCode": { $in: ["GB", "IE"] } },
  },
  {
    key: "india-government",
    label: "India government notices",
    target: 100,
    filter: {
      sourceBoard: { $in: ["ncs", "government-india"] },
      "structuredLocation.countryCode": "IN",
    },
  },
  {
    key: "global-remote",
    label: "Global remote",
    target: 1000,
    filter: {
      $or: [
        { remoteType: "remote" },
        { "eligibility.remoteScope": { $in: ["worldwide", "region"] } },
      ],
    },
  },
]);

export function registerJobAdapterFactory(key: string, factory: unknown): () => void {
  if (!/^[a-z0-9_-]+$/.test(key) || typeof factory !== "function")
    throw new TypeError("A valid adapter key and factory are required.");
  if (adapterFactories[key]) throw new Error(`Job source adapter already registered: ${key}`);
  adapterFactories[key] = factory;
  return () => {
    delete adapterFactories[key];
  };
}

const dayStart = (date = new Date()): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const safeRegex = (value: unknown): string =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildSourceStatusUpdate(
  status: string,
  checkedAt: Date,
  freshnessDays: number,
): Record<string, unknown> {
  if (status === "closed")
    return {
      status: "closed",
      sourceExpiresAt: checkedAt,
      expiresAt: checkedAt,
      sourceCheckedAt: checkedAt,
    };
  if (status === "active") {
    const expiresAt = new Date(checkedAt.getTime() + freshnessDays * 86400000);
    return { status: "active", sourceExpiresAt: expiresAt, expiresAt, sourceCheckedAt: checkedAt };
  }
  return {
    status: "stale",
    sourceExpiresAt: checkedAt,
    expiresAt: checkedAt,
    sourceCheckedAt: checkedAt,
  };
}

function cleanNormalizedJob(job: RawJobInput, source: JobSourceRecord): RawJobInput {
  const structuredLocation = {
    countryCode: String(job.structuredLocation?.countryCode || "")
      .toUpperCase()
      .slice(0, 2),
    region: String(job.structuredLocation?.region || "").slice(0, 120),
    city: String(job.structuredLocation?.city || "").slice(0, 120),
    remoteScope: job.structuredLocation?.remoteScope || "unknown",
    eligibleCountryCodes: (job.structuredLocation?.eligibleCountryCodes || [])
      .map((code: unknown) => String(code).toUpperCase().slice(0, 2))
      .filter(Boolean)
      .slice(0, 100),
    workAuthorization: (job.structuredLocation?.workAuthorization || []).map(String).slice(0, 20),
  };
  const normalized: RawJobInput = {
    ...job,
    sourceBoard: source.key,
    sourceJobId: String(job.sourceJobId || "").slice(0, 200),
    canonicalUrl: String(job.canonicalUrl || job.sourceUrl || "").slice(0, 2000),
    sourceUrl: String(job.sourceUrl || job.canonicalUrl || "").slice(0, 2000),
    rawDescription: String(job.rawDescription || "").slice(0, MAX_DESCRIPTION_CHARS),
    requirements: Array.isArray(job.requirements) ? job.requirements.slice(0, 60).map(String) : [],
    tags: Array.isArray(job.tags) ? job.tags.slice(0, 60).map(String) : [],
    structuredLocation,
    occupationCodes: Array.isArray(job.occupationCodes)
      ? job.occupationCodes.slice(0, 20).map(String)
      : [],
    sourceCategory: String(job.sourceCategory || job.category || "").slice(0, 160),
  };
  normalized.groupKey =
    source.adapter?.generateGroupKey?.({
      canonicalUrl: normalized.canonicalUrl,
      company: normalized.company,
      title: normalized.title,
      location: normalized.location,
      employmentType: normalized.employmentType,
      postedAt: normalized.postedAt,
    }) || "";
  const contentHash = (source.adapter || null)?.generateContentHash?.(
    normalized as Record<string, unknown>,
  );
  normalized.contentHash = contentHash || job.contentHash;
  normalized.identityKey = source.adapter
    ? source.adapter.generateIdentity({
        source: source.key,
        sourceJobId: normalized.sourceJobId,
        canonicalUrl: normalized.canonicalUrl,
        title: normalized.title,
        company: normalized.company,
        location: normalized.location,
      })
    : `${source.key}:${normalized.sourceJobId}`;
  const now = new Date();
  normalized.features = extractJobFeatures(
    normalized as Record<string, unknown>,
  ) as unknown as Record<string, unknown>;
  normalized.eligibility = parseJobEligibility({ ...normalized, ...job } as unknown as Parameters<
    typeof parseJobEligibility
  >[0]) as unknown as RawJobInput["eligibility"];
  Object.assign(normalized, classifyJobOccupation(normalized as Record<string, unknown>));
  normalized.searchTokens = buildSearchTokens(normalized as Record<string, unknown>);
  const rawPostedAt = normalized.postedAt;
  const postedAt =
    rawPostedAt instanceof Date && !Number.isNaN(rawPostedAt.getTime()) ? rawPostedAt : null;
  const rawSourceExpiresAt = job.sourceExpiresAt;
  const sourceExpiresAt =
    rawSourceExpiresAt instanceof Date && !Number.isNaN(new Date(rawSourceExpiresAt).getTime())
      ? new Date(rawSourceExpiresAt)
      : null;
  const policyExpiry = computeSourceTermExpiry({
    postedAt,
    now,
    sourceExpiresAt,
    retentionDays: source.retentionDays,
  });
  normalized.postedAt = postedAt;
  normalized.postedDateKnown = Boolean(postedAt);
  normalized.firstSeenAt = now;
  normalized.lastSeenAt = now;
  normalized.contentUpdatedAt = now;
  normalized.status = "active";
  normalized.repostCount = Number(job.repostCount) || 0;
  normalized.sourceExpiresAt = sourceExpiresAt;
  normalized.expiresAt = policyExpiry;
  const compensation = normalized.compensation as Record<string, unknown> | undefined;
  if (compensation && compensation.currency === "USD" && compensation.payPeriod === "year") {
    compensation.normalizedCurrency = "USD";
    compensation.normalizedAnnualMin = (compensation.min as number | undefined) ?? null;
    compensation.normalizedAnnualMax = (compensation.max as number | undefined) ?? null;
    compensation.normalizedAt = now;
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

function setContentHash(job: RawJobInput, adapter?: SourceAdapter) {
  if (adapter) {
    if (adapter.generateContentHash)
      job.contentHash = adapter.generateContentHash(job as Record<string, unknown>);
    if (adapter.generateRecordHash)
      job.recordHash = adapter.generateRecordHash(job as Record<string, unknown>);
  }
}

/**
 * Link only exact entity/canonical-URL groups. Similarity vectors are never used
 * for identity. A source's own ATS posting is preferred as the canonical record.
 */
export async function updateVariantGroups(groupKeys?: string[]): Promise<number> {
  if (!isMongoReady()) return 0;
  const keys = [...new Set((groupKeys || []).filter((key) => typeof key === "string" && key))];
  if (!keys.length) return 0;
  const candidates = await Job.find({
    groupKey: { $in: keys },
    status: "active",
    expiresAt: { $gt: new Date() },
  })
    .select("_id groupKey sourceBoard sourceUrl canonicalUrl firstSeenAt postedAt")
    .lean();
  const groups = new Map();
  for (const job of candidates) {
    const group = groups.get(job.groupKey) || [];
    group.push(job);
    groups.set(job.groupKey, group);
  }
  const operations = [];
  for (const group of groups.values()) {
    const priority = (job: RawJobInput) => ATS_SOURCE_PRIORITY.get(String(job.sourceBoard)) ?? 10;
    group.sort(
      (a: RawJobInput, b: RawJobInput) =>
        priority(a) - priority(b) ||
        new Date(String(b.postedAt || 0)).getTime() - new Date(String(a.postedAt || 0)).getTime() ||
        String(a.sourceBoard || "").localeCompare(String(b.sourceBoard || "")) ||
        String(a._id || "").localeCompare(String(b._id || "")),
    );
    const [canonical, ...variants] = group;
    const boundedVariants = variants.slice(0, 10).map((variant: RawJobInput) => ({
      source: variant.sourceBoard,
      url: variant.sourceUrl || variant.canonicalUrl || "",
      seenAt: variant.firstSeenAt || new Date(),
    }));
    for (const job of group) {
      const isCanonical = String(job._id) === String(canonical._id);
      operations.push({
        updateOne: {
          filter: { _id: job._id },
          update: {
            $set: {
              canonicalJobId: isCanonical ? null : canonical._id,
              variants: isCanonical ? boundedVariants : [],
            },
          },
        },
      });
    }
  }
  if (operations.length)
    await Job.bulkWrite(operations as unknown as Parameters<typeof Job.bulkWrite>[0], {
      ordered: false,
    });
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
      await JobSource.updateOne({ key: policy.key }, { $setOnInsert: policy }, { upsert: true });
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
      await JobSource.updateOne({ key: policy.key }, { $set: registryPolicy });
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

async function listSourceRecords({ enabledOnly = false } = {}): Promise<JobSourceRecord[]> {
  if (isMongoReady()) {
    await ensureSourceRecords();
    const query = enabledOnly ? { enabled: true, approved: true } : {};
    const records = (await JobSource.find(query).lean()) as unknown as JobSourceRecord[];
    return enabledOnly
      ? records.filter(
          (source) =>
            isSourcePolicyComplete(source as unknown as Partial<SourcePolicy>) &&
            isSourceActivationAllowed(source) &&
            isSourceEnabledByEnvironment(source.key),
        )
      : records;
  }
  return SOURCE_POLICIES.filter(
    (source) =>
      !enabledOnly ||
      (source.enabled &&
        source.approved &&
        isSourceActivationAllowed(source) &&
        isSourceEnabledByEnvironment(source.key)),
  ) as unknown as JobSourceRecord[];
}

export async function reserveSourceRequest(
  sourceKey: string,
  maxPerDay: { requestsPerDay?: number; limits?: Record<string, number> } | number,
): Promise<boolean> {
  if (!isMongoReady()) return true;
  if (typeof maxPerDay === "object" && maxPerDay?.limits) {
    const now = new Date();
    const minuteStart = new Date(now);
    minuteStart.setUTCSeconds(0, 0);
    const dateStart = dayStart(now);
    const weekStart = new Date(dateStart);
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const rawWindows: Array<[string, string, Date, number | undefined]> = [
      ["quotaMinuteStart", "quotaMinuteUsed", minuteStart, maxPerDay.limits.perMinute],
      [
        "quotaWindowStart",
        "quotaUsed",
        dateStart,
        maxPerDay.limits.perDay || maxPerDay.requestsPerDay,
      ],
      ["quotaWeekStart", "quotaWeekUsed", weekStart, maxPerDay.limits.perWeek],
      ["quotaMonthStart", "quotaMonthUsed", monthStart, maxPerDay.limits.perMonth],
    ];
    const windows = rawWindows.filter(
      (entry): entry is [string, string, Date, number] =>
        typeof entry[3] === "number" && Number.isFinite(entry[3]) && entry[3] > 0,
    );
    const nextUsed = ([startField, usedField, start]: [string, string, Date, number?]): Record<
      string,
      unknown
    > => ({
      $cond: [
        { $lt: [{ $ifNull: [`$${startField}`, new Date(0)] }, start] },
        1,
        { $add: [{ $ifNull: [`$${usedField}`, 0] }, 1] },
      ],
    });
    const expression = {
      $and: windows.map(([startField, usedField, start, limit]) => ({
        $lte: [nextUsed([startField, usedField, start]), Number(limit)],
      })),
    };
    const updates = Object.fromEntries(
      windows.flatMap(([startField, usedField, start]) => [
        [
          startField,
          {
            $cond: [
              { $lt: [{ $ifNull: [`$${startField}`, new Date(0)] }, start] },
              start,
              `$${startField}`,
            ],
          },
        ],
        [usedField, nextUsed([startField, usedField, start])],
      ]),
    );
    const reserved = await JobSource.findOneAndUpdate(
      { key: sourceKey, enabled: true, approved: true, $expr: expression },
      [{ $set: { ...updates, lastRequestAt: now } }],
      { new: true, projection: { quotaUsed: 1 } },
    ).lean();
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

function quotaExceeded(sourceKey: string) {
  const error = new Error(`Daily request budget reached for ${sourceKey}`) as Error & {
    code?: string;
  };
  error.code = "SOURCE_QUOTA_EXHAUSTED";
  return error;
}

async function* iterateJobs(jobs: AsyncIterable<RawJobInput> | RawJobInput[]) {
  if (jobs && typeof (jobs as AsyncIterable<RawJobInput>)[Symbol.asyncIterator] === "function") {
    yield* jobs as AsyncIterable<RawJobInput>;
    return;
  }
  if (Array.isArray(jobs)) yield* jobs;
}

async function getAggregatedDemandTerms() {
  if (!isMongoReady()) return [];
  const catalogVersion = await getCatalogVersion();
  const demandCacheKey = CacheKeys.jobDemandVersion(catalogVersion);
  const cachedTerms = await get(demandCacheKey);
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
                  in: {
                    kind: "role",
                    value: { $ifNull: ["$$role.customRoleLabel", "$$role.roleCode"] },
                  },
                },
              },
              {
                $map: {
                  input: {
                    $slice: [
                      {
                        $concatArrays: [
                          { $ifNull: ["$careerProfile.targetLocations", []] },
                          [{ $ifNull: ["$careerProfile.homeLocation", {}] }],
                        ],
                      },
                      8,
                    ],
                  },
                  as: "location",
                  in: {
                    kind: "location",
                    value: {
                      $ifNull: [
                        "$$location.cityCode",
                        { $ifNull: ["$$location.countryCode", "$$location.scope"] },
                      ],
                    },
                  },
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
  } catch (error: unknown) {
    const err = error as { code?: string };
    logger.warn(
      { errorCode: err.code || "DEMAND_AGGREGATION_FAILED" },
      "Could not refresh aggregated job demand; using broad catalog ingestion",
    );
    return [];
  }
  const resolveRole = (value: unknown): string => {
    const str = String(value || "");
    return ROLE_SUGGESTIONS.find((role) => role.code === str)?.label || str.replace(/[-_]+/g, " ");
  };
  const resolveLocation = (value: unknown): string => {
    const str = String(value || "");
    const place = PLACE_SUGGESTIONS.find((item) => item.code === str);
    if (place?.label) {
      const lbl = place.label;
      return (Array.isArray(lbl) ? lbl.join(" ") : String(lbl)).toLowerCase();
    }
    if (/^[a-z]{2}$/i.test(str)) {
      const match = PLACE_SUGGESTIONS.find((item) => item.countryCode === str.toUpperCase());
      const countryVal = match?.country || str;
      return (Array.isArray(countryVal) ? countryVal.join(" ") : String(countryVal)).toLowerCase();
    }
    if (str === "anywhere_in_india") return "india";
    return str.toLowerCase();
  };
  const roles = aggregated
    .filter((item) => item._id.kind === "role")
    .slice(0, 12)
    .map((item) => ({ ...item, _id: { ...item._id, value: resolveRole(item._id.value) } }));
  const locations = aggregated
    .filter((item) => item._id.kind === "location")
    .slice(0, 8)
    .map((item) => ({ ...item, _id: { ...item._id, value: resolveLocation(item._id.value) } }));
  const terms = [];
  for (const role of roles) {
    terms.push(role._id.value);
    for (const location of locations.slice(0, 2))
      terms.push(`${role._id.value} ${location._id.value}`.slice(0, 50));
  }
  if (!roles.length) terms.push(...locations.map((location) => location._id.value));
  const resolvedTerms = [...new Set(terms)].slice(0, 32);
  await set(demandCacheKey, resolvedTerms, 21600);
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

  async getAdapter(source: JobSourceRecord): Promise<SourceAdapter | null> {
    let adapter: SourceAdapter;
    const testOrExtensionFactory = adapterFactories[source.key];
    if (testOrExtensionFactory) {
      adapter = testOrExtensionFactory(source);
    } else if (/^[A-Za-z0-9_-]+Adapter\.js$/.test(source.adapterModule || "")) {
      const adapterModule = await import(
        new URL(`../../../external-services/jobs/adapters/${source.adapterModule}`, import.meta.url)
          .href
      );
      const Adapter = adapterModule.default;
      if (typeof Adapter !== "function") return null;
      adapter = new Adapter({ ...source.quota, key: source.key });
    } else {
      return null;
    }
    adapter.consumeQuota = async () => {
      if (
        !(await reserveSourceRequest(
          source.key,
          source.quota.limits ? source.quota : source.quota.requestsPerDay,
        ))
      )
        throw quotaExceeded(source.key);
      return true;
    };
    return adapter;
  },

  async getAdapters(): Promise<SourceAdapter[]> {
    const sources = await listSourceRecords({ enabledOnly: true });
    return (await Promise.all(sources.map((source) => this.getAdapter(source)))).filter(
      Boolean,
    ) as SourceAdapter[];
  },

  requestShutdown() {
    requestIngestionShutdown();
  },

  resetShutdown() {
    resetIngestionShutdown();
  },

  isShuttingDown() {
    return isIngestionShuttingDown();
  },

  async ingestAll(options: Record<string, unknown> = {}) {
    const sources = await listSourceRecords({ enabledOnly: true });
    const results: Array<Record<string, unknown>> = [];
    for (const source of sources) {
      if (isIngestionShuttingDown()) {
        results.push({
          source: source.key,
          skipped: true,
          stoppedForShutdown: true,
          reason: "graceful_shutdown",
        });
        break;
      }
      try {
        const res = await this.ingestSource(source.key, options);
        results.push(res);
        if (res.stoppedForShutdown) break;
      } catch (error: unknown) {
        const err = error as { code?: string };
        logger.warn(
          { source: source.key, errorCode: err.code || "SOURCE_INGESTION_FAILED" },
          "Job source ingestion failed",
        );
        results.push({
          source: source.key,
          errors: 1,
          errorCode: err.code || "SOURCE_INGESTION_FAILED",
        });
      }
    }
    return {
      ingested: results.reduce((sum, result) => sum + (Number(result.created) || 0), 0),
      embedded: results.reduce((sum, result) => sum + (Number(result.embedded) || 0), 0),
      sources: results.map((result) => result.source),
      results,
    };
  },

  async ingestSource(
    sourceKey: string,
    {
      user,
      requestId,
      onBatchComplete,
      force,
    }: {
      user?: unknown;
      requestId?: string;
      onBatchComplete?: (stats: Record<string, unknown>) => Promise<void> | void;
      force?: boolean;
    } = {},
  ) {
    if (!isMongoReady() && env.NODE_ENV === "production") {
      const error = new Error("The job source registry is unavailable.") as Error & {
        statusCode?: number;
        code?: string;
      };
      error.statusCode = 503;
      error.code = "SOURCE_REGISTRY_UNAVAILABLE";
      throw error;
    }
    const source: JobSourceRecord | null = isMongoReady()
      ? ((await JobSource.findOne({
          key: sourceKey,
          enabled: true,
          approved: true,
        }).lean()) as unknown as JobSourceRecord)
      : (SOURCE_POLICIES.find(
          (item) => item.key === sourceKey && item.enabled && item.approved,
        ) as unknown as JobSourceRecord);
    if (
      !source ||
      !isSourcePolicyComplete(source as unknown as Partial<SourcePolicy>) ||
      !isSourceActivationAllowed(source) ||
      !isSourceEnabledByEnvironment(sourceKey)
    )
      return { source: sourceKey, skipped: true, reason: "disabled_or_unapproved" };
    if (source.circuit?.openUntil && new Date(source.circuit.openUntil) > new Date()) {
      return { source: sourceKey, skipped: true, reason: "circuit_open" };
    }
    if (isIngestionShuttingDown()) {
      return {
        source: sourceKey,
        skipped: true,
        stoppedForShutdown: true,
        reason: "graceful_shutdown",
      };
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
    let deadLettered = 0;
    const newDeadLetters: DeadLetterEntry[] = [];
    let stoppedForShutdown = false;
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
        const claimFilter: Record<string, unknown> = {
          key: sourceKey,
          enabled: true,
          approved: true,
          $or: [
            { runState: { $ne: "running" } },
            { runLeaseExpiresAt: { $lte: now } },
            { runLeaseExpiresAt: null },
          ],
        };
        if (!force) {
          claimFilter.$and = [
            {
              $or: [
                { lastRunAt: null },
                { lastRunAt: { $lte: new Date(now.getTime() - source.quota.intervalMs) } },
              ],
            },
          ];
        }
        const claimed = await JobSource.findOneAndUpdate(
          claimFilter,
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
        const rawSample = (await Job.find({
          sourceBoard: sourceKey,
          status: { $in: ["active", "stale"] },
        })
          .sort({ sourceCheckedAt: 1, lastSeenAt: 1 })
          .limit(150)
          .select("sourceJobId sourceUrl canonicalUrl sourceCheckedAt lastSeenAt")
          .lean()) as unknown as RawJobInput[];
        const sample = sampleJobsForPoliteLinkCheck(rawSample, { maxTotal: 50, maxPerHost: 5 });
        if (!sample.length) {
          await JobSource.updateOne({ key: sourceKey }, { $set: { lastLinkCheckAt: new Date() } });
        } else {
          try {
            const statuses =
              (await adapter.checkStatuses?.(
                sample.map((job) => String(job.sourceJobId || "")).filter((id) => /^\d+$/.test(id)),
              )) || [];
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
                  update: {
                    $set: buildSourceStatusUpdate(item.status, checkedAt, source.retentionDays),
                  },
                },
              }));
            if (updates.length)
              await Job.bulkWrite(updates as unknown as Parameters<typeof Job.bulkWrite>[0], {
                ordered: false,
              });
            await JobSource.updateOne({ key: sourceKey }, { $set: { lastLinkCheckAt: checkedAt } });
          } catch (error: unknown) {
            const err = error as { code?: string; status?: number };
            if (err.code === "SOURCE_QUOTA_EXHAUSTED") statusCheckRequests = 1;
            else
              logger.warn(
                { source: sourceKey, errorCode: err.code || `HTTP_${err.status || "NETWORK"}` },
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
        const inactiveIds = [
          ...new Set(
            (page.inactiveIds || []).map((id) => String(id).slice(0, 200)).filter(Boolean),
          ),
        ].slice(0, 10000);
        if (inactiveIds.length && isMongoReady()) {
          const inactiveAt = new Date();
          const result = await Job.updateMany(
            { sourceBoard: sourceKey, sourceJobId: { $in: inactiveIds }, status: "active" },
            {
              $set: {
                status: "closed",
                sourceExpiresAt: inactiveAt,
                expiresAt: inactiveAt,
                sourceCheckedAt: inactiveAt,
              },
            },
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
        const processBatch = async (rawJobs: RawJobInput[]) => {
          const normalized: RawJobInput[] = [];
          for (const rawJob of rawJobs) {
            const validation = validateRawIngestJob(rawJob);
            if (!validation.valid) {
              deadLettered += 1;
              newDeadLetters.push(
                buildDeadLetterEntry({
                  sourceJobId: rawJob?.sourceJobId || rawJob?.id || "",
                  reasonCode: validation.reasonCode,
                  message: validation.message,
                }),
              );
              continue;
            }
            try {
              normalized.push(cleanNormalizedJob(rawJob, source));
            } catch (err: unknown) {
              const errObj = err as { code?: string; message?: string };
              deadLettered += 1;
              newDeadLetters.push(
                buildDeadLetterEntry({
                  sourceJobId: rawJob?.sourceJobId || rawJob?.id || "",
                  reasonCode: errObj.code || "NORMALIZATION_FAILED",
                  message: errObj.message || "Failed to normalize raw job record",
                }),
              );
            }
          }
          const seenBatch = new Set<string>();
          for (const job of normalized) {
            setContentHash(job, adapter);
            const country = String(job.structuredLocation?.countryCode || "unknown");
            const occupation =
              Array.isArray(job.occupationCodes) && job.occupationCodes.length
                ? String(job.occupationCodes[0])
                : "unmapped";
            coverageCountryCounts[country] = (coverageCountryCounts[country] || 0) + 1;
            coverageOccupationCounts[occupation] = (coverageOccupationCounts[occupation] || 0) + 1;
            if (!job.identityKey || seenBatch.has(job.identityKey)) {
              duplicates += 1;
              continue;
            }
            seenBatch.add(job.identityKey);
          }
          fetched += normalized.length;
          const uniqueJobs: RawJobInput[] = [
            ...new Map(
              normalized.filter((job) => job.identityKey).map((job) => [job.identityKey, job]),
            ).values(),
          ];
          const existingDocs: RawJobInput[] =
            isMongoReady() && uniqueJobs.length
              ? ((await Job.find({ identityKey: { $in: uniqueJobs.map((job) => job.identityKey) } })
                  .select(
                    "identityKey groupKey contentHash recordHash firstSeenAt postedAt repostCount",
                  )
                  .lean()) as unknown as RawJobInput[])
              : [];
          const groupKeys = [
            ...new Set(uniqueJobs.map((job) => job.groupKey).filter(Boolean)),
          ].slice(0, 500);
          const groupHistoryDocs: RawJobInput[] =
            isMongoReady() && groupKeys.length
              ? ((await Job.find({
                  groupKey: { $in: groupKeys },
                  identityKey: { $nin: uniqueJobs.map((job) => job.identityKey) },
                })
                  .select("groupKey firstSeenAt postedAt repostCount")
                  .sort({ firstSeenAt: -1 })
                  .limit(500)
                  .lean()) as unknown as RawJobInput[])
              : [];
          const groupHistoryByKey = new Map<string, RawJobInput>();
          for (const doc of groupHistoryDocs) {
            if (doc.groupKey && !groupHistoryByKey.has(doc.groupKey))
              groupHistoryByKey.set(doc.groupKey, doc);
          }
          if (existingDocs.length) {
            const vectors = (await JobVector.find({
              jobId: { $in: existingDocs.map((job) => job._id) },
            })
              .select("+vector jobId provider model dimension")
              .lean()) as unknown as Array<{
              jobId: unknown;
              vector: number[];
              provider?: string;
              model?: string;
              dimension?: number;
            }>;
            const vectorById = new Map(vectors.map((row) => [String(row.jobId), row]));
            for (const job of existingDocs) {
              const vector = vectorById.get(String(job._id));
              if (vector) {
                job.embedding = vector.vector;
                job.embeddingMetadata = {
                  provider: vector.provider,
                  model: vector.model,
                  dimension: vector.dimension,
                };
              }
            }
          }
          const existingByIdentity = new Map(existingDocs.map((job) => [job.identityKey, job]));
          const changed: RawJobInput[] = [];
          const unchangedOps: Array<Record<string, unknown>> = [];
          for (const job of uniqueJobs) {
            const existing = existingByIdentity.get(job.identityKey);
            if (existing?.recordHash === job.recordHash) {
              job.lastSeenAt = new Date();
              duplicates += 1;
              if (isMongoReady())
                unchangedOps.push({
                  updateOne: {
                    filter: { identityKey: job.identityKey },
                    update: { $set: { lastSeenAt: job.lastSeenAt, status: "active" } },
                  },
                });
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
            const priorDoc =
              existing || (job.groupKey ? groupHistoryByKey.get(job.groupKey) : null) || null;
            const repostSignal = detectRepostSignal(priorDoc, job);
            job.repostCount = repostSignal.repostCount;
            if (
              existing &&
              existing.contentHash === job.contentHash &&
              existing.embedding?.length
            ) {
              job.embedding = existing.embedding;
              job.embeddingMetadata = existing.embeddingMetadata;
            }
            if (job.provenance?.[0]) job.provenance[0].seenAt = new Date();
            changed.push(job);
          }

          if (isMongoReady() && unchangedOps.length) {
            for (let offset = 0; offset < unchangedOps.length; offset += BULK_WRITE_BATCH_SIZE) {
              await Job.bulkWrite(
                unchangedOps.slice(offset, offset + BULK_WRITE_BATCH_SIZE) as unknown as Parameters<
                  typeof Job.bulkWrite
                >[0],
                {
                  ordered: false,
                },
              );
            }
          }

          if (changed.length) {
            if (env.JOB_EMBEDDINGS_ENABLED || process.env.JOB_EMBEDDINGS_ENABLED === "true") {
              const config = embeddingService.getConfig();
              const vectorsByIndex = new Map<
                number,
                {
                  vector: number[];
                  metadata: { provider?: string; model?: string; dimension?: number };
                }
              >();
              const missing: Array<{ index: number; key: string; job: RawJobInput }> = [];
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
                  String(job.contentHash || ""),
                  config.provider,
                  config.model,
                  config.dimension,
                );
                const cached = (await get(key)) as {
                  vector?: number[];
                  metadata?: { provider?: string; model?: string; dimension?: number };
                } | null;
                if (cached?.vector && cached?.metadata)
                  vectorsByIndex.set(index, { vector: cached.vector, metadata: cached.metadata });
                else missing.push({ index, key, job });
              }
              for (let offset = 0; offset < missing.length; offset += BATCH_SIZE) {
                const batch = missing.slice(offset, offset + BATCH_SIZE);
                const vectors = await embeddingService.getEmbeddingsWithMetadata(
                  batch.map(
                    ({ job }) =>
                      `${job.title} at ${job.company}. Requirements: ${(Array.isArray(job.requirements) ? job.requirements : []).join(", ")}. ${String(job.rawDescription || "").slice(0, 500)}`,
                  ),
                  {
                    feature: "match_jobs",
                    requestId:
                      (requestId as `${string}-${string}-${string}-${string}-${string}`) ||
                      undefined,
                  },
                );
                embedded += vectors.length;
                await Promise.all(
                  vectors.map((value, batchIndex) =>
                    set(batch[batchIndex].key, value, TTL.EMBEDDING),
                  ),
                );
                batch.forEach((entry, batchIndex) => {
                  const vec = vectors[batchIndex] as
                    | {
                        vector: number[];
                        metadata: { provider?: string; model?: string; dimension?: number };
                      }
                    | undefined;
                  if (vec?.vector) vectorsByIndex.set(entry.index, vec);
                });
              }
              changed.forEach((job, index) => {
                const vector = vectorsByIndex.get(index);
                if (vector) {
                  job.embedding = vector.vector;
                  job.embeddingMetadata = vector.metadata;
                }
              });
            }
            if (isMongoReady()) {
              const storageRows = changed.map((job) => ({
                job,
                ...splitJobForStorage(job as Record<string, unknown>),
              }));
              for (let offset = 0; offset < storageRows.length; offset += BULK_WRITE_BATCH_SIZE) {
                const batch = storageRows.slice(offset, offset + BULK_WRITE_BATCH_SIZE);
                await Job.bulkWrite(
                  batch.map(({ job, catalog }) => ({
                    updateOne: {
                      filter: { identityKey: job.identityKey },
                      update: { $set: catalog },
                      upsert: true,
                    },
                  })) as unknown as Parameters<typeof Job.bulkWrite>[0],
                  { ordered: false },
                );
                const identities = batch.map(({ job }) => job.identityKey);
                const persisted = await Job.find({ identityKey: { $in: identities } })
                  .select("_id identityKey")
                  .lean();
                const idByIdentity = new Map(persisted.map((row) => [row.identityKey, row._id]));
                const detailOps = batch
                  .map(({ job, details }) => ({
                    updateOne: {
                      filter: { jobId: idByIdentity.get(job.identityKey) },
                      update: { $set: { ...details, expiresAt: job.expiresAt } },
                      upsert: true,
                    },
                  }))
                  .filter((operation) => operation.updateOne.filter.jobId);
                if (detailOps.length)
                  await JobDetail.bulkWrite(
                    detailOps as unknown as Parameters<typeof JobDetail.bulkWrite>[0],
                    { ordered: false },
                  );
                const vectorOps = batch
                  .filter(({ vector }) => vector)
                  .map(({ job, vector }) => ({
                    updateOne: {
                      filter: { jobId: idByIdentity.get(job.identityKey) },
                      update: { $set: vector },
                      upsert: true,
                    },
                  }))
                  .filter((operation) => operation.updateOne.filter.jobId);
                if (vectorOps.length)
                  await JobVector.bulkWrite(
                    vectorOps as unknown as Parameters<typeof JobVector.bulkWrite>[0],
                    { ordered: false },
                  );
                await updateVariantGroups(
                  batch.map(({ job }) => String(job.groupKey || "")).filter(Boolean),
                );
              }
            } else {
              for (const job of changed)
                inMemoryJobs.set(job.identityKey, {
                  _id: `job_${String(job.identityKey || "").slice(0, 10)}`,
                  ...job,
                });
            }
          }
          if (typeof onBatchComplete === "function") {
            await onBatchComplete({ fetched, created, updated, duplicates, deadLettered });
          }
        };
        let rawBatch: RawJobInput[] = [];
        let inactiveBatch: string[] = [];
        let stoppedMidStream = false;
        const flushInactive = async () => {
          if (!inactiveBatch.length || !isMongoReady()) {
            inactiveBatch = [];
            return;
          }
          const inactiveAt = new Date();
          const result = await Job.updateMany(
            { sourceBoard: sourceKey, sourceJobId: { $in: inactiveBatch }, status: "active" },
            {
              $set: {
                status: "closed",
                sourceExpiresAt: inactiveAt,
                expiresAt: inactiveAt,
                sourceCheckedAt: inactiveAt,
              },
            },
          );
          updated += result.modifiedCount || 0;
          inactiveBatch = [];
        };
        const stream = page.events
          ? iterateJobs(page.events as RawJobInput[])
          : iterateJobs((page.jobs || []) as RawJobInput[]);
        for await (const item of stream) {
          if (page.events) {
            const event = item as { type?: string; sourceJobId?: string; job?: RawJobInput };
            if (event?.type === "delete") {
              const sourceJobId = String(event.sourceJobId || "").slice(0, 200);
              if (sourceJobId) inactiveBatch.push(sourceJobId);
              if (inactiveBatch.length >= BULK_WRITE_BATCH_SIZE) await flushInactive();
              if (isIngestionShuttingDown()) {
                stoppedForShutdown = true;
                stoppedMidStream = true;
                break;
              }
              continue;
            }
            if (event?.type !== "upsert" || !event.job) continue;
            rawBatch.push(event.job);
          } else {
            rawBatch.push(item as RawJobInput);
          }
          if (rawBatch.length >= BULK_WRITE_BATCH_SIZE) {
            await processBatch(rawBatch);
            rawBatch = [];
            if (isIngestionShuttingDown()) {
              stoppedForShutdown = true;
              stoppedMidStream = true;
              break;
            }
          }
        }
        if (rawBatch.length) await processBatch(rawBatch);
        await flushInactive();
        if (isIngestionShuttingDown()) {
          stoppedForShutdown = true;
        }
        if (!stoppedMidStream) {
          cursor = page.cursor || null;
        }
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
                ...(!cursor && !demandTerm && !stoppedMidStream
                  ? { lastFullSyncAt: new Date() }
                  : {}),
              },
            },
          );
        if (stoppedForShutdown) break;
        if (page.done || !cursor) fullSyncCompleted = !demandTerm;
        if (page.done || !cursor) break;
        // Internal pacing; Jobicy recommends no more than hourly sync passes.
        await sleep(1000);
      }
      const latencyMs = Date.now() - started;
      const coverage = {
        countryCounts: coverageCountryCounts,
        occupationCounts: coverageOccupationCounts,
      };
      if (isMongoReady()) {
        if (fullSyncCompleted && !stoppedForShutdown) {
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
        const metricsSet: Record<string, unknown> = {
          runState: stoppedForShutdown ? "idle" : "healthy",
          lastSuccessAt: new Date(),
          runLeaseExpiresAt: null,
          "circuit.failures": 0,
          "circuit.openUntil": null,
          lastErrorCode: "",
          "metrics.latencyMs": latencyMs,
        };
        if (newDeadLetters.length) {
          metricsSet.deadLetters = appendDeadLetters(source.deadLetters, newDeadLetters, 50);
        }
        if (fullSyncCompleted && !stoppedForShutdown) {
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
              "metrics.deadLettered": deadLettered,
            },
          },
        );
        // A completed pass can change active records, facets, and recommendations.
        await bumpCatalogVersion();
      }
      const sourceDoc = isMongoReady()
        ? ((await JobSource.findOne({ key: sourceKey }).select("quotaUsed").lean()) as unknown as {
            quotaUsed?: number;
          } | null)
        : null;
      return {
        source: sourceKey,
        fetched,
        created,
        updated,
        duplicates,
        deadLettered,
        errors: 0,
        embedded,
        statusChecks: statusCheckRequests,
        latencyMs,
        ...(stoppedForShutdown
          ? { partial: true, stoppedForShutdown: true, reason: "graceful_shutdown" }
          : {}),
        quotaUsed: isMongoReady() ? sourceDoc?.quotaUsed : fetched,
      };
    } catch (error: unknown) {
      const latencyMs = Date.now() - started;
      const err = error as { code?: string; status?: number; message?: string };
      if (sourceKey === "jobicy" && cursor && err.status === 400 && isMongoReady()) {
        await JobSource.updateOne(
          { key: sourceKey },
          { $set: { cursor: null, demandTerm: null, lastFullSyncAt: null } },
        );
      }
      if (err.code === "SOURCE_QUOTA_EXHAUSTED") {
        if (isMongoReady())
          await JobSource.updateOne(
            { key: sourceKey },
            {
              $set: {
                runState: "healthy",
                runLeaseExpiresAt: null,
                "metrics.latencyMs": latencyMs,
                ...(newDeadLetters.length
                  ? { deadLetters: appendDeadLetters(source.deadLetters, newDeadLetters, 50) }
                  : {}),
              },
              ...(deadLettered ? { $inc: { "metrics.deadLettered": deadLettered } } : {}),
            },
          );
        return {
          source: sourceKey,
          fetched,
          created,
          updated,
          duplicates,
          deadLettered,
          errors: 0,
          embedded,
          partial: true,
          reason: "daily_quota_reached",
          latencyMs,
        };
      }
      if (isMongoReady()) {
        const errorCode = err.code || `HTTP_${err.status || "NETWORK"}`;
        const runDeadLetters = [
          ...newDeadLetters,
          buildDeadLetterEntry({
            sourceJobId: cursor || "__sync__",
            reasonCode: errorCode,
            message: err.message || "Source ingestion run failed",
          }),
        ];
        await JobSource.updateOne(
          { key: sourceKey },
          {
            $inc: {
              "circuit.failures": 1,
              "metrics.errors": 1,
              "metrics.deadLettered": deadLettered + 1,
            },
            $set: {
              runState: "degraded",
              runLeaseExpiresAt: null,
              lastErrorCode: errorCode,
              "metrics.latencyMs": latencyMs,
              deadLetters: appendDeadLetters(source.deadLetters, runDeadLetters, 50),
            },
          },
        );
        const state = (await JobSource.findOne({ key: sourceKey })
          .select("circuit.failures")
          .lean()) as unknown as { circuit?: { failures?: number } } | null;
        const openUntil = computeCircuitOpenUntil(state?.circuit?.failures || 0);
        if (openUntil) {
          await JobSource.updateOne(
            { key: sourceKey },
            { $set: { "circuit.openUntil": openUntil } },
          );
        }
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

  async getCandidateJobs({
    profile,
    limit = MAX_CANDIDATES,
    excludeJobIds = [],
  }: {
    profile?: Record<string, unknown> | null;
    limit?: number;
    excludeJobIds?: string[];
  } = {}) {
    const safeLimit = Math.min(MAX_CANDIDATES, Math.max(1, Number(limit) || MAX_CANDIDATES));
    const now = new Date();
    const preferences = (profile?.preferences as Record<string, unknown> | undefined) || {};
    const filter: Record<string, unknown> = { status: "active", expiresAt: { $gt: now } };
    const sources = await listSourceRecords({ enabledOnly: true });
    const enabledKeys = sources.map((source) => source.key);
    if (!enabledKeys.length) return [];
    filter.sourceBoard = { $in: enabledKeys };
    const remotePref = preferences.remotePreference as string | undefined;
    if (remotePref && ["remote", "hybrid", "onsite"].includes(remotePref))
      filter.remoteType = remotePref;
    const prefCountryCodes = (preferences.preferredCountryCodes as string[] | undefined) || [];
    const countryCodes = [
      ...new Set([
        ...profileApplicantCountries(profile || {}),
        ...prefCountryCodes.map((code) => String(code).toUpperCase()),
      ]),
    ].filter((code) => /^[A-Z]{2}$/.test(code));
    if (countryCodes.length) {
      const matchingRegions = countryCodes.some((code) =>
        ["GB", "IE", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "FI", "PL"].includes(code),
      )
        ? ["EU"]
        : [];
      if (
        countryCodes.some((code) =>
          ["IN", "CN", "JP", "SG", "AU", "NZ", "KR", "TH", "ID", "MY", "PH", "VN"].includes(code),
        )
      )
        matchingRegions.push("APAC");
      filter.$or = [
        { "structuredLocation.countryCode": { $in: countryCodes } },
        { "structuredLocation.eligibleCountryCodes": { $in: countryCodes } },
        { "eligibility.countries": { $in: countryCodes } },
        { "structuredLocation.remoteScope": "worldwide" },
        { "structuredLocation.remoteScope": "unknown" },
        { "eligibility.remoteScope": "worldwide" },
        { "eligibility.remoteScope": "unknown" },
        ...(matchingRegions.length
          ? [{ "eligibility.remoteScope": { $in: matchingRegions } }]
          : []),
      ];
    }
    const occupationCodes = ((preferences.occupationCodes as string[] | undefined) || []).slice(
      0,
      20,
    );
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
      const careerProfile = profile?.careerProfile as Record<string, unknown> | undefined;
      const targetRoles =
        (careerProfile?.targetRoles as
          Array<{ customRoleLabel?: string; roleCode?: string }> | undefined) || [];
      const roles = (profile?.roles as Array<{ title?: string }> | undefined) || [];
      const skills = (profile?.skills as Array<{ name?: string }> | undefined) || [];
      const prefTargetRoles = (preferences.targetRoles as string[] | undefined) || [];
      const roleTerms = [
        ...prefTargetRoles,
        ...targetRoles.map(
          (role) => role.customRoleLabel || String(role.roleCode || "").replace(/[-_]+/g, " "),
        ),
        ...roles.map((role) => role.title || ""),
      ];
      const lexicalTerms = [
        ...new Set(
          [
            ...skills.map((skill) => canonicalSkill(skill.name)),
            ...roleTerms.flatMap((role) =>
              String(normalizeRoleForMatching(role))
                .toLowerCase()
                .split(/[^\p{L}\p{N}.+#]+/u),
            ),
          ].filter((term): term is string => Boolean(term && term.length > 1)),
        ),
      ].slice(0, 64);
      const safeSelect =
        "title company location remoteType salaryRange compensation tags sourceBoard sourceUrl canonicalUrl sourceJobId postedAt postedDateKnown firstSeenAt lastSeenAt sourceCheckedAt sourceExpiresAt expiresAt status repostCount structuredLocation eligibility occupationCodes occupation occupationConfidence contentHash features featuresVersion";
      const recentFallbackSelect =
        "title company location remoteType salaryRange compensation tags sourceBoard sourceUrl canonicalUrl sourceJobId postedAt postedDateKnown firstSeenAt lastSeenAt sourceCheckedAt sourceExpiresAt expiresAt status repostCount structuredLocation eligibility occupation occupationConfidence occupationCodes contentHash features featuresVersion";
      const base: Record<string, unknown> = { ...filter };
      const existingAnd = Array.isArray(base.$and) ? (base.$and as unknown[]) : [];
      delete base.$and;
      const existingOr = base.$or as unknown[] | undefined;
      delete base.$or;
      const commonAnd: unknown[] = [...existingAnd, ...(existingOr ? [{ $or: existingOr }] : [])];
      const recentQuery: Record<string, unknown> = {
        ...base,
        ...(commonAnd.length ? { $and: commonAnd } : {}),
      };
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
          [
            ...prefTargetRoles,
            ...targetRoles.map(
              (role) => role.customRoleLabel || String(role.roleCode || "").replace(/[-_]+/g, " "),
            ),
            ...roles.map((role) => role.title || ""),
          ]
            .flatMap((role) =>
              String(normalizeRoleForMatching(role))
                .toLowerCase()
                .split(/[^\p{L}\p{N}.+#]+/u),
            )
            .filter((term) => term.length > 1),
        ),
      ].slice(0, 32);
      const occupationTerms = ((preferences.occupationCodes as string[] | undefined) || []).slice(
        0,
        20,
      );
      const skillTerms = [
        ...new Set(
          skills.map((skill) => canonicalSkill(skill.name)).filter((s): s is string => Boolean(s)),
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
          } as FilterQuery<Record<string, unknown>>)
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
          } as FilterQuery<Record<string, unknown>>)
            .limit(lexicalFetchLimit)
            .select(safeSelect)
            .lean(),
        );
      }
      const lexicalBatches = (await Promise.all(lexicalQueries)) as Array<
        Array<Record<string, unknown>>
      >;
      const lexicalPool = new Map<string, Record<string, unknown>>(
        lexicalBatches.flat().map((job) => [String(job._id), job]),
      );
      const relevance = (job: Record<string, unknown>) => {
        const features = (job.features as Record<string, unknown> | undefined) || {};
        const titleTokens = new Set((features.titleTokens as string[] | undefined) || []);
        const skillsSet = new Set((features.skills as string[] | undefined) || []);
        const tags = new Set((job.tags as string[] | undefined) || []);
        const requirements = new Set((job.requirements as string[] | undefined) || []);
        return (
          normalizedRoleTerms.filter((term) => titleTokens.has(term)).length * 4 +
          skillTerms.filter((term) => skillsSet.has(term)).length * 2 +
          lexicalTerms.filter((term) => tags.has(term) || requirements.has(term)).length
        );
      };
      const lexical = [...lexicalPool.values()]
        .map((job) => ({ job, score: relevance(job) }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            Number(b.job.postedDateKnown ? 1 : 0) - Number(a.job.postedDateKnown ? 1 : 0) ||
            Number(new Date(String(b.job.postedAt || 0)).getTime()) -
              Number(new Date(String(a.job.postedAt || 0)).getTime()) ||
            String(a.job._id).localeCompare(String(b.job._id)),
        )
        .slice(0, safeLimit)
        .map(({ job }) => job);
      const remaining = Math.max(0, safeLimit - lexical.length);
      const recentFallbackLimit = Math.min(remaining, env.JOBS_RECENT_FALLBACK_LIMIT);
      const recent = recentFallbackLimit
        ? ((await Job.find({
            ...recentQuery,
            ...(lexical.length
              ? {
                  _id: {
                    ...((recentQuery._id as Record<string, unknown>) || {}),
                    $nin: lexical.map((job) => job._id),
                  },
                }
              : {}),
          })
            .sort({ postedAt: -1, _id: 1 })
            .limit(recentFallbackLimit)
            .select(recentFallbackSelect)
            .lean()) as Array<Record<string, unknown>>)
        : [];
      const combined = new Map<string, Record<string, unknown>>(
        lexical.map((job) => [String(job._id), job]),
      );
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
          !job.structuredLocation.eligibleCountryCodes?.some((code: string) =>
            countryCodes.includes(code),
          ) &&
          job.structuredLocation.remoteScope !== "worldwide"
        )
          return false;
        return true;
      })
      .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
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
    sort = "",
  }: SearchJobsOptions = {}): Promise<SearchJobsResult> {
    const sources = await listSourceRecords({ enabledOnly: true });
    const enabledKeys = sources.map((item) => item.key);
    if (!enabledKeys.length)
      return {
        jobs: [],
        total: 0,
        page,
        limit,
        pages: 0,
        sources: [],
        facets: { occupations: [], remoteTypes: [], countries: [] },
      };
    const filter: Record<string, unknown> = {
      sourceBoard: { $in: enabledKeys },
      status: "active",
      expiresAt: { $gt: new Date() },
    };
    const querySpec = q ? expandQueryTokensWithTypos(q) : null;
    if (querySpec?.tokenGroups?.length) {
      filter.$and = querySpec.tokenGroups.map((group) => ({
        $or: [
          { searchTokens: { $in: group.all } },
          { "features.titleTokens": { $in: group.all } },
          { "features.companyTokens": { $in: group.all } },
          { "features.skills": { $in: group.all } },
        ],
      }));
    }
    if (location) filter.location = new RegExp(safeRegex(location), "i");
    if (occupation && /^[a-z0-9-]{2,60}$/i.test(occupation))
      filter.occupation = occupation.toLowerCase();
    if (Number(postedWithinDays) > 0)
      filter.postedAt = { $gte: new Date(Date.now() - Number(postedWithinDays) * 86400000) };
    if (eligibility === "unknown") filter["eligibility.confidence"] = { $lte: 0.35 };
    if (eligibility === "eligible" && eligibilityCountryCodes.length) {
      const codes = eligibilityCountryCodes
        .map((code) => String(code).toUpperCase())
        .filter((code) => /^[A-Z]{2}$/.test(code));
      filter.$and = [
        ...((filter.$and as unknown[]) || []),
        {
          $or: [
            { "eligibility.countries": { $in: codes } },
            { "structuredLocation.eligibleCountryCodes": { $in: codes } },
            { "structuredLocation.countryCode": { $in: codes } },
            { "structuredLocation.remoteScope": "worldwide" },
          ],
        },
      ];
    }
    if (/^[A-Za-z]{2}$/.test(countryCode))
      filter["structuredLocation.countryCode"] = countryCode.toUpperCase();
    if (source) {
      const requestedSource = String(source).toLowerCase();
      if (!enabledKeys.includes(requestedSource))
        return {
          jobs: [],
          total: 0,
          page,
          limit,
          pages: 0,
          sources: await this.publicSources(),
          facets: { occupations: [], remoteTypes: [], countries: [] },
        };
      filter.sourceBoard = requestedSource;
    }
    if (["remote", "hybrid", "onsite"].includes(remoteType)) filter.remoteType = remoteType;
    const minimumInr = Number(minimumSalaryInr);
    if (Number.isFinite(minimumInr) && minimumInr > 0) {
      const rate = await latestReferenceRates().catch(() => null);
      const comparable = [];
      for (const currency of ["INR", "USD", "EUR", "GBP", "CAD", "AUD", "AED", "SAR"]) {
        const requiredAnnual =
          currency === "INR"
            ? minimumInr
            : rate
              ? convertAmount(minimumInr, "INR", currency, rate.ratesPerEur)
              : null;
        if (!requiredAnnual) continue;
        comparable.push({
          "compensation.currency": currency,
          "compensation.payPeriod": "year",
          "compensation.max": { $gte: requiredAnnual },
        });
        comparable.push({
          "compensation.currency": currency,
          "compensation.payPeriod": "month",
          "compensation.max": { $gte: requiredAnnual / 12 },
        });
        comparable.push({
          "compensation.normalizedCurrency": currency,
          "compensation.normalizedAnnualMax": { $gte: requiredAnnual },
        });
      }
      // Incomparable pay (hourly, contract, unknown, or undisclosed) remains visible.
      const incomparable = [
        { "compensation.payPeriod": { $in: ["hour", "day", "contract", "unknown", null] } },
        { compensation: { $exists: false } },
        { "compensation.max": null },
        { "compensation.max": { $lte: 0 } },
      ];
      filter.$and = [
        ...((filter.$and as unknown[]) || []),
        { $or: [...comparable, ...incomparable] },
      ];
    }
    if (excludeJobIds.length) filter._id = { $nin: excludeJobIds };
    const applicantCountries = eligibilityCountryCodes
      .map((code) => String(code).toUpperCase())
      .filter((code) => /^[A-Z]{2}$/.test(code));
    if (applicantCountries.length && !showAnyway) {
      const regionCodes = {
        EU: ["GB", "IE", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "FI", "PL"],
        APAC: ["IN", "CN", "JP", "SG", "AU", "NZ", "KR", "TH", "ID", "MY", "PH", "VN"],
      };
      const matchingRegions = Object.entries(regionCodes)
        .filter(([, countries]) => applicantCountries.some((code) => countries.includes(code)))
        .map(([region]) => region);
      const explicitMismatch = {
        $or: [
          { "eligibility.countries": { $exists: true, $ne: [], $nin: applicantCountries } },
          {
            "eligibility.countries": { $exists: false },
            "structuredLocation.countryCode": { $exists: true, $ne: "", $nin: applicantCountries },
            "structuredLocation.remoteScope": { $nin: ["worldwide", "unknown"] },
          },
          ...(matchingRegions.includes("EU") ? [] : [{ "eligibility.remoteScope": "EU" }]),
          ...(matchingRegions.includes("APAC") ? [] : [{ "eligibility.remoteScope": "APAC" }]),
        ],
      };
      filter.$nor = [...((filter.$nor as unknown[]) || []), explicitMismatch];
    }
    if (isMongoReady()) {
      const cursorData = decodeCatalogCursor(cursor);
      const useRelevanceSort =
        cursorData?.sort === "relevance" ||
        (sort === "relevance" && Boolean(querySpec?.tokenGroups?.length)) ||
        (!sort && Boolean(querySpec?.tokenGroups?.length) && cursorData?.sort !== "recent");

      let jobs: Array<Record<string, unknown>> = [];
      let hasMore = false;
      let nextCursor: string | null = null;

      if (useRelevanceSort) {
        const asOfDay =
          cursorData?.asOfDay ||
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
        const candidateWindow = Math.min(1000, Math.max(500, limit * 20));
        const candidates = (await Job.find(filter)
          .sort({ postedAt: -1, _id: 1 })
          .limit(candidateWindow)
          .select("-embedding -rawPayload -rawDescription -requirements")
          .lean()) as Array<Record<string, unknown>>;
        const scored = candidates
          .map((job) => ({
            ...job,
            ...scoreCatalogSearchRelevance(job, querySpec, asOfDay),
          }))
          .sort(compareJobsByRelevance);
        const afterCursor = cursorData
          ? scored.filter((job) => isAfterRelevanceCursor(job, cursorData))
          : scored;
        hasMore = afterCursor.length > limit;
        jobs = afterCursor.slice(0, limit);
        const last = jobs.at(-1);
        nextCursor =
          hasMore && last
            ? encodeCatalogCursor({
                id: String(last._id),
                postedAt: last.postedAt ? new Date(String(last.postedAt)).toISOString() : null,
                relevanceScore: last.relevanceScore as number,
                asOfDay,
                sort: "relevance",
              })
            : null;
      } else {
        const cursorFilter = cursorData
          ? {
              $or: cursorData.postedAt
                ? [
                    { postedAt: { $lt: new Date(cursorData.postedAt) } },
                    { postedAt: null, _id: { $gt: cursorData.id } },
                    { postedAt: new Date(cursorData.postedAt), _id: { $gt: cursorData.id } },
                  ]
                : [{ postedAt: null, _id: { $gt: cursorData.id } }],
            }
          : null;
        const query = cursorFilter ? { $and: [filter, cursorFilter] } : filter;
        const fetchedJobs = (await Job.find(query)
          .sort({ postedAt: -1, _id: 1 })
          .limit(limit + 1)
          .select("-embedding -rawPayload -rawDescription -requirements")
          .lean()) as Array<Record<string, unknown>>;
        hasMore = fetchedJobs.length > limit;
        jobs = fetchedJobs.slice(0, limit);
        const last = jobs.at(-1);
        nextCursor =
          hasMore && last
            ? encodeCatalogCursor({
                id: String(last._id),
                postedAt: last.postedAt ? new Date(String(last.postedAt)).toISOString() : null,
              })
            : null;
      }

      const catalogVersion = await getCatalogVersion();
      const sourcesSig = [...enabledKeys].sort().join(",");
      const totalCacheKey = CacheKeys.catalogTotal(catalogVersion, sourcesSig);
      let cachedTotal = await get(totalCacheKey);
      let totalIsApproximate = true;
      if (typeof cachedTotal !== "number" || cachedTotal < jobs.length) {
        const countResult = await Job.countDocuments({
          sourceBoard: { $in: enabledKeys },
          status: "active",
          expiresAt: { $gt: new Date() },
        })
          .then((count) => ({ count, approximate: false }))
          .catch(() => ({ count: jobs.length + Number(hasMore), approximate: true }));
        cachedTotal = countResult.count;
        totalIsApproximate = countResult.approximate;
        await set(totalCacheKey, cachedTotal, TTL.SHORT);
      }

      const facetsCacheKey = CacheKeys.catalogFacets(catalogVersion, sourcesSig);
      let facets = await get(facetsCacheKey);
      if (!facets) {
        const baseMatch = {
          sourceBoard: { $in: enabledKeys },
          status: "active",
          expiresAt: { $gt: new Date() },
        };
        const [occupations, remoteTypes, countries] = await Promise.all([
          Job.aggregate([
            { $match: baseMatch },
            { $group: { _id: { $ifNull: ["$occupation", "unclassified"] }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 20 },
          ])
            .option({ maxTimeMS: 1000 })
            .catch(() => []),
          Job.aggregate([
            { $match: baseMatch },
            { $group: { _id: { $ifNull: ["$remoteType", "remote"] }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ])
            .option({ maxTimeMS: 1000 })
            .catch(() => []),
          Job.aggregate([
            { $match: baseMatch },
            {
              $group: {
                _id: { $ifNull: ["$structuredLocation.countryCode", ""] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 20 },
          ])
            .option({ maxTimeMS: 1000 })
            .catch(() => []),
        ]);
        facets = {
          occupations: (occupations as Array<{ _id: string; count: number }>).map((row) => ({
            key: row._id || "unclassified",
            count: row.count,
          })),
          remoteTypes: (remoteTypes as Array<{ _id: string; count: number }>).map((row) => ({
            key: row._id || "remote",
            count: row.count,
          })),
          countries: (countries as Array<{ _id: string; count: number }>)
            .filter((row) => row._id)
            .map((row) => ({ key: row._id, count: row.count })),
        };
        await set(facetsCacheKey, facets, TTL.SHORT);
      }

      return {
        jobs: jobs.map((job) => {
          const postedAtMs = job.postedAt ? new Date(String(job.postedAt)).getTime() : 0;
          const createdAtMs = job.createdAt ? new Date(String(job.createdAt)).getTime() : 0;
          return {
            ...job,
            postedDateKnown:
              (job.postedDateKnown as boolean | undefined) ??
              (postedAtMs && createdAtMs ? Math.abs(postedAtMs - createdAtMs) > 5 * 60_000 : false),
            jobId: String(job._id),
          };
        }),
        total: Number(cachedTotal),
        totalIsApproximate,
        catalogVersion: typeof catalogVersion === "number" ? catalogVersion : 1,
        facets: (facets as Record<string, unknown>) || {},
        typoCorrections: querySpec?.typoCorrections || {},
        sort: useRelevanceSort ? "relevance" : "recent",
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
        if (querySpec?.tokenGroups?.length) {
          const hay = [
            job.title,
            job.company,
            ...(job.searchTokens || []),
            ...(job.tags || []),
            ...(job.requirements || []),
          ]
            .join(" ")
            .toLowerCase();
          if (!querySpec.tokenGroups.every((group) => group.all.some((term) => hay.includes(term))))
            return false;
        }
        if (location && !(job.location || "").toLowerCase().includes(location.toLowerCase()))
          return false;
        if (countryCode && job.structuredLocation?.countryCode !== countryCode.toUpperCase())
          return false;
        if (source && job.sourceBoard?.toLowerCase() !== source.toLowerCase()) return false;
        if (remoteType && job.remoteType !== remoteType) return false;
        if (applicantCountries.length && !showAnyway) {
          const countries =
            job.eligibility?.countries || job.structuredLocation?.eligibleCountryCodes || [];
          const country = job.structuredLocation?.countryCode;
          const scope =
            job.eligibility?.remoteScope || job.structuredLocation?.remoteScope || "unknown";
          const matchesRegion =
            (scope === "EU" &&
              applicantCountries.some((code: string) =>
                ["GB", "IE", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "FI", "PL"].includes(code),
              )) ||
            (scope === "APAC" &&
              applicantCountries.some((code: string) =>
                ["IN", "CN", "JP", "SG", "AU", "NZ", "KR", "TH", "ID", "MY", "PH", "VN"].includes(
                  code,
                ),
              ));
          if (
            scope !== "worldwide" &&
            !matchesRegion &&
            ((countries.length &&
              !countries.some((code: string) => applicantCountries.includes(code))) ||
              (country && scope !== "unknown" && !applicantCountries.includes(country)))
          )
            return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          Number(Boolean(a.postedDateKnown ? 1 : 0)) - Number(Boolean(b.postedDateKnown ? 1 : 0)) ||
          Number(new Date(b.postedAt || 0).getTime()) - Number(new Date(a.postedAt || 0).getTime()),
      );
    return {
      jobs: jobs
        .slice((page - 1) * limit, page * limit)
        .map(
          ({
            embedding: _embedding,
            rawDescription: _rawDescription,
            requirements: _requirements,
            ...job
          }) => ({
            ...job,
            jobId: String(job._id || job.identityKey),
          }),
        ),
      total: jobs.length,
      page,
      limit,
      pages: Math.ceil(jobs.length / limit),
      totalIsApproximate: false,
      facets: { occupations: [], remoteTypes: [], countries: [] },
      typoCorrections: querySpec?.typoCorrections || {},
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
    let worker: { status: string; online: boolean; lastSeenAt: Date | null } = {
      status: "offline",
      online: false,
      lastSeenAt: null,
    };
    if (isRedisReady()) {
      try {
        const redis = getRedisClient();
        const [heartbeat, lastSeenAt] = await Promise.all([
          redis.get("jobscout:worker:heartbeat"),
          redis.get("jobscout:worker:last-seen"),
        ]);
        const online = Boolean(heartbeat);
        worker = {
          status: online ? "online" : "offline",
          online,
          lastSeenAt: lastSeenAt ? new Date(lastSeenAt) : null,
        };
      } catch {
        /* worker status remains unknown/offline when Redis is unavailable */
      }
    }
    return records.map((source) => {
      const effectiveEnabled = Boolean(
        source.enabled &&
        source.approved &&
        isSourcePolicyComplete(source) &&
        isSourceEnabledByEnvironment(source.key) &&
        isSourceActivationAllowed(source),
      );
      const effectiveQuotaUsed =
        new Date(source.quotaWindowStart || 0) < dayStart() ? 0 : source.quotaUsed || 0;
      const health = evaluateSourceHealthAlerts({
        ...source,
        enabled: effectiveEnabled,
        quotaUsed: effectiveQuotaUsed,
      });
      return {
        worker,
        key: source.key,
        displayName: source.displayName,
        enabled: effectiveEnabled,
        approved: Boolean(source.approved),
        quota: source.quota,
        quotaUsed: effectiveQuotaUsed,
        quotaRemaining: Math.max(0, source.quota.requestsPerDay - effectiveQuotaUsed),
        quotaResetsAt: new Date(dayStart().getTime() + 86400000),
        runState: source.runState || "idle",
        healthStatus: health.healthStatus,
        alerts: health.alerts,
        alertThresholds: INGESTION_ALERT_THRESHOLDS,
        circuit: source.circuit || { failures: 0, openUntil: null },
        deadLetterCount: Number(source.metrics?.deadLettered ?? source.deadLetters?.length ?? 0),
        recentDeadLetters: (source.deadLetters || []).slice(-5),
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
        metrics: (source as unknown as Record<string, unknown>).metrics || {},
        attributionText: source.attributionText,
        attributionUrl: source.attributionUrl,
        termsVerifiedAt: source.termsVerifiedAt,
      };
    });
  },

  async coverageReport(
    profile: {
      careerProfile?: {
        homeLocation?: { countryCode?: string };
        targetLocations?: Array<{ countryCode?: string }>;
      };
    } | null = null,
  ) {
    if (!isMongoReady())
      return {
        totalActive: 0,
        rawActive: 0,
        byOccupation: [],
        byCountry: [],
        byRemoteScope: [],
        bySource: [],
        freshness: [],
        trustAndFreshness: {
          staleCount: 0,
          closedCount: 0,
          olderThan30dCount: 0,
          olderThan30dShare: 0,
          possibleRepostCount: 0,
          possibleRepostShare: 0,
          ghostRiskCount: 0,
          ghostRiskShare: 0,
        },
        unknownEligibilityCount: 0,
        unknownEligibilityShare: 0,
        targetLocations: [],
        targetGaps: [],
      };
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 86400000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);
    const active = { status: "active", expiresAt: { $gt: now }, canonicalJobId: null };
    const groupBy = async (field: string) =>
      Job.aggregate([
        { $match: active },
        { $group: { _id: { $ifNull: [`$${field}`, "unknown"] }, count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]).option({ maxTimeMS: 2000 });
    const [
      totalActive,
      rawActive,
      byOccupation,
      byCountry,
      byRemoteScope,
      bySource,
      unknownEligibilityCount,
      byOccupationCountry,
      unclassifiedBySource,
      freshness,
      staleCount,
      closedCount,
      olderThan30dCount,
      possibleRepostCount,
      ghostRiskCount,
    ] = await Promise.all([
      Job.countDocuments(active),
      Job.countDocuments({ status: "active", expiresAt: { $gt: now } }),
      groupBy("occupation"),
      groupBy("structuredLocation.countryCode"),
      groupBy("eligibility.remoteScope"),
      groupBy("sourceBoard"),
      Job.countDocuments({
        ...active,
        $or: [
          { eligibility: { $exists: false } },
          { "eligibility.remoteScope": "unknown" },
          { "eligibility.confidence": { $lt: 0.5 } },
        ],
      }),
      Job.aggregate([
        { $match: active },
        {
          $group: {
            _id: {
              occupation: { $ifNull: ["$occupation", "unclassified"] },
              country: { $ifNull: ["$structuredLocation.countryCode", "unknown"] },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, "_id.occupation": 1 } },
      ]).option({ maxTimeMS: 2000 }),
      Job.aggregate([
        { $match: active },
        {
          $group: {
            _id: "$sourceBoard",
            total: { $sum: 1 },
            unclassified: {
              $sum: {
                $cond: [
                  { $eq: [{ $ifNull: ["$occupation", "unclassified"] }, "unclassified"] },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]).option({ maxTimeMS: 2000 }),
      profile
        ? Promise.resolve([])
        : Job.aggregate([
            { $match: active },
            {
              $project: {
                lastSeenAt: 1,
                ageMs: { $subtract: [now, { $ifNull: ["$lastSeenAt", new Date(0)] }] },
              },
            },
            {
              $group: {
                _id: {
                  $switch: {
                    branches: [
                      { case: { $eq: ["$lastSeenAt", null] }, then: "unknown" },
                      { case: { $lte: ["$ageMs", 86400000] }, then: "under_24h" },
                      { case: { $lte: ["$ageMs", 7 * 86400000] }, then: "1_to_7d" },
                    ],
                    default: "over_7d",
                  },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ]).option({ maxTimeMS: 2000 }),
      Job.countDocuments({ status: "stale" }),
      Job.countDocuments({ status: "closed" }),
      Job.countDocuments({ ...active, postedAt: { $lte: thirtyDaysAgo } }),
      Job.countDocuments({
        ...active,
        $or: [
          { repostCount: { $gte: 1 } },
          {
            $expr: {
              $gte: [
                {
                  $subtract: [
                    { $ifNull: ["$postedAt", new Date(0)] },
                    { $ifNull: ["$firstSeenAt", new Date()] },
                  ],
                },
                7 * 86400000,
              ],
            },
          },
        ],
      }),
      Job.countDocuments({
        ...active,
        $or: [
          { postedAt: { $lte: fortyFiveDaysAgo } },
          { firstSeenAt: { $lte: fortyFiveDaysAgo } },
          { repostCount: { $gte: 2 } },
          {
            repostCount: { $gte: 1 },
            lastSeenAt: { $lte: fourteenDaysAgo },
          },
        ],
      }),
    ]);
    const targetGaps = profile
      ? []
      : await Promise.all(
          COVERAGE_TARGETS.map(async (target) => {
            const count = await Job.countDocuments({ ...active, ...target.filter });
            const companies = ["kerala-nursing", "gulf-nursing", "uk-ireland-nursing"].includes(
              target.key,
            )
              ? await Job.distinct("company", { ...active, ...target.filter }).then(
                  (values) => values.filter(Boolean).length,
                )
              : null;
            return {
              key: target.key,
              label: target.label,
              target: target.target,
              activeJobs: count,
              gap: Math.max(0, target.target - count),
              progress: target.target ? Number((count / target.target).toFixed(4)) : 0,
              distinctCompanies: companies,
              measurement: ["india-fresher-it", "india-remote", "global-remote"].includes(
                target.key,
              )
                ? "approximate_field_coverage"
                : "structured_field_match",
            };
          }),
        );
    const rawLocations = [
      profile?.careerProfile?.homeLocation,
      ...(profile?.careerProfile?.targetLocations || []),
    ].filter((item): item is { countryCode: string; [key: string]: unknown } =>
      Boolean(item && typeof item.countryCode === "string"),
    );
    const locations = [...new Map(rawLocations.map((item) => [item.countryCode, item])).values()];
    const targetLocations = await Promise.all(
      locations.map(async (location) => ({
        countryCode: location.countryCode,
        eligibleCount: await Job.countDocuments({
          ...active,
          $or: [
            { "eligibility.countries": location.countryCode },
            { "eligibility.remoteScope": "worldwide" },
          ],
        }),
      })),
    );
    const shareOfActive = (count: number | string | undefined) =>
      totalActive ? Number((Number(count || 0) / totalActive).toFixed(4)) : 0;
    return {
      totalActive,
      rawActive,
      byOccupation,
      byCountry,
      byRemoteScope,
      bySource,
      freshness,
      trustAndFreshness: {
        staleCount,
        closedCount,
        olderThan30dCount,
        olderThan30dShare: shareOfActive(olderThan30dCount),
        possibleRepostCount,
        possibleRepostShare: shareOfActive(possibleRepostCount),
        ghostRiskCount,
        ghostRiskShare: shareOfActive(ghostRiskCount),
      },
      unknownEligibilityCount,
      unknownEligibilityShare: shareOfActive(unknownEligibilityCount),
      byOccupationCountry,
      unclassifiedBySource: unclassifiedBySource.map((item) => ({
        ...item,
        unclassifiedShare: item.total ? Number((item.unclassified / item.total).toFixed(4)) : 0,
      })),
      targetLocations,
      targetGaps,
    };
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

  async setSourceEnabled(sourceKey: string, enabled: boolean) {
    if (!isMongoReady()) {
      const error = new Error("Job source controls require MongoDB.") as Error & {
        statusCode?: number;
        code?: string;
      };
      error.statusCode = 503;
      error.code = "SOURCE_REGISTRY_UNAVAILABLE";
      throw error;
    }
    const source = (await JobSource.findOne({ key: sourceKey }).lean()) as unknown as
      | (SourcePolicy & {
          approved?: boolean;
          key: string;
        })
      | null;
    if (enabled && !isSourceEnabledByEnvironment(sourceKey)) {
      const error = new Error(
        `Enable ${sourceKey} ingestion with its backend environment flag before turning it on in admin.`,
      ) as Error & { statusCode?: number; code?: string };
      error.statusCode = 409;
      error.code = "SOURCE_ENV_DISABLED";
      throw error;
    }
    if (
      !source ||
      !source.approved ||
      !isSourcePolicyComplete(source) ||
      !isSourceActivationAllowed(source)
    ) {
      const error = new Error(
        "This source has not passed the approved source policy gate.",
      ) as Error & {
        statusCode?: number;
        code?: string;
      };
      error.statusCode = 404;
      error.code = "SOURCE_NOT_APPROVED";
      throw error;
    }
    await JobSource.updateOne(
      { key: sourceKey },
      { $set: { enabled: Boolean(enabled), runState: enabled ? "idle" : "disabled" } },
    );
    await bumpCatalogVersion();
    return this.sourceBudgets();
  },

  async setSourceApproved(sourceKey: string, approved: boolean) {
    if (!isMongoReady()) {
      const error = new Error("Job source controls require MongoDB.") as Error & {
        statusCode?: number;
        code?: string;
      };
      error.statusCode = 503;
      error.code = "SOURCE_REGISTRY_UNAVAILABLE";
      throw error;
    }
    const source = (await JobSource.findOne({ key: sourceKey }).lean()) as unknown as
      | (SourcePolicy & {
          approved?: boolean;
          key: string;
        })
      | null;
    if (
      !source ||
      !isSourcePolicyComplete(source) ||
      (approved && !isSourceActivationAllowed(source))
    ) {
      const error = new Error(
        "This source does not have the required policy metadata.",
      ) as Error & {
        statusCode?: number;
        code?: string;
      };
      error.statusCode = 404;
      error.code = "SOURCE_POLICY_INCOMPLETE";
      throw error;
    }
    await JobSource.updateOne(
      { key: sourceKey },
      {
        $set: {
          approved: Boolean(approved),
          ...(approved ? {} : { enabled: false, runState: "disabled" }),
        },
      },
    );
    await bumpCatalogVersion();
    return this.sourceBudgets();
  },
};
