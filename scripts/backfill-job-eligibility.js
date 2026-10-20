import "../src/config/env.js";
import {
  connectMongo,
  disconnectMongo,
  isMongoReady,
} from "../src/infrastructure/database/database.js";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import { parseJobEligibility } from "../src/domain/services/jobs/eligibility.js";
import { ELIGIBILITY_REGION_CONFIG_VERSION } from "../src/domain/services/jobs/eligibilityRegions.js";
import { bumpCatalogVersion } from "../src/infrastructure/database/mongoose/repositories/MongooseCatalogVersionRepository.js";

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
      "Refusing eligibility backfill: --apply is permitted only against a non-production loopback MongoDB URI.",
    );
  }
}
assertLocalWriteTarget();
await connectMongo();
if (!isMongoReady())
  throw new Error(
    "MongoDB is unavailable; eligibility report/apply requires the configured local database.",
  );
const byScope = {};
const beforeByScope = {};
const bySource = {};
const totalBySource = {};
let scanned = 0;
let updated = 0;
let unknownBefore = 0;
let unknownAfter = 0;
let lowConfidenceBefore = 0;
let lowConfidenceAfter = 0;
let unknownScopeClassified = 0;
let lowConfidenceImproved = 0;
const samples = [];
let lastId = null;
let operations = [];
async function flush() {
  if (!apply || !operations.length) {
    operations = [];
    return;
  }
  updated += (await Job.bulkWrite(operations, { ordered: false })).modifiedCount;
  operations = [];
}
try {
  const filter = { "eligibility.version": { $ne: ELIGIBILITY_REGION_CONFIG_VERSION } };
  if (afterId) {
    if (!mongoose.isValidObjectId(afterId))
      throw new Error("--after-id must be a valid Mongo ObjectId.");
    filter._id = { $gt: new mongoose.Types.ObjectId(afterId) };
  }
  const cursor = Job.find(filter)
    .select(
      "_id sourceBoard title location locationRestrictions country rawDescription tags structuredLocation eligibility",
    )
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize });
  const random = () => Math.random();
  for await (const job of cursor) {
    scanned += 1;
    lastId = String(job._id);
    const eligibility = parseJobEligibility(job);
    byScope[eligibility.remoteScope] = (byScope[eligibility.remoteScope] || 0) + 1;
    const oldEligibility = job.eligibility || {};
    const oldScope = oldEligibility.remoteScope || "unknown";
    beforeByScope[oldScope] = (beforeByScope[oldScope] || 0) + 1;
    const wasUnknown = oldScope === "unknown";
    const isUnknown = eligibility.remoteScope === "unknown";
    const wasLow = Number(oldEligibility.confidence || 0) < 0.5;
    const isLow = eligibility.confidence < 0.5;
    if (wasUnknown) unknownBefore += 1;
    if (isUnknown) unknownAfter += 1;
    if (wasLow) lowConfidenceBefore += 1;
    if (isLow) lowConfidenceAfter += 1;
    if (wasUnknown && !isUnknown) unknownScopeClassified += 1;
    if (wasLow && !isLow) lowConfidenceImproved += 1;
    if (samples.length < 30) samples.push(null);
    const sampleSlot = Math.floor(random() * scanned);
    if (sampleSlot < 30)
      samples[sampleSlot] = {
        source: job.sourceBoard || "unknown",
        title: job.title,
        beforeScope: oldScope,
        afterScope: eligibility.remoteScope,
        evidence: eligibility.evidence,
      };
    const source = job.sourceBoard || "unknown";
    bySource[source] = (bySource[source] || 0) + (eligibility.remoteScope === "unknown" ? 1 : 0);
    totalBySource[source] = (totalBySource[source] || 0) + 1;
    operations.push({
      updateOne: {
        filter: { _id: job._id, "eligibility.version": { $ne: ELIGIBILITY_REGION_CONFIG_VERSION } },
        update: { $set: { eligibility } },
      },
    });
    if (operations.length >= batchSize) await flush();
  }
  await flush();
  if (apply && updated > 0) await bumpCatalogVersion();
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        configVersion: ELIGIBILITY_REGION_CONFIG_VERSION,
        scanned,
        updated,
        beforeByScope,
        afterByScope: byScope,
        unknownScopeClassified,
        lowConfidenceImproved,
        before: { unknownScope: unknownBefore, lowConfidence: lowConfidenceBefore },
        after: { unknownScope: unknownAfter, lowConfidence: lowConfidenceAfter },
        bySource: Object.fromEntries(
          Object.entries(totalBySource)
            .sort()
            .map(([source, total]) => [
              source,
              {
                total,
                unknownAfter: bySource[source] || 0,
                unknownShare: total ? Number(((bySource[source] || 0) / total).toFixed(4)) : 0,
              },
            ]),
        ),
        randomSamples: samples.filter(Boolean),
        lastScannedId: lastId,
        resumeCommand: lastId ? `npm run jobs:eligibility:report -- --after-id=${lastId}` : null,
      },
      null,
      2,
    ),
  );
} finally {
  await disconnectMongo();
}
