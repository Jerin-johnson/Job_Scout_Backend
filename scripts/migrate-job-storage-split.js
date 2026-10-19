import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { Job } from "../src/models/Job.js";
import { JobDetail } from "../src/models/JobDetail.js";
import { JobVector } from "../src/models/JobVector.js";
import { bumpCatalogVersion } from "../src/services/jobs/catalogVersion.js";
import { normalizeProvenanceList } from "../src/services/jobs/jobStorage.js";

const mode = process.argv.includes("--apply") ? "apply" : "report";
const force = process.argv.includes("--force");
const batchSize = Math.min(
  1000,
  Math.max(50, Number(process.env.JOB_STORAGE_MIGRATION_BATCH_SIZE) || 500),
);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const PROGRESS_VERSION = 2;

function assertLocalMongo() {
  if (
    !env.MONGODB_URI ||
    env.NODE_ENV === "production" ||
    !loopbackHosts.has(new URL(env.MONGODB_URI).hostname)
  ) {
    throw new Error(
      "Refusing storage split migration: this command is local-development only and requires a loopback MongoDB URI.",
    );
  }
}

export async function migrateJobStorage({
  jobModel = Job,
  detailModel = JobDetail,
  vectorModel = JobVector,
  apply = false,
} = {}) {
  const projection =
    "_id rawDescription requirements provenance embedding embeddingMetadata expiresAt";
  const progress = jobModel.db.collection("job_storage_split_v1_progress");
  const checkpoint =
    apply && !force ? await progress.findOne({ _id: "copy", version: PROGRESS_VERSION }) : null;
  let scanned = 0,
    detailsWritten = 0,
    vectorsWritten = 0,
    bytesDetail = 0,
    detailsToCopy = 0,
    vectorsToCopy = 0,
    batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const lastId = batch.at(-1)._id;
    if (!apply) {
      batch = [];
      return;
    }
    const detailOps = [],
      vectorOps = [];
    for (const job of batch) {
      if (job.rawDescription || job.requirements?.length || job.provenance?.length) {
        const cleanProvenance = normalizeProvenanceList(job.provenance || []);
        const detail = {
          jobId: job._id,
          description: job.rawDescription || "",
          requirements: job.requirements || [],
          provenance: cleanProvenance,
          expiresAt: job.expiresAt || new Date(Date.now() + 30 * 86400000),
        };
        detailOps.push({
          updateOne: {
            filter: { jobId: job._id },
            update: {
              $set: {
                description: detail.description,
                requirements: detail.requirements,
                provenance: detail.provenance,
                expiresAt: detail.expiresAt,
              },
            },
            upsert: true,
          },
        });
      }
      if (job.embedding?.length)
        vectorOps.push({
          updateOne: {
            filter: { jobId: job._id },
            update: {
              $setOnInsert: {
                jobId: job._id,
                vector: job.embedding,
                provider: job.embeddingMetadata?.provider || "legacy",
                model: job.embeddingMetadata?.model || "unknown",
                dimension: job.embeddingMetadata?.dimension || job.embedding.length,
                migratedAt: new Date(),
              },
            },
            upsert: true,
          },
        });
    }
    if (detailOps.length) {
      const res = await detailModel.bulkWrite(detailOps, { ordered: false });
      detailsWritten += (res.upsertedCount || 0) + (res.modifiedCount || 0);
    }
    if (vectorOps.length)
      vectorsWritten +=
        (await vectorModel.bulkWrite(vectorOps, { ordered: false })).upsertedCount || 0;
    await progress.updateOne(
      { _id: "copy" },
      { $set: { lastId, updatedAt: new Date(), version: PROGRESS_VERSION } },
      { upsert: true },
    );
    batch = [];
  };
  const filter = {
    $or: [
      { rawDescription: { $exists: true, $ne: "" } },
      { requirements: { $exists: true, $ne: [] } },
      { provenance: { $exists: true, $ne: [] } },
      { embedding: { $exists: true, $ne: [] } },
    ],
  };
  if (checkpoint?.lastId) filter._id = { $gt: checkpoint.lastId };
  for await (const job of jobModel
    .find(filter)
    .sort({ _id: 1 })
    .select(projection)
    .lean()
    .cursor({ batchSize })) {
    scanned += 1;
    if (job.rawDescription || job.requirements?.length || job.provenance?.length) {
      detailsToCopy += 1;
      bytesDetail += Buffer.byteLength(
        JSON.stringify({
          description: job.rawDescription || "",
          requirements: job.requirements || [],
          provenance: normalizeProvenanceList(job.provenance || []),
        }),
      );
    }
    if (job.embedding?.length) vectorsToCopy += 1;
    batch.push(job);
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  if (apply) await bumpCatalogVersion();
  return {
    mode: apply ? "apply" : "report",
    resumedAfter: checkpoint?.lastId ? String(checkpoint.lastId) : null,
    scanned,
    detailsToCopy,
    vectorsToCopy,
    detailsWritten,
    vectorsWritten,
    estimatedDetailBytes: bytesDetail,
    batchSize,
    legacyFieldsPreserved: true,
    rollback:
      "Keep legacy fields until reads are verified. Runtime falls back to legacy descriptions and vectors. Roll back app code and retain the additive collections; no source fields are deleted.",
  };
}

if (process.argv[1]?.endsWith("migrate-job-storage-split.js")) {
  try {
    assertLocalMongo();
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.info(JSON.stringify(await migrateJobStorage({ apply: mode === "apply" }), null, 2));
  } catch (error) {
    console.error(`Job storage migration failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
