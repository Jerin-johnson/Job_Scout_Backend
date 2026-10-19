import { createApp } from "./app.js";
import { env } from "../config/env.js";
import { logger } from "../shared/utils/logger.js";
import { connectMongo } from "../config/database.js";

export async function bootstrap(): Promise<void> {
  await connectMongo();

  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      { port: env.PORT, host: env.HOST, env: env.NODE_ENV },
      `JobScout API server running at http://${env.HOST}:${env.PORT}`,
    );
  });

  const shutdown = () => {
    logger.info("Gracefully shutting down HTTP server...");
    server.close(() => {
      logger.info("HTTP server closed.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (process.env.NODE_ENV !== "test") {
  bootstrap().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, "Fatal error during server startup");
    process.exit(1);
  });
}
