import { connectMongo, disconnectMongo } from "../src/config/database.js";
import { logger } from "../src/shared/utils/logger.js";
import { InterviewSession } from "../src/models/InterviewSession.js";
import { InterviewMessage } from "../src/models/InterviewMessage.js";
import { InterviewReport } from "../src/models/InterviewReport.js";
import { User } from "../src/models/User.js";
import { Application } from "../src/models/Application.js";

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

  await Promise.all([
    InterviewSession.createIndexes(),
    InterviewMessage.createIndexes(),
    InterviewReport.createIndexes(),
    Application.createIndexes(),
  ]);

  logger.info("All collection indexes synchronized successfully.");
  await disconnectMongo();
}

ensureIndexes().catch((err) => {
  logger.error({ err: err.message }, "Error synchronizing indexes");
  process.exit(1);
});
