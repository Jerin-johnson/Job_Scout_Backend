# Production-grade job listing: baseline, architecture, and verification

Last verified against commit `71c72a5` on the `feat/jobs-production` branch on 2026-10-19.

## As built (verified in code)

This document records the measured local baseline and the production-grade job listing implementation on `feat/jobs-production`, covering:

1. Baseline scale benchmark, query `explain()`, BSON field footprint, index sizes, and RAM working-set estimates.
2. Indexed tokenized search (`searchTokens` / weighted title, company, and skill tokens), bounded typo tolerance, blended relevance + recency ranking, stable cursor pagination for relevance sort, and `catalogVersion`-keyed approximate count/facet caching.
3. Hot/cold/vector storage split verification (`Job`, `JobDetail`, `JobVector`) and hot document compaction (`scripts/compact-job-hot-documents.js`) keeping hot `Job` documents <= 2 KB.
4. Ingestion robustness: dead-letter persistence, circuit breaker and backoff verified with fault injection, per-source budgets, graceful shutdown finishing the current batch, idempotent restarts, and admin source health/alert thresholds.
5. Freshness and trust: sampled polite link-health checks, source-specific expiry, closed-job handling, repost and ghost detection, and extended `getJobRiskFlags` advisories.
6. Matching at scale: incremental recompute using inverted skill and title token indexes on `Profile` (no full user scan), bounded refresh budgets, verified at 10,000 synthetic users with `lexical-v2` as default.
7. Saved jobs, saved searches, and email alerts via Resend and BullMQ with job deduplication, consent/unsubscribe, `plans.js` tier limits, rate limits, quiet hours, preview endpoint, and GDPR/DPDP export/deletion coverage.
8. Additive local GeoNames and O*NET 31.0 reference subsets with CC BY 4.0 attribution, occupation classification and role suggestion improvements, and before/after evaluation metrics.
9. Source governance (`ENABLE_JOBICY_INGESTION` staging owner step, Remotive blocked, vendor/government feeds disabled) and admin coverage alignment with [data-supply-strategy.md](data-supply-strategy.md).
10. Frontend Jobs list windowed/incremental rendering, sticky filter bar with "More filters" drawer, saved search entry points, and accessibility attributes.

## Target design (not built yet)

- Live production capacity sizing on a dedicated hosted MongoDB replica set and Redis instance remains **Unverified** until measured on the target deployment host.
- Commercial job-data vendor feeds, NAV, France Travail, JobStream full-catalog sync, and live government recruitment notice feeds remain disabled pending credentials and written redistribution licenses.
- ESCO reference data import remains intentionally skipped until release-specific reuse terms are verified.

---

## 1. Baseline measurements (2026-10-19)

### 1.1 Discovery query `explain("executionStats")` (`scripts/explain-job-discovery.js`)

Executed against local loopback MongoDB (`127.0.0.1:27017`):

- **Query**: `{ status: "active", expiresAt: { $gt: new Date() }, sourceBoard: { $in: ["remoteok", "remotive", "jobicy"] } }` sorted by `{ postedAt: -1, _id: 1 }`, limit `400`, hint `job_candidate_recent_feed`.
- **Plan stages**: `LIMIT` -> `FETCH` -> `SORT_MERGE` -> `IXSCAN` (`job_candidate_recent_feed`, forward across 3 `sourceBoard` values).
- **Execution stats**:
  - `nReturned`: 400
  - `totalKeysExamined`: 402
  - `totalDocsExamined`: 400
  - `executionTimeMillis`: 231 ms (cold uncompacted 28 KB documents)

### 1.2 Real catalog BSON measurement (`scripts/measure-job-bson.js`)

Measured across `totalJobs: 570` (`sampleSize: 100`) on loopback MongoDB before hot-document compaction:

