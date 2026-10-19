import { Server } from "node:http";
import { logger } from "../shared/utils/logger.js";
import { disconnectMongo } from "./database.js";
import { disconnectRedis } from "./redis.js";

const shutdownHandlers: Array<() => Promise<void> | void> = [];
let isShuttingDown = false;

export function registerShutdownHandler(fn: () => Promise<void> | void): void {
  shutdownHandlers.push(fn);
}

export function closeHttpServer(server: Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
  });
}

export function setupGracefulShutdown(server: Server | null = null): void {
  const shutdown = async (signal: NodeJS.Signals | string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, "Received termination signal, starting graceful shutdown...");

    // 1. Stop accepting new HTTP requests
    if (server) {
      try {
        await closeHttpServer(server);
        logger.info("HTTP server drained and closed");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, "HTTP server close failed");
      }
    }

    // 2. Run custom handlers (draining SSE, closing BullMQ workers, etc.)
    for (const handler of shutdownHandlers) {
      try {
        await handler();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, "Error during shutdown handler execution");
      }
    }

    // 3. Disconnect database & cache
    try {
      await disconnectMongo();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, "Error closing MongoDB connection");
    }

    try {
      await disconnectRedis();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, "Error closing Redis connection");
    }

    logger.info("Graceful shutdown completed successfully. Process exiting.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
