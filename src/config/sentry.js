import * as Sentry from "@sentry/node";
import { env } from "./env.js";
import { logger } from "../shared/utils/logger.js";

export function initSentry() {
  if (!env.SENTRY_DSN) {
    logger.debug("Sentry DSN not provided, error tracking disabled");
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: process.env.GIT_SHA || "1.0.0",
    tracesSampleRate: env.NODE_ENV === "production" ? 0.2 : 1.0,
  });

  logger.info("Sentry initialized successfully");
}
