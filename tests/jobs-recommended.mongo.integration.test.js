import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Job } from "../src/models/Job.js";
import { Match } from "../src/models/Match.js";
import { Profile } from "../src/models/Profile.js";
import { discoveryGraph } from "../src/ai/graphs/discoveryGraph.js";
import { embeddingService } from "../src/services/embeddingService.js";

let mongo;
let mongoDataPath;
before(async () => {
  mongoDataPath = mkdtempSync(join(process.cwd(), ".mongo-jobs-recommended-test-"));
  mongo = await MongoMemoryServer.create({
    instance: { storageEngine: "wiredTiger", dbPath: mongoDataPath },
    binary: process.env.MONGOMS_SYSTEM_BINARY ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: "8.0.8" } : undefined,
  });
  await mongoose.connect(mongo.getUri(), { dbName: "jobs-recommended-acceptance" });
  await Promise.all([Job.syncIndexes(), Match.syncIndexes(), Profile.syncIndexes()]);
});
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  if (mongoDataPath) rmSync(mongoDataPath, { recursive: true, force: true });
});

test("Recommended returns scored, reasoned roles against an 852-job catalog without embedding calls", async () => {
  const userId = new mongoose.Types.ObjectId();
  await Profile.create({
    userId,
    skills: ["GNM", "ICU", "BLS", "Patient care", "Nursing", ...Array.from({ length: 38 }, (_, i) => `Clinical skill ${i}`)].map((name) => ({ factId: new mongoose.Types.ObjectId().toString(), name })),
    roles: [{ factId: "role-1", title: "Staff Nurse", company: "Hospital", startDate: "2022", endDate: "", isCurrent: true, achievements: [] }],
    preferences: { targetRoles: ["Staff Nurse"], preferredLocations: ["Kochi, Kerala"], remotePreference: "any" },
  });
  const jobs = Array.from({ length: 852 }, (_, index) => {
    const nurse = index === 0;
    return {
      contentHash: `acceptance-content-${index}`,
      identityKey: `acceptance:${index}`,
      title: nurse ? "ICU Staff Nurse" : "AI Trainer",
      company: nurse ? "Kochi Hospital" : `Company ${index}`,
      location: nurse ? "Kochi, Kerala, India" : "Remote",
      remoteType: nurse ? "onsite" : "remote",
      requirements: nurse ? ["GNM", "ICU", "BLS", "Patient care"] : ["Python", "Machine learning", "LLM evaluation"],
      tags: nurse ? ["nursing", "critical care"] : ["AI", "machine learning"],
      rawDescription: nurse ? "ICU nursing role. 2 years experience." : "Train generative AI models.",
      sourceBoard: "remoteok",
      status: "active",
      expiresAt: new Date(Date.now() + 86400000),
      postedAt: new Date(Date.now() - index * 1000),
      postedDateKnown: index !== 851,
    };
  });
  await Job.insertMany(jobs);
  const originalEmbeddings = embeddingService.getEmbeddingWithMetadata;
  embeddingService.getEmbeddingWithMetadata = async () => { throw new Error("Recommended must not require an embedding provider"); };
  try {
    const resultWithoutVectors = await discoveryGraph.runDiscovery({ _id: userId }, { quotaAccepted: true });
    assert.ok(resultWithoutVectors.matches.length > 0);
    assert.equal(resultWithoutVectors.matches[0].title, "ICU Staff Nurse");
    assert.ok(resultWithoutVectors.matches[0].score >= 50);
    assert.ok(resultWithoutVectors.matches[0].reasons.length >= 2);

    await Match.deleteMany({ userId: String(userId) });
    await Job.updateMany({}, { $set: { embedding: [0.2, 0.8], embeddingMetadata: { provider: "mock", model: "deterministic-v1", dimension: 2 } } });
    const resultWithVectors = await discoveryGraph.runDiscovery({ _id: userId }, { quotaAccepted: true });
    assert.ok(resultWithVectors.matches.length > 0);
    assert.equal(resultWithVectors.matches[0].title, "ICU Staff Nurse");
    assert.ok(resultWithVectors.matches[0].score >= 50);
    assert.ok(resultWithVectors.matches[0].reasons.length >= 2);
    assert.equal(resultWithVectors.funnel.catalogSize, 852);
    assert.equal(resultWithVectors.funnel.profileEmbeddingAvailable, false);
  } finally {
    embeddingService.getEmbeddingWithMetadata = originalEmbeddings;
  }
});
