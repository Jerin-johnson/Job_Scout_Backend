import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../src/models/User.js";
import { Job } from "../src/models/Job.js";
import { Match } from "../src/models/Match.js";
import { Profile } from "../src/models/Profile.js";
import { MatchRefresh } from "../src/models/MatchRefresh.js";
import { jobIngestionService } from "../src/services/jobs/jobIngestionService.js";
import { CacheKeys } from "../src/shared/cache.js";
import { profileController } from "../src/controllers/profileController.js";
import { jobController } from "../src/controllers/jobController.js";
import { persistMatchesBulk } from "../src/ai/graphs/discoveryGraph.js";
import { discoveryGraph } from "../src/ai/graphs/discoveryGraph.js";
import { embeddingService } from "../src/services/embeddingService.js";
import {
  configureMatchRefreshQueue,
  requestMatchRefresh,
} from "../src/services/matchRefreshService.js";

let mongo;
let mongoDataPath;
before(async () => {
  mongoDataPath = mkdtempSync(join(process.cwd(), ".mongo-jobs-match-test-"));
  mongo = await MongoMemoryServer.create({
    instance: { storageEngine: "wiredTiger", dbPath: mongoDataPath },
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: "8.0.8" }
      : undefined,
  });
  await mongoose.connect(mongo.getUri(), { dbName: "jobs-match-refresh-integration" });
  await Promise.all([
    User.syncIndexes(),
    Job.syncIndexes(),
    Match.syncIndexes(),
    Profile.syncIndexes(),
    MatchRefresh.syncIndexes(),
  ]);
});
after(async () => {
  configureMatchRefreshQueue(null);
  await mongoose.disconnect();
  await mongo?.stop();
  if (mongoDataPath) rmSync(mongoDataPath, { recursive: true, force: true });
});

async function makeUser() {
  return User.create({
    email: `jobs-${new mongoose.Types.ObjectId()}@example.test`,
    name: "Test",
    passwordHash: "hash",
  });
}

test("saving preferences increments profileVersion so old match cache keys cannot be reused", async () => {
  const user = await makeUser();
  const oldKey = CacheKeys.response(String(user._id), "matches", user.profileVersion);
  const response = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await profileController.updatePreferences(
    {
      user: user.toObject(),
      body: { targetRoles: ["Nurse"], preferredLocations: ["Kochi"], remotePreference: "any" },
    },
    response,
    (err) => {
      throw err;
    },
  );
  const updated = await User.findById(user._id).lean();
  assert.equal(response.statusCode, 200);
  assert.ok(updated.profileVersion > user.profileVersion);
  assert.notEqual(CacheKeys.response(String(user._id), "matches", updated.profileVersion), oldKey);
  await Promise.all([User.deleteOne({ _id: user._id }), Profile.deleteOne({ userId: user._id })]);
});

test("confirming a suggested target role changes only targetRoles and preserves the other preferences", async () => {
  const user = await makeUser();
  configureMatchRefreshQueue({ add: async () => ({ id: "role-confirmation-refresh" }) });
  await Profile.create({
    userId: user._id,
    preferences: {
      targetRoles: ["software engierer"],
      preferredLocations: ["Kerala"],
      remotePreference: "any",
      minimumSalaryUsd: 0,
    },
  });
  const response = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await profileController.confirmTargetRoles(
    { user: user.toObject(), body: { targetRoles: ["Software Engineer"] } },
    response,
    (error) => { throw error; },
  );
  const saved = await Profile.findOne({ userId: user._id }).lean();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(saved.preferences.targetRoles, ["Software Engineer"]);
  assert.deepEqual(saved.preferences.preferredLocations, ["Kerala"]);
  assert.equal(saved.preferences.remotePreference, "any");
  await Promise.all([Profile.deleteOne({ userId: user._id }), User.deleteOne({ _id: user._id })]);
});

test("refresh requests for the same user and profile version coalesce", async () => {
  const user = await makeUser();
  const added = [];
  configureMatchRefreshQueue({
    add: async (...args) => {
      added.push(args);
      return { id: args[2].jobId };
    },
  });
  const first = await requestMatchRefresh(user._id, user.profileVersion);
  const second = await requestMatchRefresh(user._id, user.profileVersion);
  assert.equal(first.status, "queued");
  assert.equal(second.attemptId, first.attemptId);
  assert.equal(added.length, 1);
  await Promise.all([
    MatchRefresh.deleteMany({ userId: user._id }),
    User.deleteOne({ _id: user._id }),
  ]);
});

test("match persistence batches a page and remains idempotent", async () => {
  const user = await makeUser();
  const job = await Job.create({
    contentHash: `bulk-${user.id}`,
    title: "Backend Engineer",
    company: "Example",
    rawDescription: "Build services",
    sourceBoard: "remoteok",
  });
  const match = {
    userId: String(user._id),
    jobId: String(job._id),
    score: 72,
    rationale: "Fixture",
    matchingSkills: ["Node.js"],
    missingSkills: [],
  };
  assert.deepEqual(await persistMatchesBulk([match]), { roundTrips: 1 });
  assert.deepEqual(await persistMatchesBulk([match]), { roundTrips: 1 });
  assert.equal(await Match.countDocuments({ userId: user._id, jobId: job._id }), 1);
  await Promise.all([
    Match.deleteMany({ userId: user._id }),
    Job.deleteOne({ _id: job._id }),
    User.deleteOne({ _id: user._id }),
  ]);
});

