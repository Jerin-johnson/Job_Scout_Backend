import "dotenv/config";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  JOB_MATCH_SCORE_VERSION: z.enum(["lexical-v2", "lexical-v3"]).default("lexical-v2"),
  FX_REFERENCE_SOURCE: z.enum(["ecb", "rbi", "fbil"]).default("ecb"),
  PORT: z.coerce.number().default(4001),
  HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  SUPER_ADMIN_EMAIL: z.string().email().optional().or(z.literal("")),
  COOKIE_DOMAIN: z.string().default("localhost"),
  TRUST_PROXY: z.string().default("1"),

  // Security & Cryptography
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  RESUME_ENCRYPTION_KEY: z
    .string()
    .min(32, "RESUME_ENCRYPTION_KEY must be at least 32 chars (hex/base64)"),

  // Databases
  MONGODB_URI: z.string().default("mongodb://localhost:27017/jobscout"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Observability
  SENTRY_DSN: z.string().optional().default(""),
  LANGFUSE_PUBLIC_KEY: z.string().optional().default(""),
  LANGFUSE_SECRET_KEY: z.string().optional().default(""),
  LANGFUSE_BASEURL: z.string().default("https://cloud.langfuse.com"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // AI Models & Gateways
  ANTHROPIC_API_KEY: z.string().default("dummy_anthropic_key_for_dev"),
  LLM_PROVIDER: z.enum(["anthropic", "gemini", "groq"]).default("groq"),
  ANTHROPIC_MODEL_SMALL: z.string().default("claude-3.0-100k"),
  ANTHROPIC_MODEL_STRONG: z.string().default("claude-3.0-100k"),
  ANTHROPIC_DATA_POLICY_CLASS: z.enum(["unpaid_free_tier", "paid_api"]).default("unpaid_free_tier"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL_SMALL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_MODEL_STRONG: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_DATA_POLICY_CLASS: z.enum(["unpaid_free_tier", "paid_api"]).default("unpaid_free_tier"),
  GROQ_API_KEY: z.string().optional().default(""),
  GROQ_MODEL_SMALL: z.string().default("openai/gpt-oss-20b"),
  GROQ_MODEL_STRONG: z.string().default("openai/gpt-oss-120b"),
  GROQ_DATA_POLICY_CLASS: z.enum(["unpaid_free_tier", "paid_api"]).default("unpaid_free_tier"),
  MODEL_SMALL: z.string().default(""),
  MODEL_STRONG: z.string().default(""),
  EMBEDDING_PROVIDER: z.enum(["voyage", "openai"]).default("openai"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_EMBEDDING_DIMENSION: z.coerce.number().int().min(1).max(3072).default(1536),
  VOYAGE_EMBEDDING_MODEL: z.string().default("voyage-large-2-instruct"),
  VOYAGE_EMBEDDING_DIMENSION: z.coerce.number().int().min(1).max(4096).default(1024),
  JOB_EMBEDDINGS_ENABLED: z
    .string()
    .transform((value) => value === "true")
    .default("false"),
  JOB_HOT_DOCUMENT_COMPACTION_ENABLED: z
    .string()
    .transform((value) => value === "true")
    .default("false"),
  AI_ALLOW_MOCKS: z
    .string()
    .transform((value) => value === "true")
    .default("false"),
  AI_BLOCK_UNPAID_PERSONAL_DATA: z
    .string()
    .transform((value) => value !== "false")
    .default("true"),
  AI_MONTHLY_ALLOWANCE_SHADOW_MODE: z
    .string()
    .transform((value) => value !== "false")
    .default("true"),
  AI_MONTHLY_ALLOWANCE_SHADOW_RATIO: z.coerce.number().finite().positive().max(1).default(0.25),
  AI_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  ORPHAN_RESUME_CLEANUP_AFTER_HOURS: z.coerce.number().int().min(1).max(8760).default(24),
  ORPHAN_RESUME_CLEANUP_DELETE_ENABLED: z
    .string()
    .transform((value) => value === "true")
    .default("false"),
  OPENAI_API_KEY: z.string().optional().default("dummy_openai_key"),
  VOYAGE_API_KEY: z.string().optional().default(""),

  // Cost & Guardrails
  DAILY_USER_USD_BUDGET: z.coerce.number().finite().positive().default(5.0),
  GLOBAL_DAILY_USD_CAP: z.coerce.number().finite().positive().default(500.0),
  MOCK_INTERVIEW_PREMIUM_DAILY_LIMIT: z.coerce.number().int().min(1).default(3),
  MOCK_INTERVIEW_SESSION_TOKEN_CAP: z.coerce.number().int().min(1000).default(12000),
  MOCK_INTERVIEW_FREE_TRIAL_ENABLED: z
    .string()
    .transform((value) => value === "true")
    .default("false"),
  MOCK_INTERVIEW_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  MOCK_INTERVIEW_QUESTION_TIER: z.enum(["small", "strong"]).default("small"),
  MOCK_INTERVIEW_EVALUATION_TIER: z.enum(["small", "strong"]).default("small"),
  MOCK_INTERVIEW_REPORT_TIER: z.enum(["small", "strong"]).default("strong"),
  AI_KILL_SWITCH: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  AI_CHAT_TOOLS_KILL_SWITCH: z
    .string()
    .transform((val) => val === "true")
    .default("false"),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().default("dummy_google_client_id.apps.googleusercontent.com"),

  // Storage
  S3_BUCKET: z.string().default("jobscout-resumes"),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().default("dummy_s3_key"),
  S3_SECRET_ACCESS_KEY: z.string().default("dummy_s3_secret"),

  // Payments
  RAZORPAY_KEY_ID: z.string().default("rzp_test_dummy"),
  RAZORPAY_KEY_SECRET: z.string().default("rzp_secret_dummy"),
  RAZORPAY_WEBHOOK_SECRET: z.string().default("rzp_whsec_dummy"),
  RAZORPAY_PLAN_ID_PRO: z.string().default("plan_dummy_pro"),
  RAZORPAY_PLAN_ID_PREMIUM: z.string().default("plan_dummy_premium"),

  // Resend
  RESEND_API_KEY: z.string().default("re_dummy_key"),
  FROM_EMAIL: z.string().default("notifications@jobscout.ai"),

  // Job APIs
  ADZUNA_APP_ID: z.string().optional().default(""),
  ADZUNA_APP_KEY: z.string().optional().default(""),
  JOBSTREAM_SNAPSHOT_URL: z.string().optional().default(""),
  JOBSTREAM_CHANGES_URL: z.string().optional().default(""),
  NAV_JOB_FEED_URL: z.string().optional().default(""),
  NAV_JOB_FEED_TOKEN: z.string().optional().default(""),
  FRANCE_TRAVAIL_TOKEN_URL: z.string().optional().default(""),
  FRANCE_TRAVAIL_OFFERS_URL: z.string().optional().default(""),
  FRANCE_TRAVAIL_CLIENT_ID: z.string().optional().default(""),
  FRANCE_TRAVAIL_CLIENT_SECRET: z.string().optional().default(""),
  JOOBLE_API_KEY: z.string().optional().default(""),
  ENABLE_REMOTEOK_INGESTION: z
    .string()
    .transform((val) => val === "true")
    .default("true"),
  ENABLE_JOBICY_INGESTION: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  ENABLE_GREENHOUSE_INGESTION: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  ENABLE_LEVER_INGESTION: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  ENABLE_ASHBY_INGESTION: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  JOBS_RECENT_FALLBACK_LIMIT: z.coerce.number().int().min(0).max(400).default(100),
});

export type Env = z.infer<typeof envSchema>;

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("FATAL: Environment variable validation failed:");
  console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
  throw new Error("Environment validation failed");
}

export const env: Env = parsedEnv.data;
