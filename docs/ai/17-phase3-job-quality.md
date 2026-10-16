# Phase 3 — eligibility, supply, currency and scoring

Last verified against commit `0c5cd69` on 2026-10-16.

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

Local loopback measurement (2026-10-16): 841 active jobs, 100 document sample, 1,341 average serialized JSON bytes/job; approximate raw JSON sizes are 13.41 MB/134.1 MB/1.341 GB at 10k/100k/1M jobs. This excludes BSON, indexes, replication and backups. Local method timings: list p50/p95 9.98/12.99 ms (30 samples), recommended refresh 25.81/27.59 ms (15), detail 0.57/0.70 ms (30), process RSS 133.54 MB. These are same-process service measurements on the developer machine, not end-to-end network or production capacity results.

768-dimension float32 embeddings require 3,072 bytes/vector before index overhead (about 30.7 MB/307.2 MB/3.07 GB for 10k/100k/1M vectors). With embeddings off, newly ingested jobs add no vector storage or embedding spend. Existing vectors are retained.

Local catalog coverage: 161/841 jobs (19.14%) are unclassified. Unclassified share by source was Jobicy 142/734 (19.35%), RemoteOK 16/99 (16.16%), Remotive 1/4 (25%), and local mock fixtures 2/4 (50%). All 841 local rows lack a normalized country code, so country coverage cannot be reported reliably from this snapshot. Remote scope counts are country 451, worldwide 152, EU 78, unknown 66, timezone 42, APAC 27, North America 13, Asia 5, LATAM 5, Africa 2. The eligibility aggregate marks 71 rows unclear due to unknown/low-confidence evidence. No target locations are currently saved in the local career profile, so target-location eligible counts are unavailable.

Evaluation: v3 remains parked. It regresses HR Manager, Graphic Designer and Marketing Manager by 10 points each; only one of three new fixtures improves by 10. The v4 ship gate fails: it lowers all 15 existing fixture scores (most by 6 points) despite passing the explicit US-only pair control on 14/14 cases. Keep lexical-v2 as the default. The local profile report has 0 role facts and no saved home/target country, so all 120 retrieved jobs remain eligibility-unknown and score below 50; this is why no strong matches are currently shown. No stored resume was reprocessed.

## Target design (not built yet)

Add human-approved taxonomies, source-specific retention verification, rate-limit dashboards, full occupation-country coverage goals, and a representative accuracy study. Do not turn on a source until terms, retention, attribution, quotas, and approval are recorded. Evaluate quantized/smaller vectors only on a labeled retrieval set before changing dimensions.

## Adzuna activation checklist

Before turning on Adzuna, verify in writing: (1) commercial license and intended production use; (2) whether listing payloads, descriptions, salary and identifiers may be stored and for how long; (3) caching, deletion and refresh requirements; (4) permitted display fields and link behavior; (5) required “Adzuna” logo/badge dimensions, placement and link target; (6) rate limits and query allowance at the licensed tier; (7) country-specific scope for India; (8) whether display on a paid product changes license terms. Current tracker is configured for 25/min, 250/day, 1,000/week and 2,500/month, but the terms and license must be confirmed before activation. Source: [Adzuna API terms](https://developer.adzuna.com/docs/terms_of_service).

## Overseas recruitment help

For overseas recruitment questions, the UI points users to India's official [Ministry of External Affairs overseas employment information](https://www.mea.gov.in/overseas-employment.htm), [Protector General of Emigrants](https://www.mea.gov.in/protector-general-emigrants.htm), and [eMigrate portal](https://emigrate.gov.in/). These are informational links, not legal conclusions or endorsements.

## Unverified

The exact outbound search URL templates for Naukri, Foundit and Indeed are unverified against official developer documentation; links only open those sites and never fetch/store results. Search links are convenience links, not integrations. Occupation precision is not claimed: the 100-title random sample was inspected, but no independent hand-labeled reference set was available. Production source licensing, employer approvals, database host cost, and cloud p95 remain unverified until measured in that environment.
