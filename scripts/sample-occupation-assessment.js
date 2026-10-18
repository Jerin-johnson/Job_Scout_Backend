import "../src/config/env.js";
import { connectMongo, disconnectMongo, isMongoReady } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { Job } from "../src/models/Job.js";
import { classifyJobOccupation } from "../src/services/jobs/occupationClassification.js";

const requestedSize = 300;
const reviewSize = 30;
const hostname = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname)) {
  throw new Error("Occupation assessment sampling is read-only and limited to loopback MongoDB.");
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function allocateProportionally(strata, targetSize) {
  const strataCount = strata.size;
  const remainingSize = Math.max(0, targetSize - strataCount);
  const totalCapacity = [...strata.values()].reduce((sum, stratum) => sum + Math.max(0, stratum.count - 1), 0);
  const allocations = [...strata.entries()].map(([key, stratum]) => {
    const capacity = Math.max(0, stratum.count - 1);
    const exact = totalCapacity ? remainingSize * capacity / totalCapacity : 0;
    return { key, count: 1 + Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  const remaining = targetSize - allocations.reduce((sum, row) => sum + row.count, 0);
  allocations.sort((left, right) => right.remainder - left.remainder || left.key.localeCompare(right.key));
  for (let index = 0; index < remaining; index += 1) allocations[index].count += 1;
  return new Map(allocations.map(({ key, count }) => [key, count]));
}

await connectMongo();
try {
  if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
  const strata = new Map();
  let scanned = 0;
  const cursor = Job.find({ status: "active", expiresAt: { $gt: new Date() } })
    .select("_id title sourceBoard sourceCategory occupationCodes tags")
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize: 1000 });

  for await (const job of cursor) {
    scanned += 1;
    const prediction = classifyJobOccupation(job);
    const source = job.sourceBoard || "unknown";
    const family = prediction.occupation || "unclassified";
    const key = `${source}\u0000${family}`;
    let stratum = strata.get(key);
    if (!stratum) {
      const seed = [...key].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 20261017);
      stratum = { source, family, count: 0, random: makeRandom(seed), reservoir: [] };
      strata.set(key, stratum);
    }
    stratum.count += 1;
    const row = {
      source,
      title: String(job.title || ""),
      sourceCategory: String(job.sourceCategory || ""),
      predictedFamily: family,
      confidence: prediction.occupationConfidence,
    };
    if (stratum.reservoir.length < requestedSize) stratum.reservoir.push(row);
    else {
      const index = Math.floor(stratum.random() * stratum.count);
      if (index < requestedSize) stratum.reservoir[index] = row;
    }
  }

  const sampleSize = Math.min(requestedSize, scanned);
  const allocations = sampleSize ? allocateProportionally(strata, sampleSize) : new Map();
  const sample = [];
  const stratumReport = [];
  for (const [key, stratum] of [...strata.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const take = allocations.get(key) || 0;
    for (let index = stratum.reservoir.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(stratum.random() * (index + 1));
      [stratum.reservoir[index], stratum.reservoir[swap]] = [stratum.reservoir[swap], stratum.reservoir[index]];
    }
    sample.push(...stratum.reservoir.slice(0, take));
    stratumReport.push({ source: stratum.source, predictedFamily: stratum.family, catalogCount: stratum.count, sampleCount: take });
  }

  const shuffle = makeRandom(20261017);
  for (let index = sample.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(shuffle() * (index + 1));
    [sample[index], sample[swap]] = [sample[swap], sample[index]];
  }
  const totals = (rows, field) => Object.fromEntries([...rows.reduce((counts, row) => {
    const value = row[field] || "unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
  const unclassifiedCount = sample.filter((row) => row.predictedFamily === "unclassified").length;
  console.log(JSON.stringify({
    mode: "local-read-only-review-sample",
    method: "independent deterministic reservoir sample, stratified proportionally by source and freshly predicted family; not hand-labeled",
    seed: 20261017,
    catalogActiveScanned: scanned,
    sampleSize: sample.length,
    accuracy: null,
    precision: null,
    recall: null,
    predictedUnclassified: { count: unclassifiedCount, share: sample.length ? Number((unclassifiedCount / sample.length).toFixed(4)) : null },
    sampleCountsBySource: totals(sample, "source"),
    sampleCountsByPredictedFamily: totals(sample, "predictedFamily"),
    strata: stratumReport,
    reviewSamples: sample.slice(0, reviewSize),
    note: "ReviewSamples contain public listing titles/category labels only. Add independent human gold labels before calculating quality metrics; this script does not claim accuracy.",
  }, null, 2));
} finally {
  await disconnectMongo();
}
