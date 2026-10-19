import * as Sentry from "@sentry/node";
import { env } from "./env.js";
import { logger } from "../shared/utils/logger.js";

const SENSITIVE_KEY =
  /authorization|cookie|token|prompt|answer|resume|raw.?text|job.?description|password|email|content|message|input|output|transcript/i;

export function redactSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (!event || typeof event !== "object") return event;
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[Filtered]" : scrub(nested),
      ]),
    );
  };
  const safeEvent = scrub(event) as Sentry.ErrorEvent;
  if (safeEvent.request) {
    delete (safeEvent.request as Record<string, unknown>).data;
    delete (safeEvent.request as Record<string, unknown>).cookies;
    delete (safeEvent.request as Record<string, unknown>).query_string;
    if (safeEvent.request.url) {
      try {
        const parsed = new URL(safeEvent.request.url);
        safeEvent.request.url = `${parsed.origin}${parsed.pathname}`;
      } catch {
        safeEvent.request.url = "[Filtered]";
      }
    }
  }
  return safeEvent;
}

export function initSentry(): void {
  if (!env.SENTRY_DSN) {
    logger.debug("Sentry DSN not provided, error tracking disabled");
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: process.env.GIT_SHA || "1.0.0",
    tracesSampleRate: env.NODE_ENV === "production" ? 0.2 : 1.0,
    beforeSend: redactSentryEvent,
  });

  logger.info("Sentry initialized successfully");
}
