import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Job } from "../src/models/Job.js";
import { jobController } from "../src/controllers/jobController.js";
import { JobSource } from "../src/models/JobSource.js";
import { JobCatalogVersion } from "../src/models/JobCatalogVersion.js";
import { Profile } from "../src/models/Profile.js";
import { embeddingService } from "../src/services/embeddingService.js";
import { bumpCatalogVersion, getCatalogVersion } from "../src/services/jobs/catalogVersion.js";
import { del, CacheKeys, set } from "../src/shared/cache.js";
import {
  jobIngestionService,
  registerJobAdapterFactory,
  reserveSourceRequest,
  updateVariantGroups,
} from "../src/services/jobs/jobIngestionService.js";
import { BaseJobAdapter } from "../src/services/jobs/adapters/baseAdapter.js";
import { getJobRiskFlags } from "../src/services/jobs/jobRisk.js";
import { dropObsoleteUniqueContentHashIndex } from "../src/services/jobs/jobIndexes.js";
import {
  migrateJobCatalog,
  rollbackJobCatalog,
  inspectJobCatalog,
} from "../scripts/migrate-job-catalog.js";

let mongo;

before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: "8.0.8" }
      : undefined,
  });
  await mongoose.connect(mongo.getUri(), { dbName: "job-catalog-integration" });
  await Promise.all([
    Job.syncIndexes(),
    JobSource.syncIndexes(),
    JobCatalogVersion.syncIndexes(),
    Profile.syncIndexes(),
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test("catalog version advances monotonically and provides a distinct cache namespace", async () => {
  await JobCatalogVersion.deleteMany({});
  const initial = await getCatalogVersion();
  const next = await bumpCatalogVersion();
  assert.equal(next, initial + 1);
  assert.equal(await getCatalogVersion(), next);
  assert.notEqual(CacheKeys.jobDemandVersion(initial), CacheKeys.jobDemandVersion(next));
});

test("admin coverage reports deduplicated freshness and target gaps; older listings get caution flags", async () => {
  const id = new mongoose.Types.ObjectId();
  const postedAt = new Date(Date.now() - 45 * 86400000);
  const firstSeenAt = new Date(Date.now() - 2 * 86400000);
  const job = await Job.create({
    _id: id,
    contentHash: `coverage-${id}`,
    identityKey: `coverage-${id}`,
    title: "Nurse listing",
    company: "Test Hospital",
    rawDescription: "Staff nurse position",
    sourceBoard: "coverage-fixture",
    status: "active",
    expiresAt: new Date(Date.now() + 86400000),
    postedAt,
    postedDateKnown: true,
    firstSeenAt,
    lastSeenAt: new Date(),
    occupation: "nursing",
    structuredLocation: { countryCode: "IN", region: "Kerala" },
  });
  try {
    const report = await jobIngestionService.coverageReport();
    assert.ok(report.totalActive >= 1);
    assert.ok(report.freshness.some((bucket) => bucket._id === "under_24h"));
    assert.ok(
      report.targetGaps.some((item) => item.key === "kerala-nursing" && item.target === 100),
    );
    const codes = getJobRiskFlags(job).map((flag) => flag.code);
    assert.ok(codes.includes("older_listing"));
    assert.ok(codes.includes("possible_repost"));
  } finally {
    await Job.deleteOne({ _id: id });
  }
});

test("source registry refresh updates verified policy metadata without overriding operator enablement or metrics", async () => {
  await JobSource.create(
    makeSource("jobicy", {
      enabled: true,
      approved: true,
      termsUrl: "https://jobicy.com/terms-and-conditions",
      termsReference: "stale-reference",
      metrics: { fetched: 17 },
    }),
  );
  try {
    await jobIngestionService.ensureSources();
    const source = await JobSource.findOne({ key: "jobicy" }).lean();
    assert.equal(source.termsUrl, "https://jobicy.com/jobs-rss-feed");
    assert.equal(source.termsReference, "https://jobicy.com/jobs-rss-feed");
    assert.equal(source.activationStatus, "approved_api_terms_default_disabled");
    assert.equal(source.enabled, true, "operator enablement is preserved");
    assert.equal(source.approved, true, "operator approval is preserved");
    assert.equal(source.metrics.fetched, 17, "run metrics are preserved");
  } finally {
    await JobSource.deleteOne({ key: "jobicy" });
  }
});

function makeSource(key, overrides = {}) {
  return {
    key,
    displayName: key,
    adapterModule: "testAdapter.js",
    enabled: true,
    approved: true,
    termsUrl: "https://example.test/terms",
    termsReference: "https://example.test/terms",
    attributionText: key,
    attributionUrl: "https://example.test/",
    retentionRule: "Delete inactive listings after 30 days.",
    quotaPolicy: "10 requests per day.",
    retentionDays: 30,
    staleAfterDays: 14,
    quota: { requestsPerDay: 10, intervalMs: 60000, timeoutMs: 10000, maxRetries: 0 },
    termsVerifiedAt: new Date("2026-10-16T00:00:00.000Z"),
    ...overrides,
  };
}

test("Mongo quota reservation allows exactly the configured requests and no overage", async () => {
  await JobSource.create(
    makeSource("quota-test", {
      quota: { requestsPerDay: 1, intervalMs: 60000, timeoutMs: 10000, maxRetries: 0 },
    }),
  );
  try {
    assert.equal(await reserveSourceRequest("quota-test", 1), true);
    assert.equal(await reserveSourceRequest("quota-test", 1), false);
    const record = await JobSource.findOne({ key: "quota-test" }).lean();
    assert.equal(record.quotaUsed, 1);
  } finally {
    await JobSource.deleteOne({ key: "quota-test" });
  }
});

test("cross-source variant grouping prefers an ATS original and bounds alternatives", async () => {
  const groupKey = "variant-group-fixture";
  const docs = Array.from({ length: 12 }, (_, index) => ({
    contentHash: `variant-content-${index}`,
    identityKey: `variant-identity-${index}`,
    groupKey,
    title: "Registered Nurse",
    company: "Example Health",
    rawDescription: "Registered Nurse opening",
    sourceBoard: index === 6 ? "greenhouse" : `aggregator-${index}`,
    sourceUrl: `https://jobs.example.test/${index}`,
    status: "active",
    expiresAt: new Date(Date.now() + 86400000),
    postedAt: new Date("2026-10-16T00:00:00.000Z"),
  }));
  await Job.insertMany(docs);
  try {
    await updateVariantGroups([groupKey]);
    const grouped = await Job.find({ groupKey }).lean();
    const canonical = grouped.find((job) => job.sourceBoard === "greenhouse");
    assert.ok(canonical);
    assert.equal(canonical.canonicalJobId, null);
    assert.equal(canonical.variants.length, 10);
    assert.ok(
      grouped
        .filter((job) => job._id.toString() !== canonical._id.toString())
        .every((job) => job.canonicalJobId?.toString() === canonical._id.toString()),
    );
  } finally {
    await Job.deleteMany({ groupKey });
  }
});

test("Mongo source budget atomically enforces minute, day, week and month limits", async () => {
  const key = `adzuna-quota-${new mongoose.Types.ObjectId()}`;
  await JobSource.create(
    makeSource(key, {
      quota: {
        requestsPerDay: 2,
        intervalMs: 60000,
        timeoutMs: 10000,
        maxRetries: 0,
        limits: { perMinute: 1, perDay: 2, perWeek: 2, perMonth: 2 },
      },
    }),
  );
  try {
    const quota = (await JobSource.findOne({ key }).lean()).quota;
    assert.equal(await reserveSourceRequest(key, quota), true);
    assert.equal(await reserveSourceRequest(key, quota), false);
    const row = await JobSource.findOne({ key }).lean();
    assert.equal(row.quotaUsed, 1);
    assert.equal(row.quotaMinuteUsed, 1);
    assert.equal(row.quotaWeekUsed, 1);
    assert.equal(row.quotaMonthUsed, 1);
  } finally {
    await JobSource.deleteOne({ key });
  }
});

test("same content fingerprint from different sources is retained under source-specific identities", async () => {
  await Job.collection.createIndex(
    { contentHash: 1 },
    { unique: true, name: "legacy_unique_content_hash" },
  );
  assert.equal(await dropObsoleteUniqueContentHashIndex(), true);
  const sharedHash = `shared-content-${new mongoose.Types.ObjectId()}`;
  const docs = await Job.create([
    {
      contentHash: sharedHash,
      identityKey: `source-a:${sharedHash}`,
      sourceJobId: "source-a-id",
      title: "Backend Engineer",
      company: "Example",
      rawDescription: "Shared description",
      sourceBoard: "remoteok",
    },
    {
      contentHash: sharedHash,
      identityKey: `source-b:${sharedHash}`,
      sourceJobId: "source-b-id",
      title: "Backend Engineer",
      company: "Example",
      rawDescription: "Shared description",
      sourceBoard: "remotive",
    },
  ]);
  assert.equal(docs.length, 2);
  assert.equal(await dropObsoleteUniqueContentHashIndex(), false);
  await Job.deleteMany({ identityKey: { $in: docs.map((doc) => doc.identityKey) } });
});

test("demand terms are aggregated from role and location preferences without exposing user identities", async () => {
  await del(CacheKeys.jobDemand());
  const users = Array.from({ length: 3 }, () => new mongoose.Types.ObjectId());
  await Profile.insertMany(
    users.map((userId) => ({
      userId,
      preferences: { targetRoles: ["Software Engineer"], preferredLocations: ["India"] },
      careerProfile: {
        targetRoles: [{ customRoleLabel: "Staff Nurse", custom: true }],
        homeLocation: { countryCode: "IN", scope: "country" },
        targetLocations: [{ countryCode: "IN", cityCode: "in-kerala-kochi", scope: "city" }],
      },
    })),
  );
  const terms = await jobIngestionService.getDemandTerms();
  assert.ok(terms.includes("software engineer"));
  assert.ok(terms.includes("software engineer india"));
  assert.ok(terms.includes("staff nurse"));
  assert.ok(terms.includes("staff nurse kochi"));
  assert.equal(
    terms.some((term) => users.some((id) => term.includes(id.toString()))),
    false,
  );
  await Profile.deleteMany({ userId: { $in: users } });
});

test("migration report detects identities, apply preserves vectors, and rollback restores legacy hashes", async () => {
  await Job.collection.dropIndex("job_candidate_location_mode");
  const legacyLocationIndex = {
    status: 1,
    expiresAt: 1,
    "structuredLocation.countryCode": 1,
    remoteType: 1,
    postedAt: -1,
  };
  await Job.collection.createIndex(legacyLocationIndex, { name: "job_candidate_location_mode" });
  const id = new mongoose.Types.ObjectId();
  const originalHash = "legacy-hash-for-rollback";
  const vector = [0.1, 0.2, 0.3];
  await Job.collection.insertOne({
    _id: id,
    contentHash: originalHash,
    title: "Backend Engineer",
    company: "Acme",
    location: "Remote",
    rawDescription: "Build services",
    sourceBoard: "remoteok",
    sourceUrl: "https://remoteok.com/l/legacy-123",
    requirements: ["Node.js"],
    tags: ["node"],
    remoteType: "remote",
    salaryRange: { min: 0, max: 0, currency: "" },
    embedding: vector,
    postedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.deepEqual(await inspectJobCatalog(), {
    totalJobs: 1,
    identityCollisions: 0,
    sourceCounts: { remoteok: 1 },
  });
  const result = await migrateJobCatalog({ batchSize: 1 });
  assert.equal(result.totalJobs, 1);
  const migrated = await Job.findById(id).lean();
  assert.equal(migrated.sourceJobId, "legacy-123");
  assert.ok(migrated.identityKey);
  assert.deepEqual(migrated.embedding, vector);
  assert.equal(
    migrated.embeddingMetadata?.provider,
    undefined,
    "legacy vectors remain explicitly unknown",
  );
  const forwardIndex = (await Job.collection.indexes()).find(
    (index) => index.name === "job_candidate_location_mode",
  );
  assert.deepEqual(forwardIndex.key, {
    status: 1,
    "structuredLocation.countryCode": 1,
    remoteType: 1,
    expiresAt: 1,
    postedAt: -1,
  });
  const rollback = await rollbackJobCatalog({ batchSize: 1 });
  assert.equal(rollback.hashesRestored, 1);
  const restored = await Job.findById(id).lean();
  assert.equal(restored.contentHash, originalHash);
  assert.deepEqual(restored.embedding, vector);
  assert.ok(
    restored.identityKey,
    "rollback retains additive metadata for a lossless forward re-apply",
  );
  const restoredIndex = (await Job.collection.indexes()).find(
    (index) => index.name === "job_candidate_location_mode",
  );
  assert.deepEqual(
    restoredIndex.key,
    legacyLocationIndex,
    "rollback restores the previous named index definition",
  );
  await Job.deleteOne({ _id: id });
  await Job.db.collection("jobs_phase1_content_hash_backup").deleteMany({ _id: id });
  await Job.db.collection("jobs_phase1_index_backup").deleteMany({});
});

test("public catalog excludes disabled or unapproved source records", async () => {
  const key = "hidden-source";
  await JobSource.create(
    makeSource(key, { enabled: false, approved: false, adapterModule: "hiddenAdapter.js" }),
  );
  await Job.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    contentHash: "hidden-source-content-hash",
    identityKey: "hidden-source-identity-key",
    title: "Hidden role",
    company: "Unapproved",
    location: "Remote",
    rawDescription: "Must not be listed publicly",
    sourceBoard: key,
    sourceUrl: "https://example.test/hidden",
    remoteType: "remote",
    status: "active",
    postedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
  });
  // The migration rollback test intentionally disables configured sources;
  // restore this source's approved fixture state for this independent query test.
  await JobSource.updateOne({ key: "remoteok" }, { $set: { enabled: true, approved: true } });
  const result = await jobIngestionService.searchJobs({ q: "Hidden" });
  assert.equal(result.jobs.length, 0);
  assert.deepEqual(
    result.sources.map((source) => source.key),
    ["remoteok"],
  );
  await Job.deleteOne({ identityKey: "hidden-source-identity-key" });
  await JobSource.deleteOne({ key });
});

test("catalog hides explicitly ineligible jobs by default and showAnyway reveals them", async () => {
  const key = "eligibility-query-test";
  await JobSource.create(makeSource(key));
  const ids = ["us-only", "worldwide", "unknown"].map(() => new mongoose.Types.ObjectId());
  const expiresAt = new Date(Date.now() + 86400000);
  await Job.collection.insertMany([
    {
      _id: ids[0],
      identityKey: "elig-us",
      contentHash: "elig-us",
      title: "US Nurse",
      company: "A",
      location: "Remote",
      rawDescription: "US only",
      features: { titleTokens: ["us", "nurse"], companyTokens: ["a"] },
      sourceBoard: key,
      sourceUrl: "https://example.test/us",
      remoteType: "remote",
      status: "active",
      expiresAt,
      eligibility: { countries: ["US"], remoteScope: "country" },
    },
    {
      _id: ids[1],
      identityKey: "elig-world",
      contentHash: "elig-world",
      title: "Global Nurse",
      company: "B",
      location: "Remote",
      rawDescription: "Worldwide",
      features: { titleTokens: ["global", "nurse"], companyTokens: ["b"] },
      sourceBoard: key,
      sourceUrl: "https://example.test/world",
      remoteType: "remote",
      status: "active",
      expiresAt,
      eligibility: { countries: [], remoteScope: "worldwide" },
    },
    {
      _id: ids[2],
      identityKey: "elig-unknown",
      contentHash: "elig-unknown",
      title: "Unclear Nurse",
      company: "C",
      location: "Remote",
      rawDescription: "Remote",
      features: { titleTokens: ["unclear", "nurse"], companyTokens: ["c"] },
      sourceBoard: key,
      sourceUrl: "https://example.test/unknown",
      remoteType: "remote",
      status: "active",
      expiresAt,
      eligibility: { countries: [], remoteScope: "unknown" },
    },
  ]);
  try {
    const defaultResults = await jobIngestionService.searchJobs({
      q: "Nurse",
      eligibilityCountryCodes: ["IN"],
      page: 1,
      limit: 10,
    });
    assert.deepEqual(defaultResults.jobs.map((job) => job.title).sort(), [
      "Global Nurse",
      "Unclear Nurse",
    ]);
    const expanded = await jobIngestionService.searchJobs({
      q: "Nurse",
      eligibilityCountryCodes: ["IN"],
      showAnyway: true,
      page: 1,
      limit: 10,
    });
    assert.equal(expanded.jobs.length, 3);
  } finally {
    await Job.deleteMany({ _id: { $in: ids } });
    await JobSource.deleteOne({ key });
  }
});

test("source registry cursors survive a worker failure and resume without rescanning page one", async () => {
  const key = "cursor-integration";
  await JobSource.create(makeSource(key));
  const cursorArguments = [];
  let firstPass = true;
  let embeddingCalls = 0;
  const priorEmbeddingFlag = process.env.JOB_EMBEDDINGS_ENABLED;
  process.env.JOB_EMBEDDINGS_ENABLED = "true";
  const unregister = registerJobAdapterFactory(key, () => {
    const adapter = new BaseJobAdapter({
      key,
      capabilities: { paging: true, conditionalRequests: false, statusCheck: false },
    });
    adapter.fetchPage = async function fetchPage({ cursor }) {
      cursorArguments.push(cursor || null);
      await this.consumeQuota();
      if (firstPass && cursor === "resume-token") throw new Error("fixture page failure");
      if (firstPass) return { jobs: [], cursor: "resume-token", done: false };
      return {
        jobs: [
          {
            title: "Platform Engineer",
            company: "Example",
            sourceJobId: "job-1",
            canonicalUrl: "https://example.test/jobs/1",
            location: "Remote",
            rawDescription: "Build platform services",
            requirements: ["Node.js"],
            tags: [],
          },
        ],
        cursor: null,
        done: true,
      };
    };
    return adapter;
  });
  const originalEmbeddings = embeddingService.getEmbeddingsWithMetadata;
  embeddingService.getEmbeddingsWithMetadata = async (texts) => {
    embeddingCalls += 1;
    return texts.map(() => ({
      vector: [0.1, 0.2],
      metadata: { provider: "test", model: "fixture", dimension: 2 },
    }));
  };
  try {
    await assert.rejects(jobIngestionService.ingestSource(key), /fixture page failure/);
    const afterFailure = await JobSource.findOne({ key }).lean();
    assert.equal(afterFailure.cursor, "resume-token");
    firstPass = false;
    await JobSource.updateOne({ key }, { $set: { lastRunAt: new Date(0) } });
    const completed = await jobIngestionService.ingestSource(key);
    assert.equal(completed.created, 1);
    assert.equal(await Job.countDocuments({ sourceBoard: key, identityKey: { $exists: true } }), 1);
    const storedSource = await JobSource.findOne({ key }).lean();
    assert.equal(storedSource.cursor, null);
    assert.equal(storedSource.metrics.created, 1);
    await JobSource.updateOne({ key }, { $set: { lastRunAt: new Date(0) } });
    const unchanged = await jobIngestionService.ingestSource(key);
    assert.equal(unchanged.created, 0);
    assert.equal(unchanged.updated, 0);
    assert.equal(unchanged.duplicates, 1);
    assert.equal(unchanged.embedded, 0);
    assert.equal(embeddingCalls, 1, "an unchanged job reuses its stored vector");
    assert.deepEqual(cursorArguments, [null, "resume-token", "resume-token", null]);
  } finally {
    embeddingService.getEmbeddingsWithMetadata = originalEmbeddings;
    if (priorEmbeddingFlag === undefined) delete process.env.JOB_EMBEDDINGS_ENABLED;
    else process.env.JOB_EMBEDDINGS_ENABLED = priorEmbeddingFlag;
    unregister();
    await Job.deleteMany({ sourceBoard: key });
    await JobSource.deleteOne({ key });
  }
});

test("ingestion persists async iterable pages in bounded batches and applies inactive events", async () => {
  const key = "stream-batch-integration";
  await JobSource.create(makeSource(key, { lastRunAt: new Date(0), lastFullSyncAt: new Date() }));
  const expiresAt = new Date(Date.now() + 86400000);
  await Job.create({
    contentHash: "stream-closed-hash",
    identityKey: "stream-closed",
    sourceJobId: "closed-id",
    title: "Old role",
    company: "Example",
    location: "Remote",
    rawDescription: "Old",
    sourceBoard: key,
    sourceUrl: "https://example.test/closed",
    status: "active",
    expiresAt,
  });
  const unregister = registerJobAdapterFactory(key, () => {
    const adapter = new BaseJobAdapter({ key, capabilities: { paging: true } });
    adapter.fetchPage = async function fetchPage() {
      async function* jobs() {
        for (let index = 0; index < 501; index += 1) {
          yield {
            title: `Role ${index}`,
            company: "Example",
            sourceJobId: `job-${index}`,
            canonicalUrl: `https://example.test/jobs/${index}`,
            location: "Remote",
            rawDescription: "Description",
            requirements: [],
          };
        }
      }
      return { jobs: jobs(), inactiveIds: ["closed-id"], cursor: null, done: true };
    };
    return adapter;
  });
  try {
    const result = await jobIngestionService.ingestSource(key);
    assert.equal(result.created, 501);
    assert.equal(await Job.countDocuments({ sourceBoard: key, status: "active" }), 501);
    assert.equal(
      (await Job.findOne({ sourceBoard: key, sourceJobId: "closed-id" })).status,
      "closed",
    );
  } finally {
    unregister();
    await Job.deleteMany({ sourceBoard: key });
    await JobSource.deleteOne({ key });
  }
});

test("ingestion consumes mixed JobStream-style events and closes deleted ads", async () => {
  const key = "mixed-stream-events-integration";
  await JobSource.create(makeSource(key, { lastRunAt: new Date(0), lastFullSyncAt: new Date() }));
  const expiresAt = new Date(Date.now() + 86400000);
  await Job.create({
    contentHash: "stream-delete-hash",
    identityKey: "stream-delete",
    sourceJobId: "deleted-id",
    title: "Old role",
    company: "Example",
    location: "Remote",
    rawDescription: "Old",
    sourceBoard: key,
    sourceUrl: "https://example.test/deleted",
    status: "active",
    expiresAt,
  });
  const unregister = registerJobAdapterFactory(key, () => {
    const adapter = new BaseJobAdapter({ key, capabilities: { streaming: true, deletions: true } });
    adapter.fetchPage = async function fetchPage() {
      async function* events() {
        yield {
          type: "upsert",
          sourceJobId: "new-id",
          job: {
            title: "New role",
            company: "Example",
            sourceJobId: "new-id",
            canonicalUrl: "https://example.test/new",
            location: "Remote",
            rawDescription: "Description",
            requirements: [],
          },
        };
        yield { type: "delete", sourceJobId: "deleted-id", cursor: "2026-10-17T12:00:00.000Z" };
      }
      return { events: events(), cursor: "2026-10-17T12:00:00.000Z", done: true };
    };
    return adapter;
  });
  try {
    const result = await jobIngestionService.ingestSource(key);
    assert.equal(result.created, 1);
    assert.equal((await Job.findOne({ sourceBoard: key, sourceJobId: "new-id" })).status, "active");
    assert.equal(
      (await Job.findOne({ sourceBoard: key, sourceJobId: "deleted-id" })).status,
      "closed",
    );
    assert.equal(
      (await JobSource.findOne({ key })).cursor,
      "2026-10-17T12:00:00.000Z",
      "the completed event window persists its resume cursor",
    );
  } finally {
    unregister();
    await Job.deleteMany({ sourceBoard: key });
    await JobSource.deleteOne({ key });
  }
});

test("candidate query is bounded and uses the structured discovery index", async () => {
  const now = new Date();
  const result = await Job.find({
    status: "active",
    "structuredLocation.countryCode": "US",
    remoteType: "remote",
    expiresAt: { $gt: now },
  })
    .sort({ postedAt: -1, _id: 1 })
    .limit(400)
    .hint("job_candidate_location_mode")
    .explain("executionStats");
  const planText = JSON.stringify(result.queryPlanner.winningPlan);
  assert.match(planText, /IXSCAN/);
  assert.ok(result.executionStats.nReturned <= 400);
});

test("recent-first approved-source candidate retrieval can use its compound index", async () => {
  const result = await Job.find({
    sourceBoard: { $in: ["remoteok", "remotive", "jobicy"] },
    status: "active",
    expiresAt: { $gt: new Date() },
  })
    .sort({ postedAt: -1, _id: 1 })
    .limit(400)
    .hint("job_candidate_recent_feed")
    .explain("executionStats");
  const planText = JSON.stringify(result.queryPlanner.winningPlan);
  assert.match(planText, /job_candidate_recent_feed/);
  assert.match(planText, /IXSCAN/);
  assert.ok(result.executionStats.nReturned <= 400);
});

test("catalog counts bypass stale global cache entries after source policy changes", async () => {
  const priorSource = await JobSource.findOne({ key: "remoteok" }).lean();
  await JobSource.updateOne(
    { key: "remoteok" },
    { $set: makeSource("remoteok") },
    { upsert: true },
  );
  const id = new mongoose.Types.ObjectId();
  await Job.create({
    _id: id,
    contentHash: `visible-${id}`,
    identityKey: `visible-${id}`,
    title: "Visible catalog fixture",
    company: "Example",
    rawDescription: "A test job for the catalog count",
    sourceBoard: "remoteok",
    status: "active",
    expiresAt: new Date(Date.now() + 86400000),
    postedAt: new Date(),
  });
  await set("jobs:catalog:active-count:v2:remoteok", 0, 300);
  try {
    const result = await jobIngestionService.searchJobs({ limit: 10, showAnyway: true });
    assert.equal(result.jobs.length, 1);
    assert.equal(result.total, 1);
  } finally {
    await Job.deleteOne({ _id: id });
    if (priorSource) await JobSource.replaceOne({ _id: priorSource._id }, priorSource);
    else await JobSource.deleteOne({ key: "remoteok" });
    await del("jobs:catalog:active-count:v2:remoteok");
    await del("jobs:catalog:active-count:v3:remoteok");
  }
});

test("discovery graph reads the indexed catalog and contains no ingestion call", async () => {
  const graph = await readFile(
    new URL("../src/ai/graphs/discoveryGraph.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    graph,
    /getCandidateJobs\(\{ profile: matchProfile, limit: 400, excludeJobIds: hiddenJobIds \}\)/,
  );
  assert.doesNotMatch(graph, /\.ingestAll\(|\.ingestSource\(/);
});

test("job reports persist aggregate reason counts without storing reporter identity or text", async () => {
  const id = new mongoose.Types.ObjectId();
  await Job.create({
    _id: id,
    contentHash: `report-${id}`,
    identityKey: `report-${id}`,
    title: "Public job",
    company: "Example",
    rawDescription: "A public fixture",
    sourceBoard: "remoteok",
    status: "active",
  });
  const response = {
    statusCode: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
    },
  };
  await jobController.reportJob(
    { params: { id: String(id) }, body: { reason: "broken_link" }, id: "req-test" },
    response,
    assert.fail,
  );
  const stored = await Job.findById(id).lean();
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.equal(stored.reportCounts.broken_link, 1);
  assert.equal(stored.reporterId, undefined);
  assert.equal(stored.reportText, undefined);
  await Job.deleteOne({ _id: id });
});

test("catalog search supports typo tolerance, relevance cursor pagination, and catalogVersion-keyed facets", async () => {
  const key = "relevance-search-source";
  await JobSource.create(makeSource(key));
  const now = Date.now();
  const expiresAt = new Date(now + 86400000);
  const ids = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
  ];
  await Job.insertMany([
    {
      _id: ids[0],
      identityKey: "rel-1",
      contentHash: "rel-1",
      title: "Senior Software Engineer",
      company: "Alpha",
      rawDescription: "TypeScript and Node.js",
      sourceBoard: key,
      remoteType: "remote",
      occupation: "software",
      structuredLocation: { countryCode: "IN", remoteScope: "country" },
      features: {
        titleTokens: ["senior", "software", "engineer"],
        companyTokens: ["alpha"],
        skills: ["typescript", "nodejs"],
      },
      searchTokens: ["senior", "software", "engineer", "alpha", "typescript", "nodejs", "in"],
      status: "active",
      postedAt: new Date(now - 1 * 86400000),
      postedDateKnown: true,
      expiresAt,
    },
    {
      _id: ids[1],
      identityKey: "rel-2",
      contentHash: "rel-2",
      title: "Software Engineer",
      company: "Beta",
      rawDescription: "Backend role",
      sourceBoard: key,
      remoteType: "hybrid",
      occupation: "software",
      structuredLocation: { countryCode: "IN", remoteScope: "country" },
      features: {
        titleTokens: ["software", "engineer"],
        companyTokens: ["beta"],
        skills: ["javascript"],
      },
      searchTokens: ["software", "engineer", "beta", "javascript", "in"],
      status: "active",
      postedAt: new Date(now - 15 * 86400000),
      postedDateKnown: true,
      expiresAt,
    },
    {
      _id: ids[2],
      identityKey: "rel-3",
      contentHash: "rel-3",
      title: "Platform Coordinator",
      company: "Software Solutions",
      rawDescription: "Operations",
      sourceBoard: key,
      remoteType: "onsite",
      occupation: "operations",
      structuredLocation: { countryCode: "US", remoteScope: "country" },
      features: {
        titleTokens: ["platform", "coordinator"],
        companyTokens: ["software", "solutions"],
        skills: ["engineer"],
      },
      searchTokens: ["platform", "coordinator", "software", "solutions", "engineer", "us"],
      status: "active",
      postedAt: new Date(now - 25 * 86400000),
      postedDateKnown: true,
      expiresAt,
    },
  ]);
  await bumpCatalogVersion();
  try {
    const page1 = await jobIngestionService.searchJobs({
      q: "softwre enginer",
      source: key,
      showAnyway: true,
      limit: 2,
      sort: "relevance",
    });
    assert.equal(page1.typoCorrections.softwre, "software");
    assert.equal(page1.typoCorrections.enginer, "engineer");
    assert.equal(page1.jobs.length, 2);
    assert.equal(page1.jobs[0].title, "Senior Software Engineer");
    assert.equal(page1.jobs[1].title, "Software Engineer");
    assert.equal(page1.hasMore, true);
    assert.ok(page1.nextCursor);
    assert.ok(Array.isArray(page1.facets?.occupations));

    const page2 = await jobIngestionService.searchJobs({
      q: "softwre enginer",
      source: key,
      showAnyway: true,
      limit: 2,
      cursor: page1.nextCursor,
      sort: "relevance",
    });
    assert.equal(page2.jobs.length, 1);
    assert.equal(page2.jobs[0].title, "Platform Coordinator");
    assert.equal(page2.hasMore, false);
  } finally {
    await Job.deleteMany({ _id: { $in: ids } });
    await JobSource.deleteOne({ key });
    await bumpCatalogVersion();
  }
});

test("ingestion isolates dead-letter records, finishes current batch on graceful shutdown, resumes idempotently, and reports source health", async () => {
  const key = "resilience-test-source";
  await JobSource.create(makeSource(key));

  const unregister = registerJobAdapterFactory(key, () => {
    const adapter = new BaseJobAdapter({
      key,
      capabilities: { paging: true, conditionalRequests: false, statusCheck: false },
    });
    adapter.fetchPage = async function fetchPage({ cursor }) {
      await this.consumeQuota();
      if (!cursor) {
        return {
          jobs: [
            {
              sourceJobId: "valid-1",
              title: "Backend Engineer",
              company: "Resilient Co",
              location: "Remote",
              remoteType: "remote",
              rawDescription: "Node.js and MongoDB",
              requirements: ["Node.js"],
              tags: ["nodejs"],
              canonicalUrl: "https://example.test/jobs/valid-1",
              sourceUrl: "https://example.test/jobs/valid-1",
              postedAt: new Date(),
              postedDateKnown: true,
            },
            {
              sourceJobId: "bad-missing-title",
              title: "",
              company: "Resilient Co",
            },
            {
              sourceJobId: "bad-missing-company",
              title: "Orphan Role",
              company: "",
            },
          ],
          cursor: "page-2",
          done: false,
        };
      }
      return {
        jobs: [
          {
            sourceJobId: "valid-2",
            title: "Platform Engineer",
            company: "Resilient Co",
            location: "Remote",
            remoteType: "remote",
            rawDescription: "Kubernetes and Go",
            requirements: ["Kubernetes"],
            tags: ["kubernetes"],
            canonicalUrl: "https://example.test/jobs/valid-2",
            sourceUrl: "https://example.test/jobs/valid-2",
            postedAt: new Date(),
            postedDateKnown: true,
          },
        ],
        cursor: null,
        done: true,
      };
    };
    return adapter;
  });

  try {
    jobIngestionService.resetShutdown();
    const firstRun = await jobIngestionService.ingestSource(key, {
      onBatchComplete: async () => {
        jobIngestionService.requestShutdown();
      },
    });
    assert.equal(firstRun.created, 1);
    assert.equal(firstRun.deadLettered, 2);
    assert.equal(firstRun.stoppedForShutdown, true);
    assert.equal(firstRun.partial, true);

    const checkpointed = await JobSource.findOne({ key }).lean();
    assert.equal(checkpointed.cursor, "page-2");
    assert.equal(checkpointed.runState, "idle");
    assert.equal(checkpointed.deadLetters.length, 2);
    assert.equal(checkpointed.metrics.deadLettered, 2);

    jobIngestionService.resetShutdown();
    await JobSource.updateOne({ key }, { $set: { lastRunAt: new Date(0) } });
    const secondRun = await jobIngestionService.ingestSource(key);
    assert.equal(secondRun.created, 1);
    assert.equal(secondRun.stoppedForShutdown, undefined);

    const budgets = await jobIngestionService.sourceBudgets();
    const entry = budgets.find((item) => item.key === key);
    assert.ok(entry);
    assert.equal(entry.healthStatus, "healthy");
    assert.equal(entry.deadLetterCount, 2);
    assert.equal(entry.recentDeadLetters.length, 2);
    assert.ok(entry.lastSuccessAt);
    assert.equal(entry.alertThresholds.circuitFailureThreshold, 5);
  } finally {
    unregister();
    jobIngestionService.resetShutdown();
    await Job.deleteMany({ sourceBoard: key });
    await JobSource.deleteOne({ key });
  }
});
