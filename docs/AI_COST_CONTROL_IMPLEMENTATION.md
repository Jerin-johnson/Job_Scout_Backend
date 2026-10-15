# AI cost controls: implemented Phase 0 and Phase 1

This document describes the shipped catalog, quota metering, embedding, and usage-ledger behavior. It deliberately excludes monthly enforcement, atomic reservations, and billing dashboards.

## Model and price catalog

`src/ai/modelPricingCatalog.js` is the source of truth for exact provider/model IDs, active or retired state, data-policy class, pricing version, and effective input/output/cache rates. Unknown, retired, or currently unpriced IDs are rejected. Gemini 3.6 Flash and 3.8 Flash have dated rates that change on 2027-01-01. Recheck provider prices and terms before changing catalog entries; update the catalog and its focused tests together.

Anthropic's former Claude 3.5 defaults are recorded as retired. Anthropic is therefore not a deployable provider until active IDs and rates are intentionally added. Paid-tier model selection remains disabled.

## Personal-data policy

Production profile, resume, and interview-answer calls require the selected provider's configured data-policy class to be `paid_api`. The check uses `GEMINI_DATA_POLICY_CLASS` / `GROQ_DATA_POLICY_CLASS`, not the model name. These config values must reflect the actual provider account/contract. `AI_BLOCK_UNPAID_PERSONAL_DATA=true` is the production default. Local development and tests may use unpaid provider configurations.

## Quotas and idempotency

Chat turns, job discovery, resume parsing, tailoring, interview prep, legacy mock turns, interview-session creation, each accepted answer, and report generation increment a request counter after validation and relevant state checks. Redis uses one Lua operation to enforce the count and associate its idempotency key. Replays with the same key do not increment twice. Clients should send an `Idempotency-Key` header (8–128 safe characters) on retryable POST operations; if omitted, the request ID is used, preserving compatibility but not deduplicating a retry that has a new request ID.

Production quota checks require Redis. When Redis is unavailable, AI requests return a retryable 503; there is no production in-memory fallback. Local development/test memory mode is allowed only with `AI_ALLOW_MOCKS=true`.

## Shadow cost controls

`AI_MONTHLY_ALLOWANCE_SHADOW_MODE=true` compares observed/proposed monthly spend against `AI_MONTHLY_ALLOWANCE_SHADOW_RATIO` of the configured plan price. The ratio defaults to `0.25`. LLM preflight also logs when estimated request cost would exceed the remaining daily user budget. These emit structured logs with `wouldBlock=true`; they do not enforce a monthly allowance, reserve funds, or change request decisions. Daily spend caps and request-count quotas remain enforced. No monthly numeric allowance has been approved, so the ratio is an observation threshold, not a product entitlement.

## Embedding behavior and existing vectors

All embedding generation now checks the AI kill switch, selected provider/model pricing, and applicable quota path, then records estimated input usage and cost. The provider is explicit: selecting Voyage without a Voyage key does not fall through to OpenAI. Provider errors surface instead of returning a synthetic vector. Deterministic vectors are available only in non-production when `AI_ALLOW_MOCKS=true`; production never uses them.

New job, memory, and semantic-cache vectors store `embeddingMetadata` with provider, model, and dimension. The embedding cache key includes content hash, provider, model, and configured dimension. Existing vectors are not modified: a missing `embeddingMetadata` is legacy/unknown, and discovery/memory similarity does not compare that vector to a known, different embedding space.

No re-embedding migration was run. A safe migration would need: (1) choose a provider/model/dimension and preprocessing version; (2) estimate cost and rate limits; (3) back up or retain existing vectors; (4) backfill in bounded batches to a shadow field/collection; (5) verify vector count, dimension, errors, and retrieval quality against a representative evaluation set; (6) switch readers atomically; and (7) retain rollback data until verified. This requires separate approval.

## Usage ledger and retry policy

`UsageEvent` now records provider, model, plan and plan version, request and attempt IDs, success/partial/failure outcome, estimated-usage marker, input/output/cached tokens, pricing version, retry count, latency, and cost. Successful provider results await their ledger write. Streaming writes a partial or failed event if the provider errors or the client cancels after provider work starts. Production ledger-store failures surface as retryable 503 responses.

Retries are controlled by `AI_PROVIDER_MAX_RETRIES` (0–3, default 1) and apply only to HTTP 429/5xx and classified network failures. Timeout/abort/HTTP 408 failures are not retried. Provider errors and logs never include raw prompt or resume content.

## Production deployment checklist

- Set `NODE_ENV=production` and `AI_ALLOW_MOCKS=false`.
- Set `LLM_PROVIDER` and its real backend key. Configure exact active model IDs present in the catalog.
- Set `GEMINI_DATA_POLICY_CLASS=paid_api` or `GROQ_DATA_POLICY_CLASS=paid_api` only after confirming that account's data terms; otherwise personal-data features return `AI_PERSONAL_DATA_PROVIDER_BLOCKED`.
- Set `EMBEDDING_PROVIDER` and only its matching key/model/dimension.
- Configure durable `REDIS_URL` and `MONGODB_URI`; do not run AI workloads without both.
- Keep `AI_BLOCK_UNPAID_PERSONAL_DATA=true`; configure positive daily user/global caps and an intentional `AI_PROVIDER_MAX_RETRIES` value.
- Keep monthly shadow mode enabled while reviewing structured `wouldBlock` logs. Monthly enforcement and atomic reservations remain out of scope.

Never expose provider credentials through frontend environment variables. See [environment setup](./ENVIRONMENT_SETUP.md) and the versioned catalog for exact IDs.
