# 06 — Job matching engine

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Approved sources ingest in the worker; discovery reads indexed Mongo only. Feature extraction is deterministic (src/services/jobs/matching.js), with title tokens and skill/occupation/license/experience/work-mode hints. Candidate query filters source/status/expiry and profile eligibility, ranks lexical matches, then fills the remaining cap with recent candidates; maximum 400. The cap is after filters, not the count remaining after status/date checks. Scoring weights, real-profile diagnostics and explain evidence are in [the matching report](../JOB_MATCHING.md).

Score version is lexical-v3. Location tiers affect ranking; known country ineligibility and a missing required license can hard-block. Reasons are template generated. Match refresh/cache keys include profile and score versions. No LLM or vector rank is used in the matching hot path.

Fuzzy role suggestions require a high-confidence alias/edit-distance match; the UI asks the user and does not silently persist a correction. Missing target roles can be suggested from saved role/resume facts. When no score reaches Fair (50), the nearest jobs remain visible with profile/catalog actions.

## Target design (not built yet)

Improve structured country/work-authorization/occupation coverage at ingestion; add reviewed eligibility filters and score calibration against labeled profiles. Evaluate candidate relevance before changing weights. Keep matching deterministic and avoid per-listing model calls.

**Unverified:** source freshness/coverage outside current indexed feeds and population-wide match quality. Measure with privacy-preserving cohort metrics and representative fixtures.
