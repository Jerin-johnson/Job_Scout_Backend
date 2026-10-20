import { connectMongo, disconnectMongo } from "../src/infrastructure/database/database.js";
import { env } from "../src/config/env.js";
import { logger } from "../src/shared/utils/logger.js";
import { InterviewSession } from "../src/infrastructure/database/mongoose/models/InterviewSessionModel.js";
import { InterviewMessage } from "../src/infrastructure/database/mongoose/models/InterviewMessageModel.js";
import { InterviewReport } from "../src/infrastructure/database/mongoose/models/InterviewReportModel.js";
import { User } from "../src/infrastructure/database/mongoose/models/UserModel.js";
import { Application } from "../src/infrastructure/database/mongoose/models/ApplicationModel.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import { JobSource } from "../src/infrastructure/database/mongoose/models/JobSourceModel.js";
import { JobDetail } from "../src/infrastructure/database/mongoose/models/JobDetailModel.js";
import { JobVector } from "../src/infrastructure/database/mongoose/models/JobVectorModel.js";
import { dropObsoleteUniqueContentHashIndex } from "../src/infrastructure/database/mongoose/services/jobIndexes.js";

const INDEXED_MODELS = [
  InterviewSession,
  InterviewMessage,
  InterviewReport,
  Application,
  Job,
  JobSource,
  JobDetail,
  JobVector,
];

async function previewIndexSync(retentionDays) {
  const [sessions, messages, reports, trialSessionUsers, obsoleteIndexes] = await Promise.all([
    InterviewSession.countDocuments({ retentionExpiresAt: null, pinnedAt: null }),
    InterviewMessage.countDocuments({ retentionExpiresAt: null }),
    InterviewReport.countDocuments({ retentionExpiresAt: null }),
    InterviewSession.distinct("userId", { isFreeTrial: true }),
    Job.collection.indexes().catch(() => []),
  ]);
  const trialUsersToUpdate = trialSessionUsers.length
    ? await User.countDocuments({
        _id: { $in: trialSessionUsers },
        mockInterviewTrialUsedAt: { $exists: false },
      })
    : 0;
  const obsoleteContentHashIndex = obsoleteIndexes.find(
    (index) => index.unique && index.key?.contentHash === 1 && Object.keys(index.key).length === 1,
  );
  const indexesToEnsure = (
    await Promise.all(
      INDEXED_MODELS.map(async (model) => {
        const currentIndexes = await model.collection.indexes().catch(() => []);
        return model.schema.indexes().flatMap(([keys, options]) => {
          const name =
            options.name ||
            Object.entries(keys)
              .map(([key, direction]) => `${key}_${direction}`)
              .join("_");
          const matchingIndex = currentIndexes.find(
            (index) =>
              JSON.stringify(index.key) === JSON.stringify(keys) &&
              Boolean(index.unique) === Boolean(options.unique) &&
              Boolean(index.sparse) === Boolean(options.sparse) &&
              index.expireAfterSeconds === options.expireAfterSeconds &&
              JSON.stringify(index.partialFilterExpression || null) ===
                JSON.stringify(options.partialFilterExpression || null),
          );
          return matchingIndex ? [] : [{ collection: model.collection.collectionName, name }];
        });
      }),
    )
  ).flat();

  return {
    mode: "dry-run",
    database: "connected database (name omitted)",
    retentionDays,
    wouldBackfillRetentionExpiresAt: { sessions, messages, reports },
    wouldPreserveHistoricalTrialForUsers: trialUsersToUpdate,
    wouldDropObsoleteUniqueContentHashIndex: obsoleteContentHashIndex?.name || null,
    indexesToCreateOrReplace: indexesToEnsure,
    writesPerformed: false,
  };
}

async function ensureIndexes() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    const hostname = new URL(env.MONGODB_URI).hostname.toLowerCase();
    if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname)) {
      throw new Error("--dry-run is restricted to a non-production loopback MongoDB URI.");
    }
  }
  logger.info("Starting index synchronization on MongoDB...");
  const conn = await connectMongo({ autoIndex: !dryRun && env.NODE_ENV !== "production" });
  if (!conn) {
    logger.warn("Could not connect to MongoDB, skipping index creation in offline mode");
    process.exit(0);
  }

  const retentionDays = Math.max(
    1,
    Number.parseInt(process.env.MOCK_INTERVIEW_RETENTION_DAYS || "90", 10) || 90,
  );
  if (dryRun) {
    const preview = await previewIndexSync(retentionDays);
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    await disconnectMongo();
    return;
  }

  const expiryExpression = {
    $dateAdd: { startDate: "$createdAt", unit: "day", amount: retentionDays },
  };
  await Promise.all([
    InterviewSession.updateMany({ retentionExpiresAt: null, pinnedAt: null }, [
      { $set: { retentionExpiresAt: expiryExpression } },
    ]),
    InterviewMessage.updateMany({ retentionExpiresAt: null }, [
      { $set: { retentionExpiresAt: expiryExpression } },
    ]),
    InterviewReport.updateMany({ retentionExpiresAt: null }, [
      { $set: { retentionExpiresAt: expiryExpression } },
    ]),
  ]);

  // Preserve trial consumption for users whose historical trial was recorded only on a session.
  const previousTrials = await InterviewSession.aggregate([
    { $match: { isFreeTrial: true } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: "$userId", sessionId: { $first: "$_id" }, usedAt: { $first: "$createdAt" } } },
  ]);
  if (previousTrials.length) {
    await User.bulkWrite(
      previousTrials.map(({ _id, sessionId, usedAt }) => ({
        updateOne: {
          filter: { _id, mockInterviewTrialUsedAt: { $exists: false } },
          update: {
            $set: {
              mockInterviewTrialSessionId: sessionId,
              mockInterviewTrialUsedAt: usedAt || new Date(),
            },
          },
        },
      })),
    );
  }

  // contentHash is a change fingerprint, not a globally unique identity. Older
  // releases created a unique contentHash_1 index that rejected legitimate
  // same-content postings from a second source. Drop only that obsolete unique
  // index; source identity remains enforced by Job.identityKey.
  await dropObsoleteUniqueContentHashIndex();

  await Promise.all([
    InterviewSession.createIndexes(),
    InterviewMessage.createIndexes(),
    InterviewReport.createIndexes(),
    Application.createIndexes(),
    Job.createIndexes(),
    JobSource.createIndexes(),
    JobDetail.createIndexes(),
    JobVector.createIndexes(),
  ]);

  logger.info("All collection indexes synchronized successfully.");
  await disconnectMongo();
}

ensureIndexes().catch((err) => {
  logger.error({ err: err.message }, "Error synchronizing indexes");
  process.exit(1);
});
