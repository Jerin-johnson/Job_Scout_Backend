import { logger } from "../shared/utils/logger.js";
import { disconnectMongo } from "./database.js";
import { disconnectRedis } from "./redis.js";

const shutdownHandlers = [];
let isShuttingDown = false;

export function registerShutdownHandler(fn) {
  shutdownHandlers.push(fn);
}

export function setupGracefulShutdown(server = null) {
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, "Received termination signal, starting graceful shutdown...");

    // 1. Stop accepting new HTTP requests
    if (server) {
      server.close(() => {
        logger.info("HTTP server closed to new connections");
      });
    }

    // 2. Run custom handlers (draining SSE, closing BullMQ workers, etc.)
    for (const handler of shutdownHandlers) {
      try {
        await handler();
      } catch (err) {
        logger.error({ err: err.message }, "Error during shutdown handler execution");
      }
    }

    // 3. Disconnect database & cache
    try {
      await disconnectMongo();
    } catch (err) {
      logger.error({ err: err.message }, "Error closing MongoDB connection");
    }

    try {
      await disconnectRedis();
    } catch (err) {
      logger.error({ err: err.message }, "Error closing Redis connection");
    }

    logger.info("Graceful shutdown completed successfully. Process exiting.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
