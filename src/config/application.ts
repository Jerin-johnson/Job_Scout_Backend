/**
 * Canonical Application Configuration
 * Provides non-secret application defaults and configurations derived from validated environment.
 */
import { env } from "./env.js";

export const applicationConfig = {
  appName: "JobScout AI Backend",
  version: "1.0.0",
  environment: env.NODE_ENV,
  apiPrefix: "/api/v1",
  security: {
    bcryptSaltRounds: 12,
    jwtAccessTokenExpiresIn: "15m",
    jwtRefreshTokenExpiresIn: "7d",
  },
  ai: {
    defaultProvider: "gemini",
    fallbackProvider: "anthropic",
  },
} as const;

export type ApplicationConfig = typeof applicationConfig;
