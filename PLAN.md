# JobScout API Implementation Plan (B1-B11)

- **B1: Scaffold + Infrastructure**
  - Setup root `package.json` (ESM, scripts, dependencies).
  - ESLint (strict) + Prettier configuration.
  - Zod-based boot-time environment schema (`src/config/env.js`).
  - Pino logger (`src/shared/utils/logger.js`) with pino-http redaction.
  - Sentry integration (`src/config/sentry.js`).
  - Graceful shutdown lifecycle (`src/config/shutdown.js`).
  - Health endpoints: `/health/live`, `/health/ready`.
  - Dockerfile (multi-stage, non-root, node:22-slim), `docker-compose.yml`, `.dockerignore`, `.env.example`.
  - CI workflow (`.github/workflows/ci.yml`), README.md, `scripts/smoke.js` skeleton.
  - Commit & run `npm run smoke`.

- **B2: Shared Cache Helper (`src/shared/cache.js`)**
  - Namespace `js:v1:`, typed key builders, TTL constants.
  - get, set, del, `getOrSet` with single-flight lock (`SET NX PX` + jittered retry).
  - Version-bump invalidation (`bumpVersion(userId, scope)`).
  - JSON serialization + zlib compression for values > 2KB.
  - Fail-open resilience (transparent bypass on Redis disconnection).
  - Per-layer hit/miss metrics counters.
  - Commit & run `npm run smoke`.

- **B3: Auth, Users, Quotas, Rate Limits**
  - User model & repository (bcrypt cost 12, account lockout backoff, refresh token rotation).
  - JWT auth (access token 15 min, rotating refresh tokens in httpOnly Secure cookies).
  - Google OAuth token verification (`google-auth-library`).
  - Plan configurations & tier limits (Free, Pro, Premium) in `src/shared/constants/plans.js`.
  - Redis quota counters (`INCR + EXPIRE`), async write-through to Mongo `usageEvents`.
  - Rate limiting (Redis-backed token bucket per IP and per user).
  - Quota middleware checking limits BEFORE any LLM call.
  - Commit & run `npm run smoke`.

- **B4: Profile & Resume Parsing**
  - File upload with Multer (memory/temp), magic-bytes validation (PDF, DOCX), 5MB size limit.
  - S3 / Cloudflare R2 client integration (`@aws-sdk/client-s3`).
  - Text extraction (pdf-parse, mammoth).
  - Single small-model structured call extracting STRUCTURED FACTS (roles, skills, education, achievements) each with `factId` (nanoid).
  - Profile model & CRUD endpoints.
  - Resume text AES-256-GCM encryption with versioned keys.
  - Parse caching by SHA-256 file hash (`rp:{fileHash}` 30d).
  - Commit & run `npm run smoke`.

- **B5: LLM Central Wrapper (`src/ai/llm.js`)**
  - Single wrapper for all model calls.
  - Dynamic model resolution via env (`MODEL_SMALL`, `MODEL_STRONG`).
  - Max tokens, timeouts, exponential backoff retries with jitter, Opossum circuit breaker.
  - Quota and daily budget enforcement ($ cap) before invocation.
  - Anthropic prompt caching with `cache_control: { type: "ephemeral" }` on stable prefix.
  - Zod-validated structured outputs.
  - AbortSignal support.
  - Langfuse tracing and async `usageEvents` logging (input, output, cache tokens, cost USD).
  - Prompt sequence enforcement: [system] -> [pinned memory + profile facts] (cache breakpoint) -> [retrieved memory] -> [thread summary + last 4 turns] -> [user message].
  - Commit & run `npm run smoke`.

