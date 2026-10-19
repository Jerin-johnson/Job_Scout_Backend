# AI and data-supply change log

Last verified against commit `feat/jobs-production` worktree on 2026-10-19.

## As built (verified in code)

Entries below describe changes implemented on the feature branch.

## 2026-10-19 — `feat/jobs-production` (Task A: production-grade job listing)

- Added indexed token search (`Job.searchTokens`, `job_search_tokens_recent`), bounded edit-distance typo expansion, weighted title/skill/company + recency relevance ranking, deterministic relevance cursor pagination, and `catalogVersion`-keyed Redis count/facet caching.
- Applied hot/cold `Job`/`JobDetail` compaction (`scripts/compact-job-hot-documents.js --apply`): reduced mean hot `Job` BSON size from `29,262 B` to `2,047 B` (`1,960 B` sample mean, `< 2,048 B`), reduced `jobs` collection size 93.0% (`16.68 MB` -> `1.17 MB`), and cut discovery `explain()` latency from `231 ms` to `9 ms`.
- Added per-record dead-letter isolation (`JobSource.deadLetters`), exponential circuit breaker cooldown, batch-completing graceful shutdown (`requestIngestionShutdown`), and admin health alerts (`evaluateSourceHealthAlerts`).
- Added polite host-bounded link health sampling (`maxTotal: 50, maxPerHost: 5`), repost/ghost detection (`ghost_listing_risk`, `broken_or_expired_link`, `repostCount`), and source-term expiry.
- Added inverted profile demand index (`Profile.matchTokens`, `profile_match_tokens_idx`) and bounded incremental matching (`enqueueIncrementalMatchesForNewJobs`, `20.20 ms` across 10,000 synthetic profiles).
- Added `SavedSearch` model, API endpoints (`/api/v1/jobs/saved-searches`), per-plan tier limits (`Free: 3/2`, `Pro: 15/10`, `Premium: 50/25`), IST quiet hours, `sentJobIds` deduplication, one-click unsubscribe, and GDPR/DPDP export/deletion integration.
- Added curated local O*NET 29.0 and GeoNames CC BY 4.0 subsets (`src/services/jobs/referenceData/`), upgraded occupation classifier to `OCCUPATION_FEATURES_VERSION = 8` (`41.0% -> 100.0%` gold accuracy; active catalog unclassified reduced to `11.40%`), and shipped windowed job list rendering + saved searches UI in `Ai_resume_frontend`.

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
