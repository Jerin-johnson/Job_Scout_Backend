# AI and data-supply change log

Last verified against commit `feat/data-supply` worktree on 2026-10-18.

## As built (verified in code)

Entries below describe changes implemented on the feature branch.

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
