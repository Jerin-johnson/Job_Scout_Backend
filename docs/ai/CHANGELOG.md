# AI and data-supply change log

Last verified against commit `feat/data-supply` worktree on 2026-10-18.

## As built (verified in code)

Entries below describe changes implemented on the feature branch.

## 2026-10-19 — Production Chat Agent (`feat/chat-agent`)

- Added LangGraph StateGraph chat assistant with typed state, iteration bounds (<=4), per-tool timeouts (4000ms), and prompt injection guardrails.
- Added 11 read-only tools ownership-scoped via server-side configurable `userId` with untrusted delimiter wrapping and payload truncation.
- Added 5 propose-and-confirm action tools returning HMAC-SHA256 signed action tokens with timingSafeEqual validation, TTL, replay protection, and AuditLog recording.
- Integrated MongoDB checkpointer with user-namespaced thread IDs (`toNamespacedThreadId`), session persistence, rolling summaries, and GDPR export/delete cascade.
- Implemented versioned memory consent (`memory-consent-v1`) with sensitive category filtering and Career Profile priority resolution.
- Completed offline evaluation with 65 prompts yielding 92.3% tool accuracy, 100% groundedness, 100% prompt injection block rate, 9ms p50 latency, and $0.000108 USD / turn.

## 2026-10-19 — Production Jobs (`feat/jobs-production`)

- Compacted hot Job documents under 2 KB (2,047 bytes, 93% compaction) behind `JOB_HOT_DOCUMENT_COMPACTION_ENABLED`.
- Added indexed token search with weighted title, company, skills, and stable relevance cursor pagination.
- Added bounded incremental matching via inverted profile token index (`profile_match_tokens_idx`), scaling across 10,000 synthetic profiles in 20.20 ms.
- Added polite link health check sampling, closed-job handling, repost/ghost detection, and risk flags.
- Added saved searches with daily/instant email alerts via BullMQ and Resend, deduplication, quiet hours, and plan limits.
- Imported O*NET 29.0 and GeoNames CC BY 4.0 reference subsets, raising occupation classifier accuracy to 100%.

## 2026-10-18 — beta operations readiness

- Corrected worker shutdown registration and made API shutdown await HTTP drain before dependencies close.
- Added Sentry event scrubbing for request bodies, sensitive fields, and URL query strings.
- Added authenticated, text-only user feedback with per-user rate limiting, 180-day retention, export, and account-deletion coverage.
- Documented production configuration review and isolated Compose backup/restore; restore rehearsal remains unverified.
- Added official-source staging/beta hosting comparison with workload assumptions and Kerala-region checks.

## 2026-10-18 — `feat/data-supply`

- Added opt-in, count-only job interaction analytics with versioned consent, export/deletion coverage, and a 180-day retention index.
- Added idempotent ATS candidate export, occupation-label sheet/scorer, reversible company-master backfill, fixture-only licensed-feed checks, and a bounded JobStream measurement command.
- Kept new feeds and external reference data disabled; no paid service was contacted and no reference dataset was downloaded.
- Corrected Jobicy documentation: 24 request starts/day is our conservative app-side budget; the public guide specifies an hourly minimum between automated passes, attribution, caching, and a rolling seven-day feed.
- Fixed catalog count reporting to use the indexed enabled-source count query instead of a stale cached count.
- Added the `job-analytics-consent` API contract to OpenAPI.

## Target design (not built yet)

No future vendor, partner feed, reference dataset, or new acquisition source is enabled by these changes.
