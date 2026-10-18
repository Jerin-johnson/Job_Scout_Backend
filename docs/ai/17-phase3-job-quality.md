# Phase 3 — eligibility, supply, currency and scoring

Last verified against commit `1dcc456` plus Phase 3 working-tree changes on 2026-10-17.

## As built (verified in code)

The Phase 3 increment is rules-first and does not call an LLM per job. Ingestion derives versioned eligibility from source location fields, tags and a bounded description prefix; unknown evidence stays unknown. Jobs with an explicit country/region conflict are hidden by default in catalog search. `showAnyway` exposes them with a mismatch label. Discovery keeps unknown jobs visible with an uncertainty penalty; v2 stays the configured default. The new `lexical-v4` is evaluated only and does not replace v2 unless its ship gate passes.

The ECB's daily euro reference rates are refreshed by the worker once daily and cached in Mongo. Salary display conversion retains original amount/currency and rate date; stale data is displayed with its date. Matching compares only annual/monthly rates after converting into the profile target currency; hourly, contract and unknown periods remain neutral. The system keeps the latest successful rate if refresh fails.

Greenhouse, Lever and Ashby adapters use public listed job-board APIs and are disabled by default. Only Ashby records with `isListed: true` are normalized. A careers URL must be HTTPS on an exact recognized public host; verification rejects off-host redirects and responses above 2 MB. Submitted boards wait for administrator review. SmartRecruiters and Recruitee were omitted because a public anonymous job-board API could not be verified. No company list is pre-seeded from unverified slugs.

Adzuna India is fixture-tested and disabled. Its activation guard requires a commercial license reference, a verified display badge and storage/display terms review; normal source approval cannot enable it. Requests are demand-driven and have separate minute/day/week/month counters. No live request was made.

`JOB_EMBEDDINGS_ENABLED=false` is the default for new jobs. Existing vectors and their unknown legacy metadata remain untouched. The matching path is deterministic. `Report this job` stores aggregate reason-code counts on the listing without reporter identity or free text. Risk flags are caution signals, never definitive fraud findings.

### Source policy and activation

RemoteOK, Remotive and Jobicy are the enabled feeds, with attribution on listing cards/details. This is an indexed catalog of those feeds and any individually verified, approved employer ATS boards; it is not the whole internet. The local development snapshot measured on 2026-10-16 also contains four `mock_public_board` fixtures; that is not an enabled production feed. ATS feeds require policy approval and one or more admin-approved companies. Adzuna remains off pending licensing and attribution approval. Do not scrape LinkedIn, Naukri, Foundit, Indeed or Glassdoor. SmartRecruiters/Recruitee are not implemented.

### Cost and efficiency

Ingestion and matching use no paid LLM or embedding calls by default. ECB reference rates are public and fetched once daily, not per request. ATS polling is bounded by per-source quotas and company requests are processed in small scheduled batches. Incremental provider spend is $0/month at 10k, 100k and 1M jobs while embeddings and Adzuna are off and the existing Mongo/Redis/worker capacity is sufficient. For 1,000 users and 100k jobs, lexical matching adds no model/embedding spend; the database and worker remain on the existing hosting bill. Actual hosting cost depends on its contract and capacity, so no cloud invoice estimate is claimed.

Local loopback measurement (2026-10-16): 806 active jobs, 100-document JSON sample, 1,384 average serialized JSON bytes/job (about 13.84 MB/138.4 MB/1.384 GB at 10k/100k/1M). This excludes BSON, indexes, replication and backups. The same-process local timings were list p50/p95 29.66/36.65 ms (30 samples), recommended refresh 83.97/95.96 ms (15), detail 2.01/2.53 ms (30), RSS 134.73 MB. They are not end-to-end or production capacity claims. BSON sample: 28,160 bytes/job with existing vectors and 7,664 bytes/job with vectors omitted; the first sample's vector is 20,410 bytes and embedding metadata 86 bytes. Mongo collection stats reported 23,518,464 logical data bytes, 46,649,344 allocated bytes and 2,940,928 index bytes for 806 documents. Use measured BSON and storage stats for capacity planning rather than serialized JSON estimates.

