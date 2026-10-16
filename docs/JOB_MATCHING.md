# Jobs discovery and matching — verified report

Verified against backend commit `a519e3673d2e02c2ab556d71296db57167544713` on 2026-10-16. The development MongoDB inspection was read-only; no profile text, identifiers, or job descriptions are included.

## Real profile diagnostics

The sampled dev profile contains 43 skills, 0 role facts, 1 education fact, 1 target-role preference, 1 preferred-location string, and 0 preferred country codes. Fields read by matching are `skills[].name`, `roles[].title`, `roles[].years/startDate/endDate/isCurrent`, `preferences.targetRoles[]`, `preferences.preferredLocations[]`, `preferences.preferredCountryCodes[]`, `preferences.remotePreference`, and `preferences.minimumSalaryUsd`.

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

## Why 852 became 400

852 was an earlier catalog observation that included 4 mock-public-board records. That mock source is not in the enabled source list now, so the current enabled active catalog is 848 (744 + 99 + 5). The retrieval cap is 400 scored candidates, applied after active/expiry/source and profile eligibility constraints; it is not the count remaining after status/date filtering. Of those 400, 20 ranked lexically and 380 filled remaining slots by recency. The query used IXSCAN and FETCH in the development explain plan: 849 keys examined, 848 documents examined, 20 lexical matches returned before the recency fallback. The aggregation computes a small relevance expression and sorts the matched rows; at this catalog size Mongo examined nearly all active documents. Re-run explain as catalog size grows.

The Mongo integration fixture has 421 jobs: one older strongly relevant frontend job plus 420 newer partial-match jobs. Retrieval returns at most 400 and retains the older relevant job ahead of the irrelevant newer records.

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

Remotive is enabled/approved, with a 6-hour interval and daily request quota of 4. Its last successful run was `2026-10-16T09:31:01Z`; next eligible time by the source run interval is `2026-10-16T15:31:00.620Z`. The worker registers approved enabled sources as BullMQ repeat jobs (`every: intervalMs`), but this code does not guarantee a same-second invocation at the eligibility timestamp: the next repeat tick depends on when the worker registered the schedule, and requires Redis plus a running worker. Scheduler runtime state was not verified here. A fixture normalization test passed. The live catalog still has 5 Remotive active records (5 total); the referenced 9 missing job identities were not supplied, so restoration cannot be verified and no premature live ingestion was forced.

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
