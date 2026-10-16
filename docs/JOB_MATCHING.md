# Job matching and discovery

## Current flow

The `/api/v1/jobs/matches` path reads the indexed Mongo catalog and a cached profile snapshot. Ingestion remains in the worker; discovery does not call feed providers. It retrieves at most 400 approved, active, unexpired jobs using the `features.skills` / `features.titleTokens` indexes plus a recent-job fallback, applies deterministic work-mode and location tiers, then scores and persists only the top 20. Vectors are not required and the hot path never calls an LLM or embedding provider. The score implementation and feature extraction are in `src/services/jobs/matching.js`; changing their behavior requires a new `MATCH_SCORE_VERSION` so old match and response caches cannot be reused.

The development-only aggregate funnel is available at `/api/v1/jobs/matches/debug` and `/dev/jobs-debug`. It reports counts and model configuration only; it does not include profile text, user identifiers, or job descriptions. The public UI labels scores as estimates and displays source attribution and posted-date availability.

## Reproduction and result

The local development catalog had 852 active jobs: Jobicy 744, Remote OK 99, mock public board 4, and Remotive 5. The configured embedding provider was OpenAI with a placeholder key, and the 300 jobs inspected through the earlier candidate path had deterministic mock vectors. Redis was unavailable, so the refresh queue was not available. The old graph attempted a profile embedding before scoring and failed, leaving an empty cached result. The UI's threshold behavior also hid every score below 50. The frontend response contract was correct.

After the change, the reproducible 852-job Mongo test returned scored, reasoned results with vectors absent and with mismatched mock vectors present. The latest sanitized run for the local 43-skill profile showed catalog 852, active/unexpired candidate set 400, after work mode 400, after location tiering 392, candidate vectors 400 (present but ignored), profile embedding unavailable, configured provider/model dimension `openai`/1536 (not called), at-or-above-50 0, under-50 fallback pool 392, written 20, returned 20, score range 29–46, score version `lexical-v2`. The jobs are now shown under the honest low/fair “Other roles you could consider” treatment rather than an empty state. No personal profile values are included here.

Empty results are limited to missing usable profile data, an actually empty active catalog, or candidates rejected by known hard blockers. Low scores remain visible with an honest band. Below-50 results are grouped under “Other roles you could consider.” Empty cache entries live for three seconds; non-empty cache keys include user profile version and score version. Resume parsing and preference updates increment profile version and enqueue refresh.

## Score and feature notes

Rules-only extraction is versioned and run at ingestion/backfill. It captures skill aliases, title tokens, occupation family, experience years, seniority, education terms, licenses, work mode, eligibility hints, employment type, compensation text, and a bounded set of responsibility phrases. Missing eligibility remains “unknown”; only explicit country exclusion or a clearly stated required license missing from the profile can hard-block a job. The detail page renders source description as escaped plain text, shows the source date or “Posted date unavailable,” exposes gaps and next actions, and never invents company facts.

Current score weights are skills 40, title/occupation 20, experience 15, location/eligibility 15, salary 5, and recency 5. Scores are deterministic and use no external calls. The band thresholds include a “Fair” fallback from 40–49 to ensure the nearest results remain visible; scores under 40 are labeled “Low.”

## Cost and vector trade-off

Incremental LLM and embedding API cost for Recommended is $0/month at 10k, 100k, and 1M jobs because this hot path does not use either service. Existing MongoDB, Redis, worker, and hosting costs are not included; their plans and rates were not supplied. Ingestion remains subject to each approved source's quota and cadence. Feature extraction is CPU-only and storage growth depends on actual text/feature sizes and existing Mongo pricing.

Embeddings remain stored for compatibility but are unnecessary for launch-scale discovery after lexical matching. The ingestion pipeline may still produce vectors for other features; no vectors were deleted or re-embedded. If semantic re-ranking is reconsidered, first sample top-N results, compare against the 15-profile evaluation fixtures, verify provider/model/dimension metadata, estimate API spend from measured tokens and change rates, and run an additive backfill with a rollback plan. Do not migrate vectors as part of this phase.

## Verification

- Mongo-backed recommendation regression: 852 jobs, realistic 43-skill Staff Nurse profile, location preference, vectors disabled and mismatched vectors present.
- 15 role-family sanity fixtures; a nurse fixture must rank nursing above AI Trainer.
- Index explain coverage verifies an IXSCAN and caps candidates at 400.
- Current catalog sizes before the rate-limited Remotive retry: Jobicy 744, Remote OK 99, mock public board 4, Remotive 5.
- The one-time Remotive retry was attempted, but the source's six-hour interval had not elapsed (last run 2026-10-16 09:31 UTC; attempt at 10:12 UTC), so the adapter correctly skipped it. Do not clear the run lock or raise the source quota to force a retry. Counts remain unchanged until the next permitted run.

## Production build on OneDrive

The frontend checkout is under OneDrive. A build in the active checkout previously failed with `EPERM` while creating `.next` output. I verified a production build from a temporary copy outside OneDrive, with `node_modules` linked to the existing install and environment files excluded; it compiled successfully. For a build in the original checkout, stop the frontend dev server first, remove the stale `.next` directory, then run `npm run build`. Do not remove `.next` while a dev/build process is using it. No environment file was edited.

The six responsive Jobs fixture screenshots are in the sibling frontend checkout at `docs/screenshots/phase1-jobs/`. They use development fixtures, not production or personal data.