- **B6: AI Router (`src/ai/router.js`)**
  - Tier 0: Slash commands (`/track`, `/status`, `/export`, `/stats`), deterministic Mongo lookups, exact cache (SHA256), semantic cache (`semanticCache` similarity > 0.96 for generic questions).
  - Tier 1: Small model structured classifier (`intent`, `complexity`, `needsTools`, `needsMemory`, `confidence`, `entities`).
  - Tier 2: Strong model LangGraph workflows.
  - Parallel execution of Tier 0 and Tier 1 with early abort on Tier 0 hit.
  - Single escalation rule on low confidence (< 0.7) or schema failure.
  - Logging of all decisions to `routingLogs`.
  - SSE chat endpoint with fast first-token streaming.
  - Commit & run `npm run smoke`.

- **B7: Memory System (`src/ai/memory/`)**
  - Short-term session in Redis (`sess:{userId}:{threadId}` 24h) with last 8 turns.
  - BullMQ `summarizeThread` background worker keeping summary + last 4 turns.
  - Long-term memory model (`memories` collection) with vector embeddings and user isolation.
  - Background memory extraction (BullMQ `memoryExtract`) with strict Zod validation, deduplication (> 0.9 similarity), and protected-attribute filters.
  - Pinned memory block caching (`mem:pinned:{userId}:{ver}`).
  - Memory CRUD, user `memoryPaused` toggle, and `/memories/forget-all`.
  - Commit & run `npm run smoke`.

- **B8: Job Discovery Engine (Graph A)**
  - Job board adapters (Adzuna, Jooble, RemoteOK, Greenhouse/Lever/Ashby) behind unified interface with rate limiters and feature toggles.
  - Pipeline: fetch -> normalize -> dedupe by hash -> bulkWrite -> embedOnce (shared 90d cache) -> vectorMatch -> ruleFilter -> smallModelRerank (top 30) -> explainTop10 -> save `matches`.
  - BullMQ scheduled workers: `ingestJobs` (every 6h) and `dailyMatch` (per active user).
  - Precomputed match explanations for instant dashboard retrieval.
  - Skill-gap analysis and thumbs up/down feedback logging.
  - Daily email digest via Resend.
  - Commit & run `npm run smoke`.

- **B9: Resume Tailoring (Graph B)**
  - Parse JD (cached 30d by hash) -> extract requirements -> map to profile facts -> draft resume.
  - `truthfulnessCheck`: validates that every bullet references a valid user `factId`. Regenerates if unsupported (max 2 retries); rejects hallucinated data.
  - ATS keyword analysis.
  - LangGraph `interrupt()` for human candidate approval/editing.
  - PDF & DOCX export post-approval.
  - Cover letter node with matching constraints.
  - Credit quota deduction (1 credit per run).
  - Commit & run `npm run smoke`.

- **B10: Application Tracker, Interview Prep & Follow-ups (Graphs C & D)**
  - Applications CRUD & Kanban board cached at `board:{userId}:{ver}` (60s).
  - Graph D (Application Manager): status change -> update tracker -> schedule delayed follow-up (BullMQ) -> draft follow-up email -> `interrupt()` for approval -> send via Resend.
  - Graph C (Interview Prep): parallel company research + role question bank -> personalized STAR stories -> stateful mock interview loop (max 5 turns, scored) -> feedback report.
  - SSE progress events.
  - Commit & run `npm run smoke`.

- **B11: Billing, Admin Telemetry, OpenAPI Contract & Final Verification**
  - Stripe Checkout, Customer Portal & raw-body signed webhook handler (idempotent).
  - Razorpay subscription verification & webhook handler.
  - Subscription lifecycle: upgrades, downgrades, cancellations, failed payment grace periods.
  - Admin metrics endpoint (`/admin/metrics`): cost vs revenue per user, cache hit rates, tier distribution (70-80% Tier 0/1 target), queue depth.
  - DPDP / GDPR data export & right-to-be-forgotten deletion endpoints.
  - `npm run openapi` generating `openapi.json` from Zod schemas and generating `API_CONTRACT.md`.
  - Comprehensive end-to-end `npm run smoke` validation.
  - Final summary artifact.