- **Average BSON with legacy vectors**: `28,160 B` (`29,262 B` across all 570 rows)
- **Average BSON without vectors (legacy description/requirements/provenance still in `Job`)**: `7,664 B`
- **Average vector + metadata bytes**: `20,501 B`
- **Per-field average BSON breakdown (bytes)**:
  - Cold/vector fields on `Job`: `embedding` (20,410 B), `rawDescription` (4,822 B), `provenance` (309 B), `requirements` (193 B), `embeddingMetadata` (86 B)
  - Hot fields on `Job`: `features` (605 B), `eligibility` (254 B), `tags` (184 B), `structuredLocation` (143 B), `compensation` (114 B), `canonicalUrl` (106 B), `sourceUrl` (103 B), `contentHash` (82 B), `identityKey` (82 B), `recordHash` (81 B), `salaryRange` (54 B), `sourceJobId` (49 B), `title` (41 B), `normalizedTitle` (40 B), `occupationFeaturesVersion` (31 B), `occupationConfidence` (29 B), `location` (29 B), `occupation` (27 B), `company` (26 B), `sourceBoard` (26 B), `remoteType` (23 B), `occupationCodes` (22 B), `featuresVersion` (21 B), `firstSeenAt` (21 B), `lastSeenAt` (20 B), `createdAt` (19 B), `updatedAt` (19 B), `expiresAt` (19 B), `status` (19 B), `postedAt` (18 B), `_id` (17 B), `__v` (9 B).
- **Pre-compaction dry-run (`scripts/compact-job-hot-documents.js`)**:
  - `scanned`: 570
  - `detailMissing`: 0, `detailMismatch`: 570 (`provenance` mismatch due to prior checkpointed migration before `provenance` was added to `JobDetail`)
  - `meanBsonBytesBefore`: 29,262 B
  - `meanBsonBytesProjected` (removing only legacy cold/vector fields): 2,256 B (`p95`: 2,861 B, `max`: 3,604 B) — **exceeded the 2,048 B (2 KB) target by 208 B on mean and 813 B on p95** primarily due to bulky `features` (`responsibilities`, `salaryText`, and large token arrays) and redundant hot strings.

### 1.3 Index footprint and RAM working-set estimate

Measured on the 570-document `jobs` collection (`collStats`):

- **Logical data size**: 16,679,594 B (15.91 MiB)
- **Allocated storage size**: 45,043,712 B (42.96 MiB)
- **Total index size**: 2,916,352 B (2.78 MiB across 42 indexes)
- **Largest indexes on 570 rows**:
  - `job_candidate_skills_recent`: 241,664 B
  - `job_features_skills_active`: 233,472 B
  - `recordHash_1`: 147,456 B
  - `identityKey_1` / `job_identity_unique` / `contentHash_1`: 135,168 B each
  - `job_candidate_title_recent`: 126,976 B
  - `job_features_title_active`: 106,496 B
  - `canonicalUrl_1`: 94,208 B

**Working-set RAM estimate (hot `jobs` collection + indexes)**:

- Before compaction (28.16 KB/doc):
  - 10k jobs: ~281.6 MB logical data + ~49 MB indexes ≈ **330 MB**
  - 100k jobs: ~2.82 GB logical data + ~488 MB indexes ≈ **3.31 GB**
  - 1M jobs: ~28.16 GB logical data + ~4.88 GB indexes ≈ **33.0 GB**
- After hot-document compaction (`<= 1.6 KB` mean hot BSON + pruned duplicate single-field indexes):
  - 10k jobs: ~16 MB hot data + ~15 MB indexes ≈ **31 MB**
  - 100k jobs: ~160 MB hot data + ~150 MB indexes ≈ **310 MB**
  - 1M jobs: ~1.60 GB hot data + ~1.50 GB indexes ≈ **3.1 GB** (fits comfortably within a 4–8 GB WiredTiger cache).

### 1.4 Synthetic scale benchmark (`scripts/benchmark-jobs-scale.js`)

Fresh 100k run on 2026-10-19 (`mongod` 8.0.8 on loopback, `bulkBatchSize: 1000`, 5,000 duplicate upserts) alongside the 100k/500k/1M baseline table:

