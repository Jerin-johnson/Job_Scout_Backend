import "../src/config/env.js";
import { connectMongo, disconnectMongo } from "../src/infrastructure/database/database.js";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import {
  classifyJobOccupation,
  OCCUPATION_FEATURES_VERSION,
} from "../src/domain/services/jobs/occupationClassification.js";
import { bumpCatalogVersion } from "../src/infrastructure/database/mongoose/services/catalogVersion.js";

const apply = process.argv.includes("--apply");
const batchSizeArg = process.argv.find((arg) => arg.startsWith("--batch-size="));
const batchSize = Math.max(10, Math.min(1000, Number(batchSizeArg?.split("=")[1]) || 250));
const afterIdArg = process.argv.find((arg) => arg.startsWith("--after-id="));
const afterId = afterIdArg?.slice("--after-id=".length);

function assertLocalWriteTarget() {
  if (!apply) return;
  const hostname = new URL(env.MONGODB_URI).hostname;
  if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error(
      "Refusing classification backfill: --apply is permitted only against a non-production loopback MongoDB URI.",
    );
  }
}

assertLocalWriteTarget();
await connectMongo();
if (!Job.db?.readyState)
  throw new Error("MongoDB connection is unavailable; no classification work was performed.");

const countsByFamily = {};
const countsBySource = {};
const sourceFamilyCounts = {};
let scanned = 0;
let updated = 0;
let lastId = null;
let batch = [];
const sample = [];

async function flush() {
  if (!apply || !batch.length) {
    batch = [];
    return;
  }
  const result = await Job.bulkWrite(
    batch.map(({ _id, fields }) => ({
      updateOne: {
        filter: { _id, occupationFeaturesVersion: { $ne: OCCUPATION_FEATURES_VERSION } },
        update: { $set: fields },
      },
    })),
    { ordered: false },
  );
  updated += result.modifiedCount;
  batch = [];
}

try {
  const filter = { occupationFeaturesVersion: { $ne: OCCUPATION_FEATURES_VERSION } };
  if (afterId) {
    if (!mongoose.isValidObjectId(afterId))
      throw new Error("--after-id must be a valid Mongo ObjectId.");
    filter._id = { $gt: new mongoose.Types.ObjectId(afterId) };
  }
  const cursor = Job.find(filter)
    .select(
      "_id sourceBoard title company sourceCategory occupationCodes tags occupationFeaturesVersion",
    )
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize });

  for await (const job of cursor) {
    scanned += 1;
    lastId = String(job._id);
    const fields = classifyJobOccupation(job);
    const family = fields.occupation || "unclassified";
    const source = job.sourceBoard || "unknown";
    countsByFamily[family] = (countsByFamily[family] || 0) + 1;
    countsBySource[source] = (countsBySource[source] || 0) + 1;
    sourceFamilyCounts[source] ||= {};
    sourceFamilyCounts[source][family] = (sourceFamilyCounts[source][family] || 0) + 1;
    if (sample.length < 30)
      sample.push({
        source,
        title: job.title,
        occupation: family,
        confidence: fields.occupationConfidence,
      });
    else {
      const index = Math.floor(Math.random() * scanned);
      if (index < 30)
        sample[index] = {
          source,
          title: job.title,
          occupation: family,
          confidence: fields.occupationConfidence,
        };
    }
    if (apply) {
      batch.push({ _id: job._id, fields });
      if (batch.length >= batchSize) await flush();
    }
  }
  await flush();
  if (apply && updated > 0) await bumpCatalogVersion();
  const unclassified = countsByFamily.unclassified || 0;
  const bySource = Object.fromEntries(
    Object.entries(countsBySource)
      .sort()
      .map(([source, count]) => [
        source,
        {
          total: count,
          unclassified: sourceFamilyCounts[source]?.unclassified || 0,
          unclassifiedShare: count
            ? Number(((sourceFamilyCounts[source]?.unclassified || 0) / count).toFixed(4))
            : 0,
          families: sourceFamilyCounts[source],
        },
      ]),
  );
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        version: OCCUPATION_FEATURES_VERSION,
        scanned,
        updated,
        unclassified,
        unclassifiedShare: scanned ? Number((unclassified / scanned).toFixed(4)) : 0,
        countsByFamily,
        bySource,
        randomSamples: sample,
        lastScannedId: lastId,
        resumeCommand: lastId ? `npm run jobs:occupation:report -- --after-id=${lastId}` : null,
      },
      null,
      2,
    ),
  );
} finally {
  await disconnectMongo();
}