test("a city preference with no exact listing still returns unknown-eligibility remote jobs", async () => {
  const user = await makeUser();
  await jobIngestionService.ensureSources();
  const job = await Job.create({
    contentHash: `location-fallback-${user.id}`,
    title: "Remote Nurse",
    company: "Example",
    rawDescription: "Patient care",
    sourceBoard: "remoteok",
    location: "Remote",
    remoteType: "remote",
    status: "active",
    expiresAt: new Date(Date.now() + 86400000),
    structuredLocation: { remoteScope: "unknown", eligibleCountryCodes: [] },
  });
  const candidates = await jobIngestionService.getCandidateJobs({
    profile: {
      preferences: {
        preferredLocations: ["Kochi"],
        preferredCountryCodes: ["IN"],
        remotePreference: "any",
      },
    },
    limit: 300,
  });
  assert.ok(candidates.some((candidate) => String(candidate._id) === String(job._id)));
  const { locationTierForJob } = await import("../src/ai/graphs/discoveryGraph.js");
  assert.equal(locationTierForJob(job.toObject(), ["Kochi"], ["IN"]), 3);
  await Promise.all([Job.deleteOne({ _id: job._id }), User.deleteOne({ _id: user._id })]);
});

test("a user cannot give feedback on another user's match and receives 404", async () => {
  const [owner, other] = await Promise.all([makeUser(), makeUser()]);
  const job = await Job.create({
    contentHash: `owned-${owner.id}`,
    title: "Analyst",
    company: "Example",
    rawDescription: "Analyze data",
    sourceBoard: "remoteok",
  });
  await Match.create({ userId: owner._id, jobId: job._id, score: 55, rationale: "Test" });
  const response = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await jobController.recordFeedback(
    { user: other.toObject(), params: { id: String(job._id) }, body: { feedback: "thumbs_up" } },
    response,
    (err) => {
      throw err;
    },
  );
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error.code, "MATCH_NOT_FOUND");
  await Promise.all([
    Match.deleteMany({ jobId: job._id }),
    Job.deleteOne({ _id: job._id }),
    User.deleteMany({ _id: { $in: [owner._id, other._id] } }),
  ]);
});

test("fixture refresh and cached match reads meet the Phase 1 latency targets", async () => {
  const user = await makeUser();
  await jobIngestionService.ensureSources();
  await Profile.create({
    userId: user._id,
    roles: [{ factId: "fixture-role", title: "Backend Engineer", company: "Fixture Co" }],
    skills: [{ factId: "fixture-skill", name: "Node.js" }],
    preferences: {
      targetRoles: ["Backend Engineer"],
      preferredLocations: ["Kochi"],
      preferredCountryCodes: ["IN"],
      remotePreference: "any",
    },
  });
  const now = Date.now();
  const jobs = Array.from({ length: 180 }, (_, index) => ({
    contentHash: `perf-${user.id}-${index}`,
    title: index % 3 ? "Backend Engineer" : "Software Engineer",
    company: `Fixture ${index}`,
    rawDescription: "Build and maintain reliable software services.",
    sourceBoard: "remoteok",
    sourceJobId: `fixture-${index}`,
    location: index % 4 ? "Remote - India" : "Kochi, Kerala, India",
    remoteType: "remote",
    status: "active",
    expiresAt: new Date(now + 86400000),
    requirements: ["Node.js"],
    embedding: [1, 0],
    embeddingMetadata: { provider: "fixture", model: "fixture-v1", dimension: 2 },
    structuredLocation: { countryCode: "IN", remoteScope: "unknown", eligibleCountryCodes: [] },
  }));
  await Job.insertMany(jobs);

  const originalGetConfig = embeddingService.getConfig;
  const originalGetEmbedding = embeddingService.getEmbeddingWithMetadata;
  embeddingService.getConfig = () => ({ provider: "fixture", model: "fixture-v1", dimension: 2 });
  embeddingService.getEmbeddingWithMetadata = async () => ({
    vector: [1, 0],
    metadata: { provider: "fixture", model: "fixture-v1", dimension: 2 },
  });
  try {
    const refreshStartedAt = performance.now();
    const refresh = await discoveryGraph.runDiscovery(user.toObject(), {
      requestId: "fixture-performance",
      quotaAccepted: true,
    });
    const refreshMs = performance.now() - refreshStartedAt;
    assert.equal(refresh.matches.length, 20);

    const readTimes = [];
    for (let index = 0; index < 12; index += 1) {
      const startedAt = performance.now();
      await discoveryGraph.getUserMatches(user._id);
      readTimes.push(performance.now() - startedAt);
    }
    readTimes.sort((a, b) => a - b);
    const p95Ms = readTimes[Math.ceil(readTimes.length * 0.95) - 1];
    console.log(
      `Phase 1 fixture performance: refresh=${refreshMs.toFixed(1)}ms; cached-match-read-p95=${p95Ms.toFixed(1)}ms; fixture-jobs=180`,
    );
    assert.ok(refreshMs < 3000, `refresh exceeded 3000ms (${refreshMs.toFixed(1)}ms)`);
    assert.ok(p95Ms < 300, `cached match read p95 exceeded 300ms (${p95Ms.toFixed(1)}ms)`);
  } finally {
    embeddingService.getConfig = originalGetConfig;
    embeddingService.getEmbeddingWithMetadata = originalGetEmbedding;
    await Promise.all([
      Match.deleteMany({ userId: user._id }),
      Job.deleteMany({ contentHash: { $in: jobs.map((job) => job.contentHash) } }),
      Profile.deleteOne({ userId: user._id }),
      User.deleteOne({ _id: user._id }),
    ]);
  }
});
