# Jobs discovery and matching — verified report

Measured on 2026-10-16 against backend commit `d089af6` plus the uncommitted Part A retrieval changes in this review. The development MongoDB inspection emitted aggregate counts and query plans only; no profile text, identifiers, or job descriptions are included.

## Real profile diagnostics

The sampled dev profile contains 43 skills, 0 role facts, 1 education fact, 1 target-role preference, 1 preferred-location string, and 0 preferred country codes. Fields read by matching are `skills[].name`, `roles[].title`, optional legacy `roles[].years`, `roles[].startDate/endDate/isCurrent`, `preferences.targetRoles[]`, `preferences.preferredLocations[]`, `preferences.preferredCountryCodes[]`, `preferences.remotePreference`, and `preferences.minimumSalaryUsd`. `years` is read defensively but is not declared in the current Profile role schema; matching can derive it from role dates.

The enabled active catalog contains 848 unexpired jobs: Jobicy 744, Remote OK 99, Remotive 5. The occupation heuristic classified 800 as other/uncategorized, 17 as data analyst, 12 as accountant, 12 as backend, 5 as frontend, and 2 as teacher. Nursing did not appear in this catalog sample. The class counts sum to 848.

Retrieval took the top 20 lexical candidates plus the 380 most recent eligible fallback candidates (400 cap); location tiering left 392 scored candidates. The score histogram is:

| Score | Candidates |
| ----- | ---------: |
| 0–9   |          0 |
| 10–19 |          0 |
| 20–29 |        377 |
| 30–39 |          5 |
| 40–49 |         10 |
| 50–59 |          0 |
| 60–69 |          0 |
| 70–79 |          0 |
| 80–89 |          0 |
| 90–99 |          0 |

No candidate clears the Fair threshold of 50. The evidence points to catalog/profile mismatch: there are no structured role facts, the catalog's occupation extraction is mostly uncategorized, and the profile has no country-code constraint. The current diagnostic did not produce a high-confidence role correction, so a typo is not claimed as the real cause. I did not adjust weights to force matches. The accepted Fair boundary is 50; low scores remain visible with reasons and profile/catalog actions.

| Rank | Job title                                                            | Source    | Score | Breakdown (skills/title/experience/location/salary/recency) |
| ---: | -------------------------------------------------------------------- | --------- | ----: | ----------------------------------------------------------- |
|    1 | Frontend Engineer                                                    | Remote OK |    46 | .571 / 0 / .55 / .70 / .60 / .35                            |
|    2 | Senior Software Engineer (Full Stack \| Node.js & React \| AI Focus) | Jobicy    |    44 | .50 / 0 / .55 / .70 / .60 / .35                             |
|    3 | Application Support / SQL - (12 Month Maternity-leave Contract)      | Jobicy    |    44 | .50 / 0 / .55 / .70 / .60 / .35                             |
|    4 | Senior Backend Engineer                                              | Jobicy    |    44 | .50 / 0 / .55 / .70 / .60 / .35                             |
|    5 | Senior Infrastructure Engineer                                       | Jobicy    |    44 | .50 / 0 / .55 / .70 / .60 / .35                             |
|    6 | AI Senior Engineer (Graph)                                           | Jobicy    |    44 | .50 / 0 / .55 / .70 / .60 / .35                             |
|    7 | Blockchain Security Expert - Chain Security Evaluation Track         | Jobicy    |    44 | .50 / 0 / .55 / .70 / .60 / .35                             |
|    8 | Senior Fullstack Engineer (BR based only)                            | Jobicy    |    44 | .50 / 0 / .55 / .70 / .60 / .35                             |
|    9 | Staff DevOps Engineer                                                | Jobicy    |    44 | .50 / 0 / .55 / .70 / .60 / .35                             |
|   10 | Math Content Teacher - Mandarin Speaking Required                    | Jobicy    |    41 | 0 / .85 / .55 / .70 / .60 / .35                             |

## Indexed candidate retrieval

The current catalog is 848 active and unexpired listings (744 Jobicy, 99 Remote OK, 5 Remotive); the earlier 852 count included four mock-board records. The query first applies active status, expiry, approved/enabled source, and any structured work-mode/country/salary constraints. It then runs two bounded multikey lookups:

```text
role query:  features.titleTokens IN normalized role tokens OR occupationCodes IN profile occupation codes
skill query: features.skills IN canonical profile skills
each lexical branch: limit 400, no per-branch sort; merge/dedupe and relevance-sort in memory, then cap at 400
fallback: remaining candidates from job_candidate_recent_feed ordered by postedAt descending and _id ascending
```

