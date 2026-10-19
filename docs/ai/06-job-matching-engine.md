# 06 — Job matching engine

Last verified against commit `1dcc456` plus Phase 3 working-tree changes on 2026-10-17.

## As built (verified in code)

Approved sources ingest in the worker; discovery reads indexed Mongo only. Feature extraction is deterministic (src/services/jobs/matching.js), with title tokens and skill/occupation/license/experience/work-mode hints. Candidate query filters source/status/expiry and profile eligibility, ranks lexical matches, then fills with at most 100 recent fallback candidates by default (`JOBS_RECENT_FALLBACK_LIMIT`); total candidate cap remains 400. The cap is after filters, not the count remaining after status/date checks. Scoring weights, real-profile diagnostics and explain evidence are in [the matching report](../JOB_MATCHING.md).

Score version defaults to lexical-v2 and can be selected with `JOB_MATCH_SCORE_VERSION`. Location tiers affect ranking; known country ineligibility and a missing required license can hard-block. Reasons are template generated. Match refresh/cache keys include profile and score versions. No LLM or vector rank is used in the matching hot path. Experimental lexical-v4 adds bounded occupation, seniority, and evidence-backed country eligibility contributions. Eligibility is neutral when the applicant's home country or listing policy evidence is absent; it does not turn unknown into a hard exclusion. V4 remains evaluation-only until its regression gate passes; v2 remains default.

## Job-specific resume match

`resume-match-v1` is a deterministic estimate, not an ATS pass probability. It compares one selected, owner-scoped resume with a catalog job, one of the user's application records, or a description the user pasted. It never fetches arbitrary URLs. The report includes grouped required/preferred skills, tools, licenses, soft skills, experience, education and title signals; matched/missing counts; short evidence; a 15-check ATS-readiness summary; and the user's best resume for the job. Ignored terms recalculate the deterministic score.

Reports are unique by `(userId,resumeId,jobKey,scoreVersion)`. Resume term indexes use an owner + file-content-hash + score-version cache key. Facts from the shared career profile are admitted only when they are grounded in the selected resume's text. AI suggestions are optional, isolated from scoring, and separately consent/quota/data-policy guarded. See [resume-match research](resume-match-research.md) and [ADR 0017](adr/0017-job-specific-resume-match.md).

Fuzzy role suggestions are available only as separate confirmations; role-suggestion APIs use exact curated aliases and free-text roles remain valid. Missing target roles can be suggested from saved role/resume facts. Fair thresholds are version-specific: lexical-v2 40, lexical-v3 50; lexical-v2 remains the active default. Use `npm run eval:jobs-phase3` for the v4 score breakdown and persona controls, `npm run jobs:match:preview -- <profile.json>` for a local read-only top-20 preview, and `npm run jobs:eligibility:distribution` for local country-scope aggregates. These Mongo-backed commands refuse non-local databases.

Occupation classification is additive, deterministic and rules-first (`src/services/jobs/occupationClassification.js`). It stores `occupation`, `occupationConfidence`, `normalizedTitle` and `occupationFeaturesVersion` (v8, using curated local O*NET 29.0 and GeoNames CC BY 4.0 subsets); it intentionally does not overwrite the existing `featuresVersion` used by text features. Eligibility is separately parsed with confidence/evidence and remains unknown without evidence. Known country mismatches are hidden by default in catalog search. Discovery remains LLM-free. Catalog keyword search uses indexed `searchTokens` (`job_search_tokens_recent` multikey index) with bounded edit-distance typo expansion, weighted title/skill/company + recency relevance ranking, and deterministic `(relevanceScore, postedAt, _id)` cursor pagination. New job ingestion triggers bounded incremental matching via an inverted profile demand index (`Profile.matchTokens` + `profile_match_tokens_idx`, capped by `INCREMENTAL_MATCH_BUDGET`, 20.2 ms at 10,000 synthetic profiles). See [production jobs report](jobs-production.md) and [coverage report](15-classification-and-catalog-coverage.md).

## Target design (not built yet)

Improve structured country/work-authorization/occupation coverage at ingestion and score calibration against labeled profiles. See [Phase 3 rules, costs and source gates](17-phase3-job-quality.md). Evaluate candidate relevance before changing weights. Keep matching deterministic and avoid per-listing model calls.

**Unverified:** source freshness/coverage outside current indexed feeds and population-wide match quality. Measure with privacy-preserving cohort metrics and representative fixtures.

## Scoring version gate

Run `npm run eval:match-versions` to print per-fixture v2/v3 scores. The evaluator does not invoke an LLM or change weights. v3 is not the shipped default until all existing fixtures are non-regressing and the new role-history, nursing, and non-IT profile fixtures improve.

Salary fit converts known monthly amounts to annual by multiplying by 12, and compares only equal currency codes. Hourly, unknown period, and currency mismatch remain neutral; legacy USD preferences continue to compare against known annual USD compensation.

The active default is `lexical-v2`. Set `JOB_MATCH_SCORE_VERSION=lexical-v3` only for a deliberate evaluation rollout. Run `npm run eval:match-versions` to print per-fixture v2/v3 scores. The evaluator does not invoke an LLM or change weights. v3 is not the shipped default until all existing fixtures are non-regressing and the new role-history, nursing, and non-IT profile fixtures improve.

Salary fit converts known monthly amounts to annual by multiplying by 12, and compares only equal currency codes. Hourly, unknown period, and currency mismatch remain neutral; legacy USD preferences continue to compare against known annual USD compensation.
