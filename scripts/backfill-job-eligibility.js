import "../src/config/env.js";
import { connectMongo, disconnectMongo, isMongoReady } from "../src/config/database.js";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { Job } from "../src/models/Job.js";
import { parseJobEligibility } from "../src/services/jobs/eligibility.js";

const apply = process.argv.includes("--apply");
const batchSizeArg = process.argv.find((arg) => arg.startsWith("--batch-size="));
const batchSize = Math.max(10, Math.min(1000, Number(batchSizeArg?.split("=")[1]) || 250));
const afterIdArg = process.argv.find((arg) => arg.startsWith("--after-id="));
const afterId = afterIdArg?.slice("--after-id=".length);
function assertLocalWriteTarget() {
  if (!apply) return;
  const hostname = new URL(env.MONGODB_URI).hostname;
  if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("Refusing eligibility backfill: --apply is permitted only against a non-production loopback MongoDB URI.");
  }
}
assertLocalWriteTarget();
await connectMongo();
if (!isMongoReady()) throw new Error("MongoDB is unavailable; eligibility report/apply requires the configured local database.");
const byScope = {};
const bySource = {};
const totalBySource = {};
let scanned = 0;
let updated = 0;
let lastId = null;
let operations = [];
async function flush() {
  if (!apply || !operations.length) { operations = []; return; }
  updated += (await Job.bulkWrite(operations, { ordered: false })).modifiedCount;
  operations = [];
}
try {
  const filter = { "eligibility.version": { $ne: 1 } };
  if (afterId) {
    if (!mongoose.isValidObjectId(afterId)) throw new Error("--after-id must be a valid Mongo ObjectId.");
    filter._id = { $gt: new mongoose.Types.ObjectId(afterId) };
  }
  const cursor = Job.find(filter).select("_id sourceBoard title location locationRestrictions country rawDescription tags structuredLocation eligibility").sort({ _id: 1 }).lean().cursor({ batchSize });
  for await (const job of cursor) {
    scanned += 1;
    lastId = String(job._id);
    const eligibility = parseJobEligibility(job);
    byScope[eligibility.remoteScope] = (byScope[eligibility.remoteScope] || 0) + 1;
    const source = job.sourceBoard || "unknown";
    bySource[source] = (bySource[source] || 0) + (eligibility.remoteScope === "unknown" ? 1 : 0);
    totalBySource[source] = (totalBySource[source] || 0) + 1;
    operations.push({ updateOne: { filter: { _id: job._id, "eligibility.version": { $ne: 1 } }, update: { $set: { eligibility } } } });
    if (operations.length >= batchSize) await flush();
  }
  await flush();
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned, updated, byScope, bySource: Object.fromEntries(Object.entries(totalBySource).sort().map(([source, total]) => [source, { total, unknown: bySource[source] || 0, unknownShare: total ? Number(((bySource[source] || 0) / total).toFixed(4)) : 0 }])), lastScannedId: lastId, resumeCommand: lastId ? `npm run jobs:eligibility:report -- --after-id=${lastId}` : null }, null, 2));
} finally { await disconnectMongo(); }
