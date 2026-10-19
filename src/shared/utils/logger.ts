import type { IncomingMessage, ServerResponse } from "node:http";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { nanoid } from "nanoid";
import { env } from "../../config/env.js";

export const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "res.headers['set-cookie']",
  "body.password",
  "body.refreshToken",
  "body.token",
  "body.resumeText",
  "body.rawText",
  "body.email",
  "body.creditCard",
  "req.body.answer",
  "req.body.candidateAnswer",
  "req.body.prompt",
  "req.body.jobDescription",
  "req.body.resumeText",
  "req.body.rawText",
  "req.body.content",
  "req.body.message",
  "req.body.feedback",
];

export const logger = pino({
  level: env.LOG_LEVEL,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: IncomingMessage) => (req.headers["x-request-id"] as string | undefined) || nanoid(12),
  customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req: IncomingMessage, res: ServerResponse) =>
    `${req.method || "HTTP"} ${req.url || ""} completed with ${res.statusCode}`,
  customErrorMessage: (req: IncomingMessage, res: ServerResponse) =>
    `${req.method || "HTTP"} ${req.url || ""} failed with status ${res.statusCode}`,
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
});
