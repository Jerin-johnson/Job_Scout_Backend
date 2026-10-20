import { BSON } from "mongodb";
import { env } from "../src/config/env.js";
import {
  connectMongo,
  disconnectMongo,
  isMongoReady,
} from "../src/infrastructure/database/database.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import { JobDetail } from "../src/infrastructure/database/mongoose/models/JobDetailModel.js";
import { JobVector } from "../src/infrastructure/database/mongoose/models/JobVectorModel.js";
import {
  compactHotJobFields,
  normalizeProvenanceList,
} from "../src/infrastructure/database/mongoose/services/jobStorage.js";
import { buildSearchTokens } from "../src/infrastructure/database/mongoose/services/jobSearchService.js";
import { extractJobFeatures } from "../src/domain/services/jobs/matching.js";

const apply = process.argv.includes("--apply");
const rollback = process.argv.includes("--rollback");
const batchSize = 250;
const removable = [
  "rawDescription",
  "requirements",
  "provenance",
  "embedding",
  "embeddingMetadata",
];
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function assertLocalMongo() {
  if (
    !env.MONGODB_URI ||
    env.NODE_ENV === "production" ||
    !loopbackHosts.has(new URL(env.MONGODB_URI).hostname)
  ) {
    throw new Error("Refusing hot-document compaction: local-development MongoDB only.");
  }
  if ((apply || rollback) && !env.JOB_HOT_DOCUMENT_COMPACTION_ENABLED) {
    throw new Error("Set JOB_HOT_DOCUMENT_COMPACTION_ENABLED=true before --apply or --rollback.");
  }
  if (apply && rollback) throw new Error("Choose either --apply or --rollback.");
}

const withoutLegacyFields = (job) => {
  const withTokens = {
    ...job,
    searchTokens: job.searchTokens?.length ? job.searchTokens : buildSearchTokens(job),
  };
  return compactHotJobFields(withTokens);
};

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function measure() {
  let scanned = 0;
  let detailMissing = 0;
  let detailMismatch = 0;
  let vectorMissing = 0;
  let vectorMismatch = 0;
  let beforeBytes = 0;
  let afterBytes = 0;
  const sizesAfter = [];
  let batch = [];
  const inspect = async () => {
    if (!batch.length) return;
    const ids = batch.map((job) => job._id);
    const [details, vectors] = await Promise.all([
      JobDetail.find({ jobId: { $in: ids } })
        .select("jobId description requirements provenance")
        .lean(),
      JobVector.find({ jobId: { $in: ids } })
        .select("+vector jobId provider model dimension")
        .lean(),
    ]);
    const detailsById = new Map(details.map((row) => [String(row.jobId), row]));
    const vectorsById = new Map(vectors.map((row) => [String(row.jobId), row]));
    for (const job of batch) {
      scanned += 1;
      const detail = detailsById.get(String(job._id));
      const hasInlineDetail = Boolean(
        job.rawDescription || job.requirements?.length || job.provenance?.length,
      );
      if (hasInlineDetail) {
        if (!detail) detailMissing += 1;
        else if (
          detail.description !== (job.rawDescription || "") ||
          !sameJson(detail.requirements || [], job.requirements || []) ||
          !sameJson(
            normalizeProvenanceList(detail.provenance || []),
            normalizeProvenanceList(job.provenance || []),
          )
        ) {
          detailMismatch += 1;
        }
      } else if (!detail) {
        detailMissing += 1;
      }
      const vector = vectorsById.get(String(job._id));
      if (job.embedding?.length) {
        if (!vector) vectorMissing += 1;
        else if (
          vector.dimension !== job.embedding.length ||
          !sameJson(vector.vector, job.embedding)
        )
          vectorMismatch += 1;
      }
      const before = BSON.calculateObjectSize(job);
      const after = BSON.calculateObjectSize(withoutLegacyFields(job));
      beforeBytes += before;
      afterBytes += after;
      sizesAfter.push(after);
    }
    batch = [];
  };
  for await (const job of Job.find({}).select("+embedding").lean().cursor({ batchSize })) {
    batch.push(job);
    if (batch.length >= batchSize) await inspect();
  }
  await inspect();
  sizesAfter.sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(sizesAfter.length * 0.95) - 1);
  const stats = await Job.db.db.command({ collStats: Job.collection.collectionName });
  return {
    scanned,
    detailMissing,
    detailMismatch,
    vectorMissing,
    vectorMismatch,
    safeToRemove:
      scanned > 0 &&
      detailMissing === 0 &&
      detailMismatch === 0 &&
      vectorMissing === 0 &&
      vectorMismatch === 0,
    meanBsonBytesBefore: scanned ? Math.round(beforeBytes / scanned) : 0,
    meanBsonBytesProjected: scanned ? Math.round(afterBytes / scanned) : 0,
    p95BsonBytesProjected: sizesAfter[p95Index] || 0,
    maxBsonBytesProjected: sizesAfter.at(-1) || 0,
    indexSizesBytes: stats.indexSizes || {},
  };
}

