import { env } from "../src/config/env.js";
import {
  connectMongo,
  disconnectMongo,
  isMongoReady,
} from "../src/infrastructure/database/database.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import { JobDetail } from "../src/infrastructure/database/mongoose/models/JobDetailModel.js";
import { JobVector } from "../src/infrastructure/database/mongoose/models/JobVectorModel.js";
import { normalizeProvenanceList } from "../src/infrastructure/database/mongoose/services/jobStorage.js";

const host = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(host)) {
  throw new Error("Refusing split verification: local development MongoDB only.");
}

await connectMongo();
try {
  if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
  let scanned = 0;
  let detailMissing = 0;
  let detailMismatch = 0;
  const detailFieldMismatches = { description: 0, requirements: 0, provenance: 0 };
  let vectorMissing = 0;
  let vectorMismatch = 0;
  let batch = [];
  const verifyBatch = async () => {
    if (!batch.length) return;
    const ids = batch.map(({ _id }) => _id);
    const [details, vectors] = await Promise.all([
      JobDetail.find({ jobId: { $in: ids } })
        .select("jobId description requirements provenance")
        .lean(),
      JobVector.find({ jobId: { $in: ids } })
        .select("jobId vector dimension")
        .lean(),
    ]);
    const detailById = new Map(details.map((row) => [String(row.jobId), row]));
    const vectorById = new Map(vectors.map((row) => [String(row.jobId), row]));
    for (const job of batch) {
      scanned += 1;
      const detail = detailById.get(String(job._id));
      const hasInlineDetail = Boolean(
        job.rawDescription || job.requirements?.length || job.provenance?.length,
      );
      if (hasInlineDetail) {
        if (!detail) detailMissing += 1;
        else {
          const mismatch = {
            description: detail.description !== (job.rawDescription || ""),
            requirements:
              JSON.stringify(detail.requirements || []) !== JSON.stringify(job.requirements || []),
            provenance:
              JSON.stringify(normalizeProvenanceList(detail.provenance || [])) !==
              JSON.stringify(normalizeProvenanceList(job.provenance || [])),
          };
          for (const [field, differs] of Object.entries(mismatch)) {
            if (differs) detailFieldMismatches[field] += 1;
          }
          if (Object.values(mismatch).some(Boolean)) detailMismatch += 1;
        }
      } else if (!detail) {
        detailMissing += 1;
      }
      if (job.embedding?.length) {
        const vector = vectorById.get(String(job._id));
        if (!vector) vectorMissing += 1;
        else if (
          vector.dimension !== job.embedding.length ||
          JSON.stringify(vector.vector) !== JSON.stringify(job.embedding)
        )
          vectorMismatch += 1;
      }
    }
    batch = [];
  };
  for await (const job of Job.find({})
    .select("_id rawDescription requirements provenance embedding embeddingMetadata")
    .lean()
    .cursor({ batchSize: 250 })) {
    batch.push(job);
    if (batch.length >= 250) await verifyBatch();
  }
  await verifyBatch();
  console.log(
    JSON.stringify(
      {
        mode: "read-only",
        scanned,
        detailMissing,
        detailMismatch,
        detailFieldMismatches,
        vectorMissing,
        vectorMismatch,
        safeToRemoveLegacyFields:
          scanned > 0 &&
          detailMissing === 0 &&
          detailMismatch === 0 &&
          vectorMissing === 0 &&
          vectorMismatch === 0,
      },
      null,
      2,
    ),
  );
} finally {
  await disconnectMongo();
}