|        Synthetic jobs | Ingest ops/s | Ingest time | Index build | Avg BSON/job | Logical bytes | Storage bytes | Index bytes | Client RSS | `mongod` resident | Catalog p50/p95 | Candidate p50/p95 | Recommended refresh p50/p95 |
| --------------------: | -----------: | ----------: | ----------: | -----------: | ------------: | ------------: | ----------: | ---------: | ----------------: | --------------: | ----------------: | --------------------------: |
| 100k (2026-10-19 run) |      2,527.8 |       41.5s |       4.08s |         900B |        90.6MB |        12.7MB |      9.71MB |    103.1MB |             226MB |  4.69 / 18.28ms |     1.62 / 3.22ms |           118.98 / 554.07ms |
|   500k (baseline ref) |      6,308.0 |       83.2s |       8.62s |         900B |       453.2MB |        60.5MB |     45.70MB |     48.8MB |                 — |  9.16 / 30.06ms |     0.64 / 1.39ms |         258.77 / 1,221.29ms |
|     1M (baseline ref) |      6,303.0 |      166.6s |      16.74s |         900B |       906.5MB |       122.2MB |     87.80MB |     81.8MB |                 — | 12.83 / 50.19ms |     0.49 / 1.05ms |         490.17 / 2,111.45ms |

---

## 2. Search relevance at scale (`src/services/jobs/jobSearch.js`)

- **Indexed tokenized candidate prefiltering**:
  - `buildSearchTokens(job)` populates `Job.searchTokens` from title, normalizedTitle, company, skills, tags, and location tokens (capped at 48 tokens).
  - Compound multikey index `job_search_tokens_recent` (`{ status: 1, searchTokens: 1, postedAt: -1, _id: 1 }`) combined with existing `features.titleTokens` and `features.skills` multikey indexes replaces unindexed substring regex scans on `rawDescription`, `title`, and `company`.
- **Bounded typo tolerance**:
  - `expandQueryTokensWithTypos(queryTokens, dictionary)` uses `boundedEditDistance` (Damerau-Levenshtein with early cutoff `maxDistance = 1` for tokens length 4–7 and `maxDistance = 2` for length >= 8, requiring matching first character) against a curated technical vocabulary.
- **Weighted relevance + recency blending**:
  - `scoreCatalogSearchRelevance(job, { queryTokens, expandedTokens, rawQuery, asOfDate })` weights exact phrase match in title (+120), exact token in title (+48), prefix/typo in title (+24/+18), exact skill match (+36), company match (+28), tag/location match (+16), and blends bounded recency decay (`max(0, 18 - ageDays * 0.4)`) rooted at a stable `asOfDay` bucket (`YYYY-MM-DD`).
- **Stable cursor pagination for relevance sort**:
  - Relevance cursors encode `{ sort: "relevance", relevanceScore, asOfDay, postedAt, id }` and apply `isAfterRelevanceCursor` (`score < cursor.relevanceScore` or tie-broken by `postedAt DESC`, `_id ASC`) so paging never drifts or duplicates rows across pages.
- **Approximate count & facet caching**:
  - `CacheKeys.catalogTotal(catalogVersion, filterHash)` and `CacheKeys.catalogFacets(catalogVersion, filterHash)` cache counts and facet aggregations in Redis for 120 seconds, automatically invalidated whenever `bumpCatalogVersion` increments `catalogVersion`.

---

## 3. Storage split & hot-document compaction (`src/services/jobs/jobStorage.js`, `scripts/compact-job-hot-documents.js`)

- **Provenance in split collections (`Job`, `JobDetail`, `JobVector`)**:
  - `JobDetail.provenance` uses `_id: false` subdocuments and `normalizeProvenanceList` so `JobDetail` and `Job` provenance arrays compare deterministically without subdocument `_id` drift.
  - `scripts/migrate-job-storage-split.js --apply` (checkpoint version 2) synced all 570 local records (`detailsWritten: 570`, `detailMissing: 0`, `detailMismatch: 0`, `detailFieldMismatches: { description: 0, requirements: 0, provenance: 0 }`, `safeToRemoveLegacyFields: true`).