async function updateBatch(operations) {
  if (operations.length) await Job.bulkWrite(operations, { ordered: false });
}

async function applyCompaction() {
  let operations = [];
  for await (const job of Job.find({})
    .select(
      "_id title normalizedTitle company location structuredLocation compensation features tags eligibility searchTokens",
    )
    .lean()
    .cursor({ batchSize })) {
    const compacted = withoutLegacyFields(job);
    const setFields = {
      searchTokens: compacted.searchTokens || [],
    };
    if (compacted.features) setFields.features = compacted.features;
    if (Array.isArray(compacted.tags)) setFields.tags = compacted.tags;
    if (compacted.eligibility) setFields.eligibility = compacted.eligibility;
    if (compacted.structuredLocation) setFields.structuredLocation = compacted.structuredLocation;
    if (compacted.compensation) setFields.compensation = compacted.compensation;
    operations.push({
      updateOne: {
        filter: { _id: job._id },
        update: {
          $unset: Object.fromEntries(removable.map((field) => [field, ""])),
          $set: setFields,
        },
      },
    });
    if (operations.length >= batchSize) {
      await updateBatch(operations);
      operations = [];
    }
  }
  await updateBatch(operations);
}

async function rollbackCompaction() {
  let jobs = [];
  const restore = async () => {
    if (!jobs.length) return;
    const ids = jobs.map((job) => job._id);
    const [details, vectors] = await Promise.all([
      JobDetail.find({ jobId: { $in: ids } })
        .select("jobId description requirements provenance")
        .lean(),
      JobVector.find({ jobId: { $in: ids } })
        .select("+vector jobId provider model dimension")
        .lean(),
    ]);
    const detailById = new Map(details.map((row) => [String(row.jobId), row]));
    const vectorById = new Map(vectors.map((row) => [String(row.jobId), row]));
    const operations = [];
    for (const job of jobs) {
      const fields = {};
      const detail = detailById.get(String(job._id));
      const vector = vectorById.get(String(job._id));
      if (detail) {
        fields.rawDescription = detail.description || "";
        fields.requirements = detail.requirements || [];
        fields.provenance = normalizeProvenanceList(detail.provenance || []);
        fields.features = extractJobFeatures({
          ...job,
          rawDescription: fields.rawDescription,
          requirements: fields.requirements,
        });
      }
      if (vector) {
        fields.embedding = vector.vector;
        fields.embeddingMetadata = {
          provider: vector.provider,
          model: vector.model,
          dimension: vector.dimension,
        };
      }
      if (Object.keys(fields).length)
        operations.push({ updateOne: { filter: { _id: job._id }, update: { $set: fields } } });
    }
    await updateBatch(operations);
    jobs = [];
  };
  for await (const job of Job.find({})
    .select("_id title company location remoteType occupation tags compensation")
    .lean()
    .cursor({ batchSize })) {
    jobs.push(job);
    if (jobs.length >= batchSize) await restore();
  }
  await restore();
}

assertLocalMongo();
await connectMongo();
try {
  if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
  if (rollback) {
    await rollbackCompaction();
    console.info(
      JSON.stringify({ mode: "rollback", restoredFrom: ["JobDetail", "JobVector"] }, null, 2),
    );
  } else {
    const report = await measure();
    if (!apply) {
      console.info(
        JSON.stringify(
          {
            mode: "dry-run",
            ...report,
            fieldsToRemove: removable,
            applyRequires: "safeToRemove=true and projected mean BSON size < 2048 bytes",
          },
          null,
          2,
        ),
      );
    } else {
      if (!report.safeToRemove)
        throw new Error("Split-copy verification failed; no legacy fields were removed.");
      if (report.meanBsonBytesProjected >= 2048)
        throw new Error("Projected mean remains at or above 2 KB; no legacy fields were removed.");
      await applyCompaction();
      console.info(
        JSON.stringify(
          { mode: "applied", ...(await measure()), fieldsRemoved: removable },
          null,
          2,
        ),
      );
    }
  }
} catch (error) {
  console.error(`Hot-document compaction failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectMongo();
}
