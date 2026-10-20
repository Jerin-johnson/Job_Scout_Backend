import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import { JobSource } from "../src/infrastructure/database/mongoose/models/JobSourceModel.js";
import { BaseJobAdapter } from "../src/infrastructure/external-services/jobs/adapters/baseAdapter.js";
import { SOURCE_POLICIES } from "../src/domain/services/jobs/sourcePolicies.js";
import { bumpCatalogVersion } from "../src/infrastructure/database/mongoose/services/catalogVersion.js";

const mode = process.argv[2] || "--report";
const adapter = new BaseJobAdapter({ key: "migration" });
const migrationIndex = "job_identity_unique";
const backupCollection = "jobs_phase1_content_hash_backup";
const indexBackupCollection = "jobs_phase1_index_backup";

export function inferSourceId(job) {
  if (job.sourceJobId) return String(job.sourceJobId);
  const remoteOkId = String(job.sourceUrl || "").match(/remoteok\.com\/l\/([^/?#]+)/i)?.[1];
  return remoteOkId || `legacy:${job._id}`;
}

export function buildMigrationFields(job) {
  const source = String(job.sourceBoard || "legacy").toLowerCase();
  const sourceJobId = inferSourceId(job);
  const canonicalUrl = String(job.canonicalUrl || job.sourceUrl || "").trim();
  const identityKey = adapter.generateIdentity({
    source,
    sourceJobId: sourceJobId.startsWith("legacy:") ? "" : sourceJobId,
    canonicalUrl,
    title: job.title,
    company: job.company,
    location: job.location,
  });
  const policy = SOURCE_POLICIES.find((item) => item.key === source);
  const countryCode = String(job.structuredLocation?.countryCode || "").toUpperCase();
  const amountKnown = Number(job.salaryRange?.min) > 0 || Number(job.salaryRange?.max) > 0;
  const migrated = {
    identityKey,
    sourceJobId,
    canonicalUrl,
    structuredLocation: job.structuredLocation || {
      countryCode,
      region: "",
      city: "",
      remoteScope: "unknown",
      eligibleCountryCodes: [],
      workAuthorization: [],
    },
    compensation: job.compensation || {
      originalText: "",
      currency: amountKnown ? String(job.salaryRange?.currency || "").toUpperCase() : "",
      payPeriod: "unknown",
      min: amountKnown ? Number(job.salaryRange?.min) || null : null,
      max: amountKnown ? Number(job.salaryRange?.max) || null : null,
      normalizedCurrency: "",
    },
    status: job.status || "active",
    firstSeenAt: job.firstSeenAt || job.createdAt || job.postedAt || new Date(),
    lastSeenAt: job.lastSeenAt || job.updatedAt || job.postedAt || new Date(),
    occupationCodes: Array.isArray(job.occupationCodes) ? job.occupationCodes : [],
    provenance:
      Array.isArray(job.provenance) && job.provenance.length
        ? job.provenance
        : [
            {
              source,
              sourceJobId,
              canonicalUrl,
              attributionText: policy?.attributionText || source,
              attributionUrl: policy?.attributionUrl || canonicalUrl,
              seenAt: job.lastSeenAt || job.postedAt || new Date(),
            },
          ],
  };
  const withIdentity = { ...job, ...migrated };
  migrated.contentHash = adapter.generateContentHash(withIdentity);
  migrated.recordHash = adapter.generateRecordHash(withIdentity);
  return migrated;
}

const migrationProjection =
  "_id sourceBoard sourceJobId sourceUrl canonicalUrl title company location remoteType structuredLocation salaryRange compensation requirements tags rawDescription sourceExpiresAt status firstSeenAt lastSeenAt occupationCodes provenance createdAt updatedAt postedAt contentHash";

async function ensureCatalogIndex(jobModel, key, options) {
  const indexes = await jobModel.collection.indexes();
  const existing = indexes.find((index) => index.name === options.name);
  if (existing && JSON.stringify(existing.key) === JSON.stringify(key)) return;
  if (existing) {
    const backup = jobModel.db.collection(indexBackupCollection);
    const savedOptions = Object.fromEntries(
      Object.entries(existing).filter(
        ([name]) => !["v", "key", "name", "ns", "background"].includes(name),
      ),
    );
    await backup.updateOne(
      { _id: existing.name },
      { $setOnInsert: { key: existing.key, options: savedOptions } },
      { upsert: true },
    );
    await jobModel.collection.dropIndex(existing.name);
  }
  await jobModel.collection.createIndex(key, options);
}

export async function inspectJobCatalog({ jobModel = Job } = {}) {
  const identities = new Set();
  let collisionCount = 0;
  let totalJobs = 0;
  const sourceCounts = {};
  for await (const job of jobModel.find({}).select(migrationProjection).lean().cursor()) {
    const fields = buildMigrationFields(job);
    totalJobs += 1;
    const source = job.sourceBoard || "unknown";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    if (identities.has(fields.identityKey)) collisionCount += 1;
    identities.add(fields.identityKey);
  }
  return { totalJobs, identityCollisions: collisionCount, sourceCounts };
}

export async function migrateJobCatalog({ jobModel = Job, batchSize = 500 } = {}) {
  const inspection = await inspectJobCatalog({ jobModel });
  const { identityCollisions: collisionCount } = inspection;
  if (collisionCount)
    throw new Error(`Identity collisions found (${collisionCount}). Resolve before applying.`);
  let batch = [];
  const backup = jobModel.db.collection(backupCollection);
  const flush = async () => {
    if (!batch.length) return;
    await backup.bulkWrite(
      batch.map(({ job }) => ({
        updateOne: {
          filter: { _id: job._id },
          update: { $setOnInsert: { contentHash: job.contentHash } },
          upsert: true,
        },
      })),
      { ordered: true },
    );
    await jobModel.bulkWrite(
      batch.map(({ job, fields }) => ({
        updateOne: { filter: { _id: job._id }, update: { $set: fields } },
      })),
      { ordered: true },
    );
    batch = [];
  };
  for await (const job of jobModel.find({}).select(migrationProjection).lean().cursor()) {
    const fields = buildMigrationFields(job);
    batch.push({ job, fields });
    if (batch.length >= batchSize) await flush();
  }
  const report = {
    ...inspection,
    indexesToCreate: [
      migrationIndex,
      "job_candidate_location_mode",
      "job_candidate_active_recent",
      "job_candidate_recent_feed",
      "job_candidate_occupation",
      "job_source_coverage",
      "job_candidate_skills_recent",
      "job_candidate_title_recent",
      "job_candidate_occupation_recent",
      "job_candidate_eligible_country_recent",
    ],
  };
  await flush();
  await ensureCatalogIndex(
    jobModel,
    { identityKey: 1 },
    { unique: true, sparse: true, name: migrationIndex },
  );
  await ensureCatalogIndex(
    jobModel,
    { status: 1, "structuredLocation.countryCode": 1, remoteType: 1, expiresAt: 1, postedAt: -1 },
    { name: "job_candidate_location_mode" },
  );
  await ensureCatalogIndex(
    jobModel,
    { status: 1, expiresAt: 1, postedAt: -1 },
    { name: "job_candidate_active_recent" },
  );
  await ensureCatalogIndex(
    jobModel,
    { status: 1, sourceBoard: 1, postedAt: -1, _id: 1, expiresAt: 1 },
    { name: "job_candidate_recent_feed" },
  );
  await ensureCatalogIndex(
    jobModel,
    { status: 1, expiresAt: 1, occupationCodes: 1, postedAt: -1 },
    { name: "job_candidate_occupation" },
  );
  await ensureCatalogIndex(
    jobModel,
    { sourceBoard: 1, status: 1, expiresAt: 1 },
    { name: "job_source_coverage" },
  );
  await ensureCatalogIndex(
    jobModel,
    { status: 1, "features.skills": 1, postedAt: -1 },
    { name: "job_candidate_skills_recent" },
  );
  await ensureCatalogIndex(
    jobModel,
    { status: 1, "features.titleTokens": 1, postedAt: -1 },
    { name: "job_candidate_title_recent" },
  );
  await ensureCatalogIndex(
    jobModel,
    { status: 1, occupationCodes: 1, postedAt: -1 },
    { name: "job_candidate_occupation_recent" },
  );
  await ensureCatalogIndex(
    jobModel,
    { status: 1, "structuredLocation.eligibleCountryCodes": 1, postedAt: -1 },
    { name: "job_candidate_eligible_country_recent" },
  );
  await bumpCatalogVersion();
  return report;
}

export async function rollbackJobCatalog({
  jobModel = Job,
  sourceModel = JobSource,
  batchSize = 500,
} = {}) {
  await sourceModel.updateMany(
    { key: { $in: SOURCE_POLICIES.map((item) => item.key) } },
    { $set: { enabled: false } },
  );
  const backup = jobModel.db.collection(backupCollection);
  const hashes = [];
  for await (const entry of backup.find({})) {
    if (!entry.contentHash) continue;
    const conflict = await jobModel.exists({
      _id: { $ne: entry._id },
      contentHash: entry.contentHash,
    });
    if (conflict)
      throw new Error(
        `Cannot restore legacy contentHash for ${entry._id}: another record now uses it.`,
      );
    hashes.push({
      updateOne: {
        filter: { _id: entry._id },
        update: { $set: { contentHash: entry.contentHash } },
      },
    });
    if (hashes.length >= batchSize) {
      await jobModel.bulkWrite(hashes.splice(0, hashes.length), { ordered: true });
    }
  }
  if (hashes.length) await jobModel.bulkWrite(hashes, { ordered: true });
  await jobModel.collection.dropIndex(migrationIndex).catch((error) => {
    if (error.codeName !== "IndexNotFound") throw error;
  });
  const indexBackup = jobModel.db.collection(indexBackupCollection);
  for await (const entry of indexBackup.find({})) {
    const current = (await jobModel.collection.indexes()).find((index) => index.name === entry._id);
    if (current) await jobModel.collection.dropIndex(current.name);
    await jobModel.collection.createIndex(entry.key, { ...entry.options, name: entry._id });
  }
  return { sourcesDisabled: true, hashesRestored: await backup.countDocuments({}) };
}

async function main() {
  if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  if (mode === "--rollback") {
    const result = await rollbackJobCatalog();
    console.info(JSON.stringify(result));
    console.info(
      `Rollback complete. Additive fields and backup collection '${backupCollection}' were retained; existing embeddings were not changed.`,
    );
    return;
  }
  if (mode !== "--apply") {
    const report = {
      ...(await inspectJobCatalog()),
      indexesToCreate: [
        migrationIndex,
        "job_candidate_location_mode",
        "job_candidate_active_recent",
        "job_candidate_recent_feed",
        "job_candidate_occupation",
        "job_source_coverage",
        "job_candidate_skills_recent",
        "job_candidate_title_recent",
        "job_candidate_occupation_recent",
        "job_candidate_eligible_country_recent",
      ],
    };
    console.info(JSON.stringify(report, null, 2));
    return;
  }
  const report = await migrateJobCatalog();
  console.info(JSON.stringify(report, null, 2));
  console.info(
    "Job catalog migration applied. Existing embeddings were preserved; prior contentHash values are retained in the rollback collection.",
  );
}

if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.toLowerCase() ===
    new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).pathname.toLowerCase()
) {
  main()
    .catch((error) => {
      console.error(`Job catalog migration failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