The old aggregation examined 848 documents and 849 keys to return 20 lexical rows before the 380-row fallback. Its `IXSCAN` still had to fetch and score nearly the whole 848-job catalog. After the change, the real catalog explain reported:

| Query branch             | Winning plan                                                       | Returned | Documents examined | Keys examined |
| ------------------------ | ------------------------------------------------------------------ | -------: | -----------------: | ------------: |
| Role/title/occupation    | `LIMIT → PROJECTION_SIMPLE → FETCH → IXSCAN (job_candidate_title_recent)` |        1 |                  1 |             3 |
| Skills                   | `LIMIT → PROJECTION_SIMPLE → FETCH → IXSCAN (job_candidate_skills_recent)` |       19 |                 22 |            72 |
| Recent fallback          | `LIMIT → PROJECTION_SIMPLE → FETCH → SORT_MERGE → 3 IXSCAN (job_candidate_recent_feed)` |      380 |                380 |           387 |
| **Branch totals**        | Three separate explain executions                                 |  **400** |            **403** |       **462** |

The earlier version of this report incorrectly said the fallback examined zero documents and summed only the lexical branches. That was wrong: fallback projects full job fields that are not covered by `job_candidate_recent_feed`, so MongoDB fetches 380 documents. The 400 final rows are produced by 20 relevance-ranked lexical rows plus 380 recency rows; the explain counters are per independent query and sum to 403 documents examined and 462 keys examined. This is 1.01 examined documents per returned candidate, within the 3x target. The three fallback index scans returned 375, 6 and 1 rows, examined 378, 7 and 2 keys, then `SORT_MERGE` combined them before the FETCH and projection. No query values or job IDs are included here because query terms derive from a user's profile.

### Recent fallback cap and payload reduction

The recent-only filler is capped at 100 by default (`JOBS_RECENT_FALLBACK_LIMIT`, integer range 0–400). It uses a dedicated projection that excludes `rawDescription`, `embedding`, `embeddingMetadata`, and any raw payload. The overall candidate cap remains 400. Lexical candidates remain separately ranked and are not counted against the recent fallback cap until filling the remaining slots.

Before this change, the local dev profile-shaped query returned 400 candidate documents (20 lexical + 380 recent); serialized candidate JSON was 15,866,759 bytes total, including 15,098,195 bytes for fallback rows. After the change, the same query returned 120 documents (20 lexical + 100 recent); serialized candidate JSON was 912,903 bytes total, including 144,339 bytes for fallback rows. This is a reduction of about 94.2% for the serialized candidate documents (not a measured HTTP response body).

The old branch explains examined 403 documents / 462 keys across the separate role, skill and fallback operations. After the cap, the same profile-shaped path examined 123 documents / 179 keys in total: role and skill branches remained at 1 and 22 docs examined, while the recent fallback examined 100 documents / 104 keys. At the 100-row fallback limit, the bounded recent query examined one document per returned fallback candidate. All measurements were read-only against the local development catalog; no profile terms or job identifiers were emitted.

Winning plan and execution-stage outline for each branch (MongoDB 8 `executionStats`, profile values omitted):

The redacted full MongoDB explain trees, including winning/rejected plans and execution stages, are in [JOB_MATCHING_EXPLAIN.json](./JOB_MATCHING_EXPLAIN.json). Profile-derived literals, job IDs, filters, and index bounds are removed; execution counters and plan structure are retained.

```text
role/title/occupation
winningPlan: LIMIT → PROJECTION_SIMPLE → FETCH → IXSCAN(job_candidate_title_recent)
executionStats: nReturned=1, totalDocsExamined=1, totalKeysExamined=3, executionTimeMillis=3
executionStages: LIMIT(1) → PROJECTION_SIMPLE(1) → FETCH(docsExamined=1) → IXSCAN(nReturned=1, keysExamined=3)

skills
winningPlan: LIMIT → PROJECTION_SIMPLE → FETCH → IXSCAN(job_candidate_skills_recent)
executionStats: nReturned=19, totalDocsExamined=22, totalKeysExamined=72, executionTimeMillis=6
executionStages: LIMIT(19) → PROJECTION_SIMPLE(19) → FETCH(docsExamined=22) → IXSCAN(nReturned=22, keysExamined=72)

recent fallback
winningPlan: LIMIT → PROJECTION_SIMPLE → FETCH → SORT_MERGE → 3 × IXSCAN(job_candidate_recent_feed)
executionStats: nReturned=380, totalDocsExamined=380, totalKeysExamined=387, executionTimeMillis=38
executionStages: LIMIT(380) → PROJECTION_SIMPLE(380) → FETCH(docsExamined=380)
  → SORT_MERGE(postedAt DESC, _id ASC)
    → IXSCAN(nReturned=375, keysExamined=378)
    → IXSCAN(nReturned=6, keysExamined=7)
    → IXSCAN(nReturned=1, keysExamined=2)
```