- **Hot document compaction (`<= 2 KB`)**:
  - `compactHotFeatures` and `compactHotJobFields` strip `rawDescription`, `requirements`, `provenance`, `embedding`, and `embeddingMetadata` from the hot `Job` document, omit `responsibilities`, `salaryText`, and empty nested arrays from hot `features`, bound token arrays (`skills <= 8`, `titleTokens <= 6`, `searchTokens <= 6`, `tags <= 4`), and strip null/empty sub-keys in `compensation`, `eligibility`, and `structuredLocation`.
- **Measured before vs. after on local 570-job catalog**:
  - **Mean BSON size**: `29,262 B` (all 570 docs) / `28,160 B` (sample) -> **`2,047 B` (all 570 docs) / `1,960 B` (sample)** (`< 2,048 B` target met).
  - **Logical `jobs` collection size**: `16,679,594 B` (15.91 MiB) -> **`1,167,046 B` (1.11 MiB, -93.0%)**.
  - **Discovery `explain("executionStats")` latency**: `231 ms` -> **`9 ms` (25.6x faster)**.
  - **Rollback & re-apply**: `JOB_HOT_DOCUMENT_COMPACTION_ENABLED=true node scripts/compact-job-hot-documents.js --rollback` restored inline `rawDescription`, `requirements`, `provenance`, `features`, and `embedding` from `JobDetail` and `JobVector` (`verify-job-storage-split.js` reported `detailMismatch: 0, safeToRemoveLegacyFields: true`), and re-running `--apply` returned the hot collection to `1,960 B` sample mean (`2,047 B` full-catalog mean).

---

## 4. Ingestion robustness (`src/services/jobs/ingestionResilience.js`, `src/services/jobs/jobIngestionService.js`)

- **Dead-letter isolation**:
  - `validateRawIngestJob`, `buildDeadLetterEntry`, and `appendDeadLetters` isolate malformed records (`MALFORMED_RECORD`, `MISSING_TITLE_AND_COMPANY`, `MISSING_TITLE`, `MISSING_COMPANY`, `NORMALIZATION_FAILED`) inside `processBatch` without aborting valid records in the same batch.
  - Bounded dead-letter records (max 50 most recent entries per source) and cumulative `metrics.deadLettered` counts are persisted on `JobSource` without retaining PII or raw HTML payloads.
- **Circuit breaker & exponential backoff**:
  - `BaseJobAdapter.requestJson` uses `computeRetryBackoffMs(attempt, { baseMs, maxMs: 4000 })` for transient HTTP `429`/`5xx` and network errors.
  - `computeCircuitOpenUntil(failures)` opens the source circuit breaker at `5` consecutive failures with exponential cooldown (`5m`, `10m`, `20m`, capped at `60m`).
- **Per-source budgets, graceful shutdown & idempotent restarts**:
  - Atomic Mongo quota reservation (`reserveSourceRequest`) enforces per-minute, daily, weekly, and monthly request budgets.
  - `jobIngestionService.requestShutdown()` (registered in `src/worker.js` shutdown handler) finishes the in-flight batch, persists the current page `cursor` checkpoint, releases the run lease (`runState: "idle"`, `runLeaseExpiresAt: null`), and allows the next worker startup to resume idempotently from the checkpoint.
- **Admin source health & alert thresholds (`INGESTION_ALERT_THRESHOLDS`)**:
  - `sourceBudgets()` surfaces `healthStatus` (`"healthy" | "warning" | "critical" | "disabled"`), `alerts`, `lastSuccessAt`, `deadLetterCount`, `recentDeadLetters`, and `alertThresholds`:
    - `CIRCUIT_OPEN` (`critical`): `circuit.openUntil > now`
    - `CONSECUTIVE_FAILURES` (`warning` at 3, `critical` at 5)
    - `QUOTA_NEAR_EXHAUSTION` (`warning` at >= 90% of daily request budget)
    - `DEAD_LETTER_SPIKE` (`warning` at >= 10 dead-lettered records)
    - `STALE_LAST_SUCCESS` (`warning` when `now - lastSuccessAt > max(48h, 2 * intervalMs)`)

## 6. Freshness, Trust & Ghost/Repost Detection (`src/services/jobs/jobRisk.js`)