768-dimension float32 embeddings require 3,072 bytes/vector before index overhead (about 30.7 MB/307.2 MB/3.07 GB for 10k/100k/1M vectors). With embeddings off, newly ingested jobs add no vector storage or embedding spend. Existing vectors are retained.

After the additive local eligibility-v2 backfill, active catalog counts are: Jobicy 699, RemoteOK 99, Remotive 4 and local-only mock fixtures 4. Occupation unclassified share is 155/806 (19.23%): Jobicy 136/699 (19.46%), RemoteOK 16/99 (16.16%), Remotive 1/4 (25%), local mock fixtures 2/4 (50%). All 806 local jobs lack a normalized country code. Eligibility scope counts are country 413, worldwide 151, EU 53, North America 39, unknown 39, timezone 32, EMEA 28, LATAM 25, APAC 20, Asia 4, Africa 2. Before/after eligibility-v2 dry run: unknown scope 65→39, low confidence 70→44; 26 rows improved on each measure. A seeded hand-labeled 100-title review produced 73% overall accuracy (single reviewer) and per-predicted-family precision: sales 100% (21), software 100% (18), security 100% (5), design 100% (5), customer support 88.89% (9), operations 88.89% (9), marketing 60% (5), accounting/finance 33.33% (3), healthcare 0% (1), unclassified 4.76% (21). Small family counts are unstable; this is a diagnostic sample, not a production-quality benchmark. The gold labels and reproducible command live in `scripts/fixtures/occupation-gold-100.json` and `npm run jobs:occupation:accuracy`. No target locations are saved in the local profile.

Evaluation: v3 remains parked. The regressions are `existing-hr`, `existing-designer`, and `existing-marketing` (each -10). Root cause is an over-broad role alias canonicalization: `HR Manager` becomes `HR / Recruiter`, `Graphic Designer` becomes `Product Designer`, and `Marketing Manager` becomes `Marketing Executive`, which lowers title overlap against the respective job titles. Do not tune thresholds or fixtures to hide those changes; v3 needs more precise aliases and a re-evaluation.

The v4 experiment also remains unshipped. Before the eligibility-rule correction, all 15 old fixtures regressed (typically -6, HR -15) because unknown eligibility cost points even though those fixtures have no applicant country. The correction makes eligibility neutral when the profile has no applicant country or the job has no parseable eligibility evidence. On re-run, the old 15 still fail the non-regression gate: 14 are -4 and HR is -13. The weighted component report attributes those remaining losses to changed v4 weights (for typical fixtures skills -8, experience -2.75, location -2.55 to -3), partially offset by occupation +8 and title improvement; HR has no occupation offset. The rule change addressed the hypothesized eligibility contribution, but cannot erase score changes caused by the intentionally distinct v4 weighting. New India persona eligibility controls pass 10/10, and the pre-existing US-only controls pass 14/14. Keep lexical-v2 as the default; do not change any score weights or threshold to force the gate.

Eligibility rules are now config-version 2. Common country phrases map to ISO alpha-2 codes, and EU/EMEA/APAC/LATAM plus smaller continent groups map through `src/services/jobs/eligibilityRegions.js`. Run `npm run jobs:eligibility:distribution` for local-only scope/profile shares. The local catalog currently cannot be read in this environment because the configured loopback MongoDB is unavailable; before the rollout the saved snapshot had 841 records, 66 unknown remote scopes and 71 unknown/low-confidence rows. The v2 dry-run and apply commands report before/after counts and evidence samples; neither was applied because Mongo was unreachable. No non-local database was accessed and no resume was reprocessed.

Read-only local tools: `node scripts/jobs-match-preview.js --file=scripts/fixtures/match-preview.json` prints top-20 results and eligibility counts per profile fixture; `npm run jobs:bson:measure` reports BSON field sizes and vector-bearing versus embeddings-off projections. They were run against local Mongo. `node scripts/ats-company-tools.js validate docs/templates/ats-companies.csv ats-verified.json` checks public employer ATS boards with a 5-second timeout, 2 MB cap, no redirects and one request/second; no curated company list was provided, so no live board validation was performed. `node scripts/ats-company-tools.js import ats-verified.json <admin-user-id>` imports valid rows into local Mongo as pending approval. Admin source/company approval remains a separate step; Greenhouse, Lever and Ashby environment flags are false by default and must be explicitly set before the registry can enable an adapter.

