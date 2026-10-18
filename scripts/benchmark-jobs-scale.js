import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { randomUUID } from "node:crypto";

const batchSize = Math.min(2000, Math.max(100, Number(process.env.JOBS_SCALE_BATCH_SIZE) || 1000));
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const sizes = process.argv.find((arg) => arg.startsWith("--sizes="))?.slice(8)
  .split(",").map((value) => {
    const normalized = value.trim().toLowerCase();
    if (/^\d+m$/.test(normalized)) return Number(normalized.slice(0, -1)) * 1_000_000;
    if (/^\d+k$/.test(normalized)) return Number(normalized.slice(0, -1)) * 1_000;
    return Number(normalized);
  }).filter((value) => [100_000, 500_000, 1_000_000].includes(value))
  || [100_000, 500_000, 1_000_000];

function assertLocalMongo() {
  if (!env.MONGODB_URI || env.NODE_ENV === "production" || !localHosts.has(new URL(env.MONGODB_URI).hostname)) {
    throw new Error("Refusing scale benchmark: only a loopback, non-production MongoDB URI is allowed.");
  }
}

function makeJob(index, runId) {
  const id = String(index).padStart(8, "0");
  const titles = ["Registered Nurse", "Senior Software Engineer", "Customer Support Associate", "Accountant", "Product Designer", "Warehouse Coordinator"];
  const countries = ["IN", "US", "GB", "DE", "AE", "CA"];
  const title = titles[index % titles.length];
  const country = countries[index % countries.length];
  const postedAt = new Date(Date.UTC(2026, 0, 1) + (index % 250) * 86400000);
  return {
    identityKey: `${runId}:${id}`, sourceBoard: ["greenhouse", "lever", "ashby", "remoteok"][index % 4],
    sourceJobId: id, title, normalizedTitle: title.toLowerCase(), company: `Employer ${index % 10000}`,
    companySlug: `employer-${index % 10000}`, location: `City ${index % 300}, ${country}`,
    structuredLocation: { countryCode: country, remoteScope: index % 3 ? "country" : "worldwide", eligibleCountryCodes: [country] },
    remoteType: ["remote", "hybrid", "onsite"][index % 3], occupation: ["nursing", "software", "customer-support", "accounting-finance", "design", "delivery-logistics"][index % 6],
    occupationConfidence: 0.9, features: { titleTokens: title.toLowerCase().split(" "), companyTokens: [`employer${index % 10000}`], skills: ["communication", "planning", "typescript"].slice(0, 1 + (index % 3)) },
    compensation: { originalText: "", currency: "", payPeriod: "unknown", min: null, max: null },
    status: "active", postedAt, postedDateKnown: true, expiresAt: new Date(postedAt.getTime() + 60 * 86400000),
    contentHash: `${runId}:hash:${id}`, createdAt: new Date(), updatedAt: new Date(),
  };
}

function percentile(values, fraction) {
  const sorted = values.toSorted((a, b) => a - b);
  return Number((sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] || 0).toFixed(2));
}

async function measureQuery(collection, query, sort, limit, samples = 30) {
  const timings = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    await collection.find(query).sort(sort).limit(limit).toArray();
    timings.push(performance.now() - start);
  }
  return { p50Ms: percentile(timings, 0.5), p95Ms: percentile(timings, 0.95), samples };
}

