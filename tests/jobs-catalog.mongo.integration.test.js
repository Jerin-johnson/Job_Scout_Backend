import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Job } from "../src/models/Job.js";
import { jobController } from "../src/controllers/jobController.js";
import { JobSource } from "../src/models/JobSource.js";
import { Profile } from "../src/models/Profile.js";
import { embeddingService } from "../src/services/embeddingService.js";
import { del, CacheKeys } from "../src/shared/cache.js";
import {
  jobIngestionService,
  registerJobAdapterFactory,
  reserveSourceRequest,
} from "../src/services/jobs/jobIngestionService.js";
import { BaseJobAdapter } from "../src/services/jobs/adapters/baseAdapter.js";
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
  await Promise.all([Job.syncIndexes(), JobSource.syncIndexes(), Profile.syncIndexes()]);
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
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

test("Mongo source budget atomically enforces minute, day, week and month limits", async () => {
  const key = `adzuna-quota-${new mongoose.Types.ObjectId()}`;
  await JobSource.create(makeSource(key, { quota: { requestsPerDay: 2, intervalMs: 60000, timeoutMs: 10000, maxRetries: 0, limits: { perMinute: 1, perDay: 2, perWeek: 2, perMonth: 2 } } }));
  try {
    const quota = (await JobSource.findOne({ key }).lean()).quota;
    assert.equal(await reserveSourceRequest(key, quota), true);
    assert.equal(await reserveSourceRequest(key, quota), false);
    const row = await JobSource.findOne({ key }).lean();
    assert.equal(row.quotaUsed, 1);
    assert.equal(row.quotaMinuteUsed, 1);
    assert.equal(row.quotaWeekUsed, 1);
    assert.equal(row.quotaMonthUsed, 1);
  } finally { await JobSource.deleteOne({ key }); }
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
      careerProfile: { targetRoles: [{ customRoleLabel: "Staff Nurse", custom: true }], homeLocation: { countryCode: "IN", scope: "country" }, targetLocations: [{ countryCode: "IN", cityCode: "in-kerala-kochi", scope: "city" }] },
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
    { _id: ids[0], identityKey: "elig-us", contentHash: "elig-us", title: "US Nurse", company: "A", location: "Remote", rawDescription: "US only", features: { titleTokens: ["us", "nurse"], companyTokens: ["a"] }, sourceBoard: key, sourceUrl: "https://example.test/us", remoteType: "remote", status: "active", expiresAt, eligibility: { countries: ["US"], remoteScope: "country" } },
    { _id: ids[1], identityKey: "elig-world", contentHash: "elig-world", title: "Global Nurse", company: "B", location: "Remote", rawDescription: "Worldwide", features: { titleTokens: ["global", "nurse"], companyTokens: ["b"] }, sourceBoard: key, sourceUrl: "https://example.test/world", remoteType: "remote", status: "active", expiresAt, eligibility: { countries: [], remoteScope: "worldwide" } },
    { _id: ids[2], identityKey: "elig-unknown", contentHash: "elig-unknown", title: "Unclear Nurse", company: "C", location: "Remote", rawDescription: "Remote", features: { titleTokens: ["unclear", "nurse"], companyTokens: ["c"] }, sourceBoard: key, sourceUrl: "https://example.test/unknown", remoteType: "remote", status: "active", expiresAt, eligibility: { countries: [], remoteScope: "unknown" } },
  ]);
  try {
    const defaultResults = await jobIngestionService.searchJobs({ q: "Nurse", eligibilityCountryCodes: ["IN"], page: 1, limit: 10 });
    assert.deepEqual(defaultResults.jobs.map((job) => job.title).sort(), ["Global Nurse", "Unclear Nurse"]);
    const expanded = await jobIngestionService.searchJobs({ q: "Nurse", eligibilityCountryCodes: ["IN"], showAnyway: true, page: 1, limit: 10 });
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

test("discovery graph reads the indexed catalog and contains no ingestion call", async () => {
  const graph = await readFile(
    new URL("../src/ai/graphs/discoveryGraph.js", import.meta.url),
    "utf8",
  );
  assert.match(graph, /getCandidateJobs\(\{ profile: matchProfile, limit: 400, excludeJobIds: hiddenJobIds \}\)/);
  assert.doesNotMatch(graph, /\.ingestAll\(|\.ingestSource\(/);
});

test("job reports persist aggregate reason counts without storing reporter identity or text", async () => {
  const id = new mongoose.Types.ObjectId();
  await Job.create({ _id: id, contentHash: `report-${id}`, identityKey: `report-${id}`, title: "Public job", company: "Example", rawDescription: "A public fixture", sourceBoard: "remoteok", status: "active" });
  const response = { statusCode: null, ended: false, status(code) { this.statusCode = code; return this; }, end() { this.ended = true; } };
  await jobController.reportJob({ params: { id: String(id) }, body: { reason: "broken_link" }, id: "req-test" }, response, assert.fail);
  const stored = await Job.findById(id).lean();
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.equal(stored.reportCounts.broken_link, 1);
  assert.equal(stored.reporterId, undefined);
  assert.equal(stored.reportText, undefined);
  await Job.deleteOne({ _id: id });
});