A warm end-to-end `getCandidateJobs` call took 604 ms locally, including catalog counts and candidate retrieval. Timings are one local sample, not a production latency guarantee.

The synthetic 100k-job fixture used 90k broad skill matches and 1k title matches:

| Plan                              |                               Result rows |   Documents examined | Keys examined |
| --------------------------------- | ----------------------------------------: | -------------------: | ------------: |
| Old score/sort pipeline           | 400 after sort (91k matched before limit) |              100,000 |       200,000 |
| New bounded skill + title lookups |                         400 candidate cap | 800 (400 per branch) |           800 |

Both new branches used their named multikey indexes. A warm in-memory retrieval sample took 587 ms. The benchmark confirms bounded documents examined at 100k for this broad-match fixture; it does not model every possible term distribution or database hardware.

Added indexes are declared in `src/models/Job.js` and included in the existing index/migration scripts: skills, title tokens, occupation codes, and eligible country codes, each separated because MongoDB cannot compound multiple array fields in one index. Existing recent/location indexes remain for status, source, country and posted-date fallback paths. No catalog documents or embeddings were changed by the index work.

The Mongo integration fixture has 421 jobs: one older strongly relevant frontend job plus 420 newer partial-match jobs. Retrieval returns at most 400 and retains the older relevant job ahead of the irrelevant newer records because the precise title lookup is scored in the bounded union before recency fallback.

## Score behavior and product feedback

Scoring is deterministic (`lexical-v3`), with weights: skill overlap 40, role-title similarity 20, experience 15, location 15, salary 5, recency 5. Bands are Low <50, Fair 50–64, Good 65–79, Strong 80+. Retrieval role normalization is limited to an explicit alias catalog and high-confidence edit-distance suggestions; a proposed correction is shown to the user and must be confirmed before preferences are changed. Missing target roles may be prefilled from saved role facts or resume facts. No LLM or vector ranking is used in the matching hot path.

When no result reaches 50, Recommended shows “No strong matches yet. Here are the closest roles”, the best score and available missing-skill/profile context, plus links to review profile/role facts or browse the indexed job catalog. The frontend reflects the 50+ Fair cutoff.

## Storage measurement and options

For 848 active jobs, the measured average BSON document was 28,807 bytes (max 42,740). Average components: `rawDescription` 6,174 bytes; `features` 515 bytes; `embedding` 20,415 bytes (average dimension 1,536); stored `rawPayload` field: 0 records. BSON size is the logical uncompressed document size; Mongo storage compression, indexes, replication, and provider charges are not included.

| Option                                                            |                       Estimated per job |  At 10k |  At 100k |    At 1M | Trade-off                                                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------: | ------: | -------: | -------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| Stop persisting the current 1,536-dimension vector                |                           save ~20.4 KB | ~204 MB | ~2.04 GB | ~20.4 GB | No vector re-rank; consistent with current deterministic matching. New ingestion only; do not delete old vectors without approval. |
| 512-dimension vectors (linear estimate from measured vector BSON) |                save ~13.6 KB vs current | ~136 MB | ~1.36 GB | ~13.6 GB | About one third of current vector bytes; semantic quality must be evaluated before adoption.                                       |
| Separate vector collection                                        |                    no total BSON saving |       0 |        0 |        0 | Keeps vectors out of ordinary job documents and permits independent indexing/retention; extra collection and joins/lookup work.    |
| TTL raw payload                                                   | currently 0 bytes stored by this schema |       0 |        0 |        0 | No current raw-payload field to expire; `rawDescription` is separate and source-retention governed.                                |

List and search queries exclude `embedding` and `rawPayload`; detail/recommendation paths select fields explicitly where needed. The current deterministic discovery path does not need vectors, but the ingestion flow still creates vectors for changed jobs and the memory feature uses vectors. Old vectors are preserved; no storage migration was run. A vector removal or re-embedding migration needs an additive report, a versioned shadow field/collection, quality comparison, staged backfill, and rollback before approval.