async function runSize(size, database) {
  const collectionName = `jobs_scale_bench_${process.pid}_${randomUUID().slice(0, 8)}`;
  const collection = await database.createCollection(collectionName);
  const runId = randomUUID();
  const identityIndexStarted = performance.now();
  await collection.createIndex({ identityKey: 1 }, { unique: true, name: "bench_identity_unique" });
  const identityIndexBuildMs = performance.now() - identityIndexStarted;
  let completed = 0;
  const ingestStarted = performance.now();
  for (let offset = 0; offset < size; offset += batchSize) {
    const count = Math.min(batchSize, size - offset);
    const operations = Array.from({ length: count }, (_, local) => {
      const index = offset + local;
      const doc = makeJob(index, runId);
      return { updateOne: { filter: { identityKey: doc.identityKey }, update: { $setOnInsert: doc }, upsert: true } };
    });
    await collection.bulkWrite(operations, { ordered: false });
    completed += count;
    if (completed && completed % 100_000 === 0) process.stdout.write(`\r${size.toLocaleString()}: inserted ${completed.toLocaleString()}`);
  }
  const duplicateOperations = Math.floor(size / 20);
  for (let offset = 0; offset < duplicateOperations; offset += batchSize) {
    const count = Math.min(batchSize, duplicateOperations - offset);
    const operations = Array.from({ length: count }, (_, local) => {
      const doc = makeJob((offset + local) * 20, runId);
      return { updateOne: { filter: { identityKey: doc.identityKey }, update: { $setOnInsert: doc }, upsert: true } };
    });
    await collection.bulkWrite(operations, { ordered: false });
    completed += count;
  }
  const ingestMs = performance.now() - ingestStarted;
  process.stdout.write("\n");

  const indexStarted = performance.now();
  await collection.createIndex({ status: 1, postedAt: -1, _id: 1 }, { name: "bench_catalog_cursor" });
  await collection.createIndex({ status: 1, "structuredLocation.countryCode": 1, remoteType: 1, occupation: 1, postedAt: -1 }, { name: "bench_occupation_country_mode" });
  await collection.createIndex({ status: 1, "features.titleTokens": 1, postedAt: -1 }, { name: "bench_title_tokens" });
  await collection.createIndex({ status: 1, "features.skills": 1, postedAt: -1 }, { name: "bench_skill_tokens" });
  const indexBuildMs = performance.now() - indexStarted;

  const catalog = await measureQuery(collection, { status: "active", "structuredLocation.countryCode": "IN", remoteType: "remote" }, { postedAt: -1, _id: 1 }, 20);
  const candidateRetrieval = await measureQuery(collection, { status: "active", "structuredLocation.countryCode": "IN", occupation: "software" }, { postedAt: -1 }, 400);
  const recommendedRefresh = await measureQuery(collection, { status: "active", "features.skills": "typescript", "structuredLocation.countryCode": "IN" }, { postedAt: -1 }, 500, 15);
  const explain = await collection.find({ status: "active", "structuredLocation.countryCode": "IN", remoteType: "remote" }).sort({ postedAt: -1, _id: 1 }).limit(20).explain("executionStats");
  const stats = await database.command({ collStats: collectionName, scale: 1 });
  const serverStatus = await database.admin().command({ serverStatus: 1 }).catch(() => null);
  const bsonSamples = await collection.aggregate([{ $limit: 100 }, { $project: { bytes: { $bsonSize: "$$ROOT" } } }]).toArray();
  const averageBsonBytes = bsonSamples.reduce((sum, doc) => sum + doc.bytes, 0) / Math.max(1, bsonSamples.length);
  const result = {
    documentsRequested: size, documentsStored: stats.count, duplicateOperations, ingestOperationsPerSecond: Number((completed / (ingestMs / 1000)).toFixed(1)), bulkBatchSize: batchSize,
    ingestMs: Number(ingestMs.toFixed(0)), identityIndexBuildMs: Number(identityIndexBuildMs.toFixed(0)), secondaryIndexBuildMs: Number(indexBuildMs.toFixed(0)), indexBuildMs: Number((identityIndexBuildMs + indexBuildMs).toFixed(0)), averageBsonBytesPerJob: Math.round(averageBsonBytes),
    logicalBytes: stats.size, storageBytes: stats.storageSize, indexBytes: stats.totalIndexSize,
    benchmarkClientRssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
    mongoServerMemory: serverStatus ? {
      residentMb: serverStatus.mem?.resident ?? null,
      wiredTigerCacheBytes: serverStatus.wiredTiger?.cache?.["bytes currently in the cache"] ?? null,
      wiredTigerCacheMaxBytes: serverStatus.wiredTiger?.cache?.["maximum bytes configured"] ?? null,
    } : null,
    catalogSearch: catalog, candidateRetrieval, recommendedRefresh,
    explain: { stage: explain.queryPlanner.winningPlan.stage, indexes: explain.queryPlanner.winningPlan.inputStage?.indexName || explain.queryPlanner.winningPlan.inputStage?.inputStage?.indexName || "see query planner", keysExamined: explain.executionStats.totalKeysExamined, docsExamined: explain.executionStats.totalDocsExamined, returned: explain.executionStats.nReturned },
  };
  await collection.drop();
  return result;
}

assertLocalMongo();
await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
const database = mongoose.connection.db;
const results = [];
try {
  for (const size of sizes) results.push(await runSize(size, database));
  console.log(JSON.stringify({ mode: "local-synthetic-only", sizes: results, cleanup: "temporary benchmark collections dropped after each run" }, null, 2));
} finally {
  for (const name of await database.listCollections({ name: { $regex: `^jobs_scale_bench_${process.pid}_` } }, { nameOnly: true }).toArray().then((rows) => rows.map((row) => row.name))) {
    await database.collection(name).drop().catch(() => {});
  }
  await mongoose.disconnect();
}
