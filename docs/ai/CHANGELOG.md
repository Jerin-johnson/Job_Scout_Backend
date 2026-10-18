# AI and data-supply change log

Last verified against commit `feat/data-supply` worktree on 2026-10-18.

## As built (verified in code)

Entries below describe changes implemented on the feature branch.

## 2026-10-18 — `feat/data-supply`

- Added opt-in, count-only job interaction analytics with versioned consent, export/deletion coverage, and a 180-day retention index.
- Added idempotent ATS candidate export, occupation-label sheet/scorer, reversible company-master backfill, fixture-only licensed-feed checks, and a bounded JobStream measurement command.
- Kept new feeds and external reference data disabled; no paid service was contacted and no reference dataset was downloaded.
- Corrected Jobicy documentation: 24 request starts/day is our conservative app-side budget; the public guide specifies an hourly minimum between automated passes, attribution, caching, and a rolling seven-day feed.
- Fixed catalog count reporting to use the indexed enabled-source count query instead of a stale cached count.
- Added the `job-analytics-consent` API contract to OpenAPI.

## Target design (not built yet)

No future vendor, partner feed, reference dataset, or new acquisition source is enabled by these changes.