## Source repair status

Remotive is enabled/approved, with a 6-hour interval and daily request quota of 4. Its registry showed `lastRunAt=2026-10-16T09:31:00.620Z`, `lastSuccessAt=2026-10-16T09:31:01.073Z`, and cumulative metrics of 14 fetched/created, 0 updated/duplicate/error. At the read time, 5 Remotive records remained active and present. The source run guard therefore next permits an attempt at `2026-10-16T15:31:00.620Z` (21:01 IST). `src/worker.js` registers `ingest:remotive` with BullMQ `repeat.every=21600000` and job ID `scheduled-remotive` after Redis is ready; a repeat tick is not guaranteed to fire at the exact eligibility second, and the registered Redis schedule was not inspected. The adapter fixture test passes. The nine expected identities were not provided; the difference between cumulative-created count and current records does not identify which records are missing or why. No live ingestion was triggered before the eligible time, and restoration of those nine identities remains unverified.

## Repository strategy (proposal only)

The backend is a Git repository on `feat/applications-tracker-phase-2`; the sibling frontend has no Git metadata. A monorepo gives atomic UI/API contract changes and shared CI but requires moving the backend's Git root/history carefully and agreeing on ownership/deployment boundaries. Two repositories preserve the existing backend history and deployment separation, but require API-contract coordination and independent CI. For the current setup, keep two repositories until the frontend is initialized as a Git repository; then choose based on deployment ownership. To move Jobs work without losing backend history, create a feature branch from the current backend branch, keep the commit series, and cherry-pick or merge that branch after review. No repository was moved and no branch was created for the frontend because it has no Git history to preserve.

## 10-minute Jobs manual QA

1. Open `/app/jobs`; confirm catalog disclaimer, indexed source counts, source labels, and posted-date availability.
2. Search title/company/skill, filter location and work mode, then change sort and page; ensure list and total respond.
3. Open a job detail; confirm source attribution, posted date or unavailable label, apply action, and tracker option.
4. Open Recommended; confirm band icon + text, score/reasons, and low matches are visible.
5. With no score >=50, confirm the closest-match explanation and profile/catalog actions are present.
6. Change target role to a deliberate misspelling in a test profile; verify a suggested canonical role is offered and nothing is saved until Use/Confirm.
7. Clear target roles while retaining resume role facts; verify a role prefill suggestion is available.
8. At 375px, verify no horizontal page overflow and job action buttons remain reachable; repeat at 768 and 1280px.
9. Test keyboard focus, Enter/Space activation, and light/dark contrast; check source links open the expected site.
10. With worker/Redis stopped, refresh Recommended and confirm a useful local deterministic result or clear retry state, without an external ingestion request.
# 2026-10-16 scoring comparison

Generated by `npm run eval:match-versions` with the configured lexical-v2 and explicit lexical-v3 implementations. We keep v2 active: one existing fixture regressed, and only one of three new profile-shaped fixtures improved. No weights were changed.

| Fixture | v2 | v3 | Delta |
|---|---:|---:|---:|
| Existing nurse | 95 strong | 95 strong | 0 |
| Existing accountant | 88 strong | 88 strong | 0 |
| Existing teacher | 88 strong | 88 strong | 0 |
| Existing frontend | 81 strong | 81 strong | 0 |
| Existing pharmacist | 86 strong | 86 strong | 0 |
| Existing civil engineer | 86 strong | 86 strong | 0 |
| Existing HR | 76 good | 76 good | 0 |
| Existing designer | 86 strong | 86 strong | 0 |
| Existing marketing | 86 strong | 86 strong | 0 |
| Existing business analyst | 86 strong | 83 strong | -3 |
| Existing DevOps | 86 strong | 86 strong | 0 |
| Existing project manager | 86 strong | 86 strong | 0 |
| Existing customer support | 86 strong | 86 strong | 0 |
| Existing data analyst | 86 strong | 86 strong | 0 |
| Existing backend | 86 strong | 86 strong | 0 |
| New resume typo / no roles | 46 fair | 56 fair | +10 |
| New ICU nurse | 85 strong | 85 strong | 0 |
| New delivery associate | 78 good | 78 good | 0 |

The default env flag is `JOB_MATCH_SCORE_VERSION=lexical-v2`; changing it to v3 is not approved by this gate yet.