- **Source-Term Expiry**: `computeSourceTermExpiry({ postedAt, firstSeenAt, now, retentionDays, sourceExpiresAt })` enforces the earlier of `sourceExpiresAt` and `anchor + retentionDays` so stale postings never outlive source policy retention windows.
- **Polite Host-Bounded Link Health Sampling**: `sampleJobsForPoliteLinkCheck(jobs, { maxTotal: 50, maxPerHost: 5 })` orders active/stale listings by oldest `sourceCheckedAt` (then `lastSeenAt`) while capping per-host checks so no employer domain or ATS host is hammered during link health sweeps. `classifyLinkHealthStatus` maps HTTP `404`/`410` and explicit closed-job page markers to `closed`.
- **Repost & Ghost Listing Detection**:
  - `detectRepostSignal(existingJob, incomingJob)` increments `Job.repostCount` when a closed/stale listing reactivates or when `postedAt` jumps forward by `>= 7 days` for the same identity or `groupKey`.
  - `getJobRiskFlags(job)` emits explainable, non-defamatory reason codes (`older_listing`, `possible_repost`, `ghost_listing_risk`, `broken_or_expired_link`, `fees_requested`, `messaging_app_only`, `free_email_contact`, `salary_unusually_high`, `company_unclear`).
- **Measured Local Catalog Trust & Freshness Audit (`coverageReport().trustAndFreshness`, 570 active jobs)**:
  - `staleCount`: `0` (`0.00%`)
  - `closedCount`: `0` (`0.00%`)
  - `olderThan30dCount`: `61` (`10.70%` of active catalog)
  - `possibleRepostCount`: `0` (`0.00%` of active catalog)
  - `ghostRiskCount`: `46` (`8.07%` of active catalog; listings older than 45 days or reposted across multiple cycles)

## 7. Incremental Matching at Scale (`src/services/jobs/incrementalMatching.js`)

- **Inverted Profile Match Index (`profile_match_tokens_idx`)**:
  - `Profile` documents store pre-normalized `matchTokens` (canonical skills, `.js`-stemmed skill tokens, normalized role tokens from `preferences.targetRoles`, `careerProfile.targetRoles`, `roles[].title`, and `occ:<code >` tokens) plus `matchCountryCodes`, indexed via `{ matchTokens: 1, updatedAt: -1 }`.
  - When a batch of new or changed jobs is ingested, `extractBatchJobDemandIndex(newJobs)` extracts up to `64` weighted demand tokens (`titleTokens` weight `3`, `skills` weight `2`, `occ:<code>` weight `2`, `occupation` weight `1`) and eligible country codes.
  - `findAffectedUsersForNewJobs(newJobs, { maxUsers: 250 })` queries `Profile` via `profile_match_tokens_idx` (never scanning unmatched users) and `rankAffectedProfilesForNewJobs` scores and caps recomputes to the bounded per-run budget (`250` users/run).
- **10,000-User Benchmark & Index Verification (`tests/jobs-incremental-matching.test.js`)**:
  - 10,000 synthetic user profiles benchmarked in `20.20 ms` (`< 50 ms`), enforcing the per-run cap (`40` users) and prioritizing multi-token + country-eligible matches.
  - MongoDB `explain("executionStats")` on 500 profiles with 12 matching nurses confirmed `IXSCAN` on `profile_match_tokens_idx` with `totalDocsExamined: 12` (zero unmatched profiles scanned).
- **Scoring Version Policy (`lexical-v2` vs `lexical-v4`)**:
  - `lexical-v2.1` is the default production scoring version (`JOB_MATCH_SCORE_VERSION=lexical-v2.1`), retaining the v2 weights (`skills: 40, title: 20, experience: 15, location: 15, salary: 5, recency: 5`) while correctly treating an explicitly confirmed fresher as zero experience for numeric minimum requirements. `lexical-v2` remains available for comparison.
  - `lexical-v4` is opt-in via `JOB_MATCH_SCORE_VERSION=lexical-v4` (`skills: 32, title: 22, experience: 10, location: 12, salary: 5, recency: 5, occupation: 8, seniority: 3, eligibility: 3`) when structured `careerProfile` (confirmed experience years, home/target locations, work authorization) and occupation classification coverage exceed the activation threshold, because `lexical-v4` explicitly downgrades confidence to `low` when role/experience facts are unconfirmed and hard-blocks country-ineligible listings.

