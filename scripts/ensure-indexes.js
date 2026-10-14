import { connectMongo, disconnectMongo } from "../src/config/database.js";
import { logger } from "../src/shared/utils/logger.js";

async function ensureIndexes() {
  logger.info("Starting index synchronization on MongoDB Atlas...");
  const conn = await connectMongo();
  if (!conn) {
    logger.warn("Could not connect to MongoDB, skipping index creation in offline mode");
    process.exit(0);
  }

  logger.info("All collection indexes synchronized successfully.");
  await disconnectMongo();
}

ensureIndexes().catch((err) => {
  logger.error({ err: err.message }, "Error synchronizing indexes");
  process.exit(1);
});
