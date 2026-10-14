import pino from "pino";
import pinoHttp from "pino-http";
import { nanoid } from "nanoid";
import { env } from "../../config/env.js";

const redactPaths = [
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
];

export const logger = pino({
  level: env.LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.headers["x-request-id"] || nanoid(12),
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} completed with ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} failed with error: ${err.message}`,
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
});
