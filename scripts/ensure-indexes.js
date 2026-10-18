import { connectMongo, disconnectMongo } from "../src/config/database.js";
import { logger } from "../src/shared/utils/logger.js";
import { InterviewSession } from "../src/models/InterviewSession.js";
import { InterviewMessage } from "../src/models/InterviewMessage.js";
import { InterviewReport } from "../src/models/InterviewReport.js";
import { User } from "../src/models/User.js";
import { Application } from "../src/models/Application.js";
import { Job } from "../src/models/Job.js";
import { JobSource } from "../src/models/JobSource.js";
import { JobDetail } from "../src/models/JobDetail.js";
import { JobVector } from "../src/models/JobVector.js";
import { dropObsoleteUniqueContentHashIndex } from "../src/services/jobs/jobIndexes.js";

async function ensureIndexes() {
  logger.info("Starting index synchronization on MongoDB Atlas...");
  const conn = await connectMongo();
  if (!conn) {
    logger.warn("Could not connect to MongoDB, skipping index creation in offline mode");
    process.exit(0);
  }

  const retentionDays = Math.max(
    1,
    Number.parseInt(process.env.MOCK_INTERVIEW_RETENTION_DAYS || "90", 10) || 90,
  );
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
