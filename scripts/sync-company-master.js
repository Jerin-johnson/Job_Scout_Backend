import "../src/config/env.js";
import { connectMongo, disconnectMongo, isMongoReady } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { Job } from "../src/models/Job.js";
import { Company, normalizeCompanyName } from "../src/models/Company.js";

const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--rollback") ? "rollback" : "dry-run";
const host = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Company master is local-development only.");

await connectMongo();
if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
try {
  if (mode === "rollback") {
    const result = await Company.deleteMany({ createdBy: "job-catalog-backfill-v1" });
    console.log(JSON.stringify({ mode, deletedBackfillCompanies: result.deletedCount }));
  } else {
    const groups = new Map();
  const cursor = Job.find({ status: "active", expiresAt: { $gt: new Date() } }).select("company sourceBoard firstSeenAt lastSeenAt").lean().cursor({ batchSize: 500 });
    for await (const job of cursor) {
      const displayName = String(job.company || "").trim();
      const normalizedName = normalizeCompanyName(displayName);
      if (!normalizedName) continue;
      const item = groups.get(normalizedName) || { normalizedName, displayName, aliases: new Set(), domains: new Set(), sourceCounts: {}, firstSeenAt: job.firstSeenAt || new Date(), lastSeenAt: job.lastSeenAt || new Date(), jobCount: 0 };
      item.aliases.add(displayName);
      item.sourceCounts[job.sourceBoard || "unknown"] = (item.sourceCounts[job.sourceBoard || "unknown"] || 0) + 1;
      item.jobCount += 1;
      if (job.firstSeenAt && job.firstSeenAt < item.firstSeenAt) item.firstSeenAt = job.firstSeenAt;
      if (job.lastSeenAt && job.lastSeenAt > item.lastSeenAt) item.lastSeenAt = job.lastSeenAt;
      groups.set(normalizedName, item);
    }
    const preview = [...groups.values()];
    const existing = await Company.countDocuments({});
    console.log(JSON.stringify({ mode, sourceJobsGrouped: preview.reduce((sum, row) => sum + row.jobCount, 0), companiesFound: preview.length, existingCompanyRecords: existing, sample: preview.slice(0, 10).map((row) => ({ normalizedName: row.normalizedName, displayName: row.displayName, jobCount: row.jobCount })) }));
    if (mode === "apply") {
      for (let offset = 0; offset < preview.length; offset += 500) {
        const batch = preview.slice(offset, offset + 500).map((row) => ({ updateOne: { filter: { normalizedName: row.normalizedName }, update: { $setOnInsert: { displayName: row.displayName, aliases: [...row.aliases], domains: [], sourceCounts: row.sourceCounts, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, jobCount: row.jobCount, createdBy: "job-catalog-backfill-v1" } }, upsert: true } }));
        if (batch.length) await Company.bulkWrite(batch, { ordered: false });
      }
      console.log(JSON.stringify({ mode, upsertedOrRefreshed: preview.length, rollback: "npm run jobs:companies:rollback (removes rows created by this backfill)" }));
    }
  }
} finally { await disconnectMongo(); }
