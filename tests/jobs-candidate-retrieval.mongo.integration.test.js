import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import { JobSource } from "../src/infrastructure/database/mongoose/models/JobSourceModel.js";
import { jobIngestionService } from "../src/infrastructure/external-services/jobs/ingestion/JobIngestionEngine.js";

let mongo;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: "8.0.8" }
      : undefined,
  });
  await mongoose.connect(mongo.getUri(), { dbName: "jobs-candidate-retrieval" });
  await Promise.all([Job.syncIndexes(), JobSource.syncIndexes()]);
  await JobSource.create({
    key: "retrieval-test",
    displayName: "Retrieval test",
    adapterModule: "testAdapter.js",
    enabled: true,
    approved: true,
    termsUrl: "https://example.test/terms",
    termsReference: "https://example.test/terms",
    attributionText: "Test source",
    attributionUrl: "https://example.test/",
    retentionRule: "Delete inactive listings after 30 days.",
    quotaPolicy: "1 request per minute.",
    retentionDays: 30,
    staleAfterDays: 14,
    quota: { requestsPerDay: 1, intervalMs: 60000, timeoutMs: 10000, maxRetries: 0 },
    termsVerifiedAt: new Date(),
  });
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test("candidate lookup indexes cover skills, title, occupation, country, status and posted date", async () => {
  const indexes = await Job.collection.indexes();
  const byName = new Map(indexes.map((index) => [index.name, index.key]));
  assert.deepEqual(byName.get("job_candidate_skills_recent"), {
    status: 1,
    "features.skills": 1,
    postedAt: -1,
  });
  assert.deepEqual(byName.get("job_candidate_title_recent"), {
    status: 1,
    "features.titleTokens": 1,
    postedAt: -1,
  });
  assert.deepEqual(byName.get("job_candidate_occupation_recent"), {
    status: 1,
    occupationCodes: 1,
    postedAt: -1,
  });
  assert.deepEqual(byName.get("job_candidate_eligible_country_recent"), {
    status: 1,
    "structuredLocation.eligibleCountryCodes": 1,
    postedAt: -1,
  });
});

test("lexical retrieval retains a relevant older role ahead of 420 newer partial matches", async () => {
  const now = Date.now();
  const noisyJobs = Array.from({ length: 420 }, (_, index) => ({
    contentHash: `retrieval-noise-${index}`,
    identityKey: `retrieval-test:noise-${index}`,
    title: `Unrelated listing ${index}`,
    company: `Company ${index}`,
    sourceBoard: "retrieval-test",
    sourceJobId: `noise-${index}`,
    rawDescription: "Partial React requirement.",
    tags: ["React"],
    requirements: [],
    features: { version: 1, titleTokens: ["unrelated", "listing"], skills: ["react"] },
    status: "active",
    expiresAt: new Date(now + 86400000),
    postedAt: new Date(now - index * 1000),
    postedDateKnown: true,
  }));
  const relevant = {
    contentHash: "retrieval-relevant-older",
    identityKey: "retrieval-test:relevant-older",
    title: "Frontend Engineer",
    company: "Older relevant employer",
    sourceBoard: "retrieval-test",
    sourceJobId: "relevant-older",
    rawDescription: "Frontend engineering work with React and TypeScript.",
    tags: ["JavaScript", "React", "TypeScript"],
    requirements: ["JavaScript", "React", "TypeScript"],
    features: {
      version: 1,
      titleTokens: ["frontend", "engineer"],
      skills: ["javascript", "react", "typescript"],
    },
    status: "active",
    expiresAt: new Date(now + 86400000),
    postedAt: new Date(now - 10 * 86400000),
    postedDateKnown: true,
  };
  await Job.insertMany([...noisyJobs, relevant]);

  const profile = {
    skills: ["React", "JavaScript", "TypeScript"].map((name) => ({ name })),
    roles: [],
    preferences: { targetRoles: ["Frontend Engineer"], remotePreference: "any" },
  };
  const candidates = await jobIngestionService.getCandidateJobs({ profile, limit: 400 });
  assert.equal(candidates.length, 400);
  assert.equal(candidates[0].sourceJobId, "relevant-older");
  assert.ok(candidates.some((job) => job.sourceJobId === "relevant-older"));
  assert.deepEqual(candidates.retrievalStats, {
    activeCatalogCount: 421,
    eligibleCount: 421,
    candidateCap: 400,
    lexicalCandidateCount: 400,
  });

  const explain = await Job.find({
    status: "active",
    expiresAt: { $gt: new Date() },
    sourceBoard: "retrieval-test",
    "features.skills": { $in: ["react", "javascript", "typescript"] },
  })
    .limit(400)
    .hint("job_candidate_skills_recent")
    .select("_id")
    .explain("executionStats");
  assert.match(JSON.stringify(explain.queryPlanner.winningPlan), /job_candidate_skills_recent/);
  assert.ok(explain.executionStats.totalDocsExamined <= explain.executionStats.nReturned * 3);
});

test("recent fallback is config-capped and omits large/private payload fields", async () => {
  const now = Date.now();
  await Job.insertMany(
    Array.from({ length: 130 }, (_, index) => ({
      contentHash: `fallback-${index}`,
      identityKey: `retrieval-test:fallback-${index}`,
      title: `Unclassified role ${index}`,
      company: `Employer ${index}`,
      sourceBoard: "retrieval-test",
      sourceJobId: `fallback-${index}`,
      rawDescription: "A large description that must not be hydrated for recent filler.",
      embedding: Array(32).fill(0.25),
      status: "active",
      expiresAt: new Date(now + 86400000),
      postedAt: new Date(now - index * 1000),
      postedDateKnown: true,
    })),
  );

  const candidates = await jobIngestionService.getCandidateJobs({
    profile: { skills: [], roles: [], preferences: { targetRoles: [], remotePreference: "any" } },
    limit: 400,
  });
  assert.equal(candidates.length, 100);
  assert.equal(candidates.retrievalStats.lexicalCandidateCount, 0);
  for (const job of candidates) {
    assert.equal(Object.hasOwn(job, "rawDescription"), false);
    assert.equal(Object.hasOwn(job, "embedding"), false);
    assert.equal(Object.hasOwn(job, "rawPayload"), false);
  }
});