Resume extraction instrumentation now reports redacted character/section/model-role/grounding/save counts without resume text, and a generated date-first two-column nursing fixture exercises deterministic extraction. The read-only local role diagnostic found 2 stored resumes, both decryptable with an experience heading; deterministic extraction returned 0 roles for both, with 7/8 lines in the detected section, 0 title-role cues, 1 date line in one record, and 1 employer cue in the other. Stored facts summaries had 1 role in one record and 0 in the other. This points to experience-section/title-cue recognition as the deterministic gap; historical per-stage LLM outputs were not retained, so whether the old failure also involved model grounding cannot be reconstructed. This diagnostic only parsed in memory and did not invoke an LLM or write/reprocess saved facts. The user-visible re-read action reports extracted counts and suggests next steps when zero roles are found. No re-read was triggered. At configured small-tier rates, one uncached reread at its 25,000-input/3,500-output-token caps estimates $0.002925; a content-hash cache hit costs no provider call.

Local `explain("executionStats")` for active, unexpired approved-source discovery ordered by `postedAt desc` and capped at 400 used `job_candidate_recent_feed` with three IXSCAN branches and SORT_MERGE: 400 returned, 402 keys examined, 400 documents examined, 59 ms. This small local-data snapshot is not a production plan/latency guarantee.

## Target design (not built yet)

Add human-approved taxonomies, source-specific retention verification, rate-limit dashboards, full occupation-country coverage goals, and a representative accuracy study. Do not turn on a source until terms, retention, attribution, quotas, and approval are recorded. Evaluate quantized/smaller vectors only on a labeled retrieval set before changing dimensions.

## Adzuna activation checklist

The current Adzuna terms permit commercial organizations to use other API purposes only during a 14-day trial for coverage/quality/usability validation; it may not support ongoing work/research after that trial without written consent, and a license may be required. Listing display requires a 116×23 minimum linked Adzuna label. The source remains disabled and `activationStatus: blocked_on_license`; do not ingest, persist, or display Adzuna results until a commercial license and storage/display rights are confirmed. The stated default quotas are 25/min, 250/day, 1,000/week, and 2,500/month. Source: [Adzuna API terms](https://developer.adzuna.com/docs/terms_of_service).

## Outbound search links

These are user-clicked search links only; they are not job ingestion integrations. The current query templates are:

- LinkedIn: `https://www.linkedin.com/jobs/search/?keywords={URLSearchParams(role)}&location={URLSearchParams(location)}`
- Naukri: `https://www.naukri.com/jobs-in-india?k={encodeURIComponent(role)}&l={encodeURIComponent(location)}`
- Foundit: `https://www.foundit.in/search?query={encodeURIComponent(role)}&locations={encodeURIComponent(location)}`
- Indeed India: `https://in.indeed.com/jobs?q={URLSearchParams(role)}&l={URLSearchParams(location)}`
- Google Jobs: `https://www.google.com/search?tbm=jobs&q={encodeURIComponent('"' + role + '" ' + location)}`

Owner verification is `false` for every template until the product owner confirms each destination and query behavior. See `Ai_resume_frontend/src/lib/jobs/externalSearchLinks.mjs`.

## Overseas recruitment help

For overseas recruitment questions, the UI points users to India's official [Ministry of External Affairs overseas employment information](https://www.mea.gov.in/overseas-employment.htm), [Protector General of Emigrants](https://www.mea.gov.in/protector-general-emigrants.htm), and [eMigrate portal](https://emigrate.gov.in/). These are informational links, not legal conclusions or endorsements.

## Unverified

The exact outbound search URL templates for Naukri, Foundit and Indeed are unverified against official developer documentation; links only open those sites and never fetch/store results. Search links are convenience links, not integrations. Occupation precision is not claimed: the 100-title random sample was inspected, but no independent hand-labeled reference set was available. Production source licensing, employer approvals, database host cost, and cloud p95 remain unverified until measured in that environment.