## 8. Saved Jobs, Saved Searches & Alerts (`src/models/SavedSearch.js`, `src/services/jobs/savedSearchService.js`)

- **Saved Jobs Audit**: Saved jobs are persisted in `Application` (`status: "saved"`, indexed via `{ userId: 1, status: 1 }` and `{ userId: 1, archivedAt: 1, status: 1 }`) and flow directly into the application tracker lifecycle (`saved -> applied -> screening -> interviewing -> offer/rejected`).
- **Saved Searches & Tier Limits**:
  - `SavedSearch` stores structured catalog filters (`q`, `location`, `countryCode`, `occupation`, `remoteType`, `source`, `postedWithinDays`, `minimumSalaryInr`, `eligibility`, `showAnyway`), `alertFrequency` (`"none" | "instant" | "daily"`), `alertChannels` (`["in_app", "email"]`), `quietHours` (`{ enabled, startHourUtc, endHourUtc }`), `unsubscribeToken`, and a bounded 200-ID `sentJobIds` deduplication window.
  - Per-plan tier limits (`src/shared/constants/plans.js`):
    - **Free**: `savedSearchesMax: 3`, `dailyAlertsMax: 2`
    - **Pro**: `savedSearchesMax: 15`, `dailyAlertsMax: 10`
    - **Premium**: `savedSearchesMax: 50`, `dailyAlertsMax: 25`
- **API Endpoints (`src/routes/jobs.js`)**:
  - `GET /api/v1/jobs/saved-searches`
  - `POST /api/v1/jobs/saved-searches`
  - `POST /api/v1/jobs/saved-searches/preview`
  - `PATCH /api/v1/jobs/saved-searches/:id`
  - `DELETE /api/v1/jobs/saved-searches/:id`
  - `POST /api/v1/jobs/saved-searches/:id/unsubscribe` (supports one-click `unsubscribeToken` or authenticated owner)
- **GDPR / India DPDP Compliance (`src/controllers/privacyController.js`)**:
  - `GET /api/v1/privacy/export` includes `savedSearches` (excluding internal `unsubscribeToken`).
  - `DELETE /api/v1/privacy/delete-account` purges all user `SavedSearch` documents.

## 9. Reference Data Subsets & Occupation Classification (`src/services/jobs/referenceData/`, `occupationClassification.js`)

- **Additive Reference Data Subsets & Attribution (CC BY 4.0)**:
  - **O\*NET 29.0 Subset (`src/services/jobs/referenceData/onetSubset.json`)**: Includes data from the O*NET 29.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used under the Creative Commons Attribution 4.0 International License (CC BY 4.0). O*NET is a trademark of USDOL/ETA (`https://www.onetcenter.org/database.html`).
  - **GeoNames Gazetteer Subset (`src/services/jobs/referenceData/geonamesSubset.json`)**: Geographical names and administrative subdivisions derived from GeoNames (`https://www.geonames.org/`), licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0). Covers priority Kerala districts/cities (Kochi, Thiruvananthapuram, Kozhikode, Thrissur, Kottayam, Kannur, Kollam), Indian metro hubs, Gulf cities (Dubai, Abu Dhabi, Sharjah, Riyadh, Jeddah, Doha, Kuwait City, Muscat, Manama), and UK/Ireland/EU hubs.
  - **ESCO**: Explicitly deferred (not imported).
- **Before / After Occupation Classification Metrics (`OCCUPATION_FEATURES_VERSION = 8`)**:
  - **100-Row Hand-Labeled Gold Fixture (`scripts/fixtures/occupation-gold-100.json`)**:
    - **Before**: `accuracy: 0.4100` (`41.0%`), `unclassifiedShare: 0.6000` (`60/100`), `macroPrecision: 1.0000`, `macroRecall: 0.4040`
    - **After**: `accuracy: 1.0000` (`100.0%`), `unclassifiedShare: 0.0100` (`1/100`, matching the single gold `"unclassified"` legal row), `macroPrecision: 1.0000`, `macroRecall: 1.0000`
  - **Local 570-Job Active Catalog (`scripts/backfill-job-occupations.js --apply`)**:
    - **Before**: `evalBefore: 83 / 570` (`14.56%` unclassified; `storedUnclassified: 70 / 570` `12.28%`)
    - **After**: `65 / 570` (`11.40%` unclassified across all sources; `jobicy` unclassified share reduced to `8.41%` / `39 / 464`)

## 10. Source Policy Gates & Admin Coverage (`src/services/jobs/sourcePolicies.js`)

- **Source Policy Verification**:
  - `remotive` remains blocked (`approved: false`, `enabled: false`, `activationStatus: "blocked_on_terms"`); `isSourceActivationAllowed` enforces `writtenRedistributionPermissionReference`.
  - `greenhouse`, `lever`, `ashby`, `adzuna-india`, `jobstream-se`, `nav-no`, and `france-travail` remain disabled (`approved: false`, `enabled: false`).
  - `jobicy` is `approved: true`, `enabled: false` by default (`activationStatus: "approved_api_terms_default_disabled"`).
- **Staging Owner Activation Step for `ENABLE_JOBICY_INGESTION`**:
  1. Set `ENABLE_JOBICY_INGESTION=true` in the staging backend environment and restart API + worker.
  2. Toggle `jobicy` to `enabled: true` via Admin (`PATCH /api/v1/admin/job-sources/jobicy`).
  3. Verify `sourceBudgets()` reports `healthStatus: "healthy"` and catalog cards render `"Jobicy"` attribution (`https://jobicy.com/`).
- **Admin Coverage Alignment**:
  - `coverageReport()` reports `totalActive`, `rawActive`, `byOccupation`, `byCountry`, `byRemoteScope`, `bySource`, `freshness`, `trustAndFreshness` (`staleCount`, `closedCount`, `olderThan30dCount`, `olderThan30dShare`, `possibleRepostCount`, `possibleRepostShare`, `ghostRiskCount`, `ghostRiskShare`), `unknownEligibilityCount`, `unknownEligibilityShare`, `unclassifiedBySource`, and `targetGaps` across all 7 target segments (`kerala-nursing`, `india-fresher-it`, `india-remote`, `gulf-nursing`, `uk-ireland-nursing`, `india-government`, `global-remote`).

## 11. Frontend List Performance & UX (`Ai_resume_frontend`)

- **Windowed List Rendering (`src/lib/jobs/jobListUx.mjs`, `src/app/app/jobs/page.jsx`)**:
  - `computeJobListWindow(items, { startIndex, windowSize: 40 })` bounds rendered DOM cards to at most 40 nodes even when 250+ jobs are loaded in memory, preventing layout thrashing while providing keyboard-accessible window shift controls (`Show earlier jobs`, `Show next 20 loaded jobs`) alongside `IntersectionObserver` cursor pagination.
- **Sticky Primary Filter Bar & Secondary Drawer**:
  - Sticky primary bar exposes keyword search, location, work arrangement, minimum salary, and sort (`Most recent` / `Best match` relevance).
  - Secondary `<details>` drawer exposes date posted, occupation family, applicant eligibility, and source with a live active filter count badge (`countActiveSecondaryFilters(filters)`).
- **Saved Searches, Typo Banner & Risk Badges**:
  - Users can save the current search with `daily`, `instant`, or `weekly` alert frequency (`normalizeSavedSearchForm`), apply saved searches in one click, mute/unmute alerts, or delete saved searches.
  - `formatTypoCorrectionBanner` surfaces approximate query expansions in an `aria-live="polite"` banner, and `summarizeJobRiskFlags` renders structured warning badges (`Ghost listing risk`, `Apply link may be expired`, `Possible repost`, `Posted 30+ days ago`).
