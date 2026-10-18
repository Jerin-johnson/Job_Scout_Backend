# Job catalog ingestion (Phases 1–2)

## Scope and coverage

The catalog contains listings indexed from approved feeds, not every job on the internet. Currently approved sources are Remote OK, Remotive, and Jobicy. Remote OK listing pages must link back to Remote OK; Remotive requires its source attribution and original job link and says its public feed is delayed 24 hours; Jobicy requires its source and canonical job URL, and its public feed covers listings published in the last seven days. Source terms and verification dates are stored in the source registry and checked before ingestion or enabling.

Held sources (Jooble, Arbeitnow, Careerjet, Findwork, Reed, The Muse, EURES, Naukri, Indeed, LinkedIn, Glassdoor) are not connected or scraped. Adzuna India remains a pilot only and is not enabled. Sweden sources remain unverified and disabled. Partnership outreach stays with the product owner.

The app labels each listing with source and posted date. Public source text is configurable via `JobSource.attributionText` and `attributionUrl`.

## Source registry and adapter contract

`JobSource` stores the kill switch (`enabled`), explicit approval (`approved`), safe adapter module name, terms URL and verification date, attribution, retention/stale windows, daily quota and cadence, request cursor/conditional headers, current demand query position, run lease/state, circuit breaker state, and ingestion/coverage metrics. New records default disabled and unapproved. A record is eligible only when legal metadata, verification date, quota, adapter module and approval are complete.

Each adapter extends `BaseJobAdapter` and declares supported fields/capabilities, timeout, retry cap, paging, status checks, and demand search. Adding a feed requires an adapter file plus a registry record containing the reviewed terms and safe adapter filename; do not enable it until the owner has approved it. The filename is restricted to a local `*Adapter.js` module.

Retries are limited to 429, 5xx, and network failures; abort timeouts are not retried. Every actual HTTP attempt reserves a quota unit. Each source has a persisted circuit breaker, and scheduled runs use a Mongo lease so multiple workers cannot run the same source at once.

### Approved source budgets

| Source | Public API cadence | Internal cap | Retention / stale rule | Attribution |
| --- | --- | ---: | --- | --- |
| Remote OK | Full feed once per day | 1 request/day | 30-day storage cap; stale after 14 days unseen | “Remote OK” link to Remote OK |
| Remotive | Up to every 6 hours | 4 requests/day | 14-day storage cap; stale after 7 days unseen | “Remotive” and original job link |
| Jobicy | No new sync more than hourly | 24 requests/day | 14-day storage cap; source feed expires jobs after 7 days; stale after 7 days unseen | “Jobicy” and canonical job URL |

These are conservative app-side caps, not provider guarantees. Registry counters reset on UTC midnight. Jobicy public cursors are persisted and resumed; an expired cursor response restarts traversal. Conditional ETags are used only when a query matches the stored validator.

## Demand and scheduled ingestion

Discovery never fetches feeds. BullMQ repeat jobs run source ingestion; the local `dev:stack` starts the API, worker, and web app together. Role/location terms are aggregated from profile preferences in MongoDB with a minimum count of three, so no individual preference or user ID is exposed to the source query planner. The term list is cached in existing Redis for six hours; if aggregation is unavailable, ingestion falls back to a broad feed fetch. Remotive uses its documented `search` parameter and Jobicy uses its documented `tag` filter for demand scans. A full unfiltered sync is still performed at least every 24 hours (and resumed across pages) for stale detection and coverage; source daily quotas remain the hard ceiling. Remote OK currently has no demand query in its feed adapter, so its daily request remains broad.

Matching reads `Match` records only. `POST /api/v1/jobs/discover` queues a user/profile-version keyed match refresh; requests coalesce while active, use a 30-second cooldown after completion, and run on the existing BullMQ worker. Profile preference/resume updates and newly indexed jobs queue refreshes for recently changed profiles. Completed refreshes invalidate the match-response cache. If Redis is unavailable, auto-refresh status is recorded as failed and user initiated refresh receives a retryable queue error. No new queue service or database was added.

For development, `npm run jobs:schedule:report` reads MongoDB source records and BullMQ repeatable jobs in Redis and prints each source's registration status and actual next scheduled timestamp. It is read-only and does not start the worker or create schedules. A missing schedule is reported as `not_registered`; start the existing worker to register repeat jobs. `JOBS_RECENT_FALLBACK_LIMIT` caps the recent-candidate filler (default 100; 0–400) without reducing the separate lexical candidate pool.

The admin source panel shows cap, use/remaining, current active indexed count, last and next run times, run state, latency, fetched/new/updated/duplicate/error counts, and coverage from the last full sync. Query quotas are reserved atomically in MongoDB; paid overage is not possible. `npm run jobs:ingest:source -- remotive` (or another approved source key) is a local diagnostic CLI and refuses production. There is no user-facing ingest endpoint.

## Normalized records and dedupe

New fields are additive: `identityKey`, `sourceJobId`, `canonicalUrl`, `structuredLocation`, `compensation`, `provenance`, `status`, `firstSeenAt`, `lastSeenAt`, `sourceExpiresAt`, `sourceCheckedAt`, `occupationCodes`, `recordHash`, and `embeddingMetadata`. Existing `salaryRange`, `sourceBoard`, `sourceUrl`, and other legacy fields remain populated for compatibility. Unknown salary/currency/location information remains unknown; the system does not invent USD conversions.

Identity is `(source, sourceJobId)`, then `(source, canonicalUrl)`, then `(source, normalized company/title/location)`. Embedding similarity is never used to merge records. `recordHash` detects any matching-relevant catalog field changes; `contentHash` covers the text actually sent to the embedding model. Descriptions are converted to bounded plain text (24,000 characters maximum). No whole raw feed payload is persisted.

Older deployments may still have a globally unique `contentHash_1` index. Run `npm run ensure-indexes` once after upgrading; it drops only that obsolete unique index and recreates `contentHash` as a non-unique lookup index. This prevents matching content from different feeds from rejecting writes while preserving source-specific `identityKey` uniqueness. No documents are deleted or merged.

Existing vectors missing provider/model/dimension metadata are labeled `legacy/unknown` at read time and are not deleted or silently re-embedded. A future re-embedding operation would need to:

1. Select one provider/model/dimension version and create a versioned cache/key namespace.
2. Batch and rate-limit work by source; estimate full token cost first and exclude expired records.
3. Write new vectors and metadata side by side while preserving the old vector/hash for rollback.
4. Compare match-quality evaluation sets and storage/latency before switching reads.
5. Remove the old vector only after approval and a verified rollback window.

## Indexes and retrieval

The candidate path applies active/expiry, country or eligible-country/worldwide, work mode, occupation family, and known USD annual salary filters before returning at most 400 candidates. Free-text preferred location is not a hard filter. Matches are ranked through four available-supply tiers: exact/alias location, regional/state/country, remote eligible or unknown eligibility, then worldwide remote. Unknown eligibility is explicitly labeled for the user to verify; jobs explicitly excluding a selected country are filtered when country data is available. The discovery graph requests at most 300 and scores deterministically; it does not call ingestion or an LLM. Mongo match persistence uses one unordered `bulkWrite` for up to ten results instead of one upsert per result (10 round trips down to 1). Unknown salary is retained rather than incorrectly excluding a potentially suitable job. Legacy salary fields are used as a fallback when new compensation metadata is absent.

Recommended cards show a provisional 0–100 score only from the existing deterministic score: Strong (80+), Good (65–79), Fair (50–64); scores below 50 are hidden. Matched skills are listed. This is explicitly an interim estimate, not the Phase 3 explainable score engine. Source and posted-date labels are shown for each card. Feed adapters preserve source publication dates; for legacy records without a known date, records within five minutes of `createdAt` are treated as potentially default-generated and shown as “Posted date unavailable.”

Indexes include:

- `job_identity_unique`: sparse unique identity key.
- `job_candidate_location_mode`: status + country + work mode + expiry + posted date.
- `job_candidate_recent_feed`: status + source + posted date + ID + expiry, supporting a recent-first bounded scan across approved feeds.
- `job_candidate_active_recent` and `job_candidate_occupation`.
- `job_source_coverage`: source + status + expiry for periodic coverage metrics.
- Existing `expiresAt` TTL index.

Use `npm run jobs:discovery:explain` for a read-only local explain of the active approved-source query. Current local explain: `job_candidate_recent_feed` index, SORT_MERGE, 400 returned, 402 keys examined, 400 documents examined, 59ms. The integration test uses a hint to verify the structured compound index exists and is usable. Recheck winning plan and docs examined/returned as the catalog grows.

## Migration and rollback

The migration is additive and never changes/deletes stored embeddings. `--report` scans the current collection and reports total documents and identity collisions without writing. It refuses to apply if source identity collisions exist, rather than silently deleting or merging records.

```bash
npm run jobs:migrate:report
npm run jobs:migrate:apply
npm run ensure-indexes
```

Before migration, take the normal Mongo snapshot/backup required for production. The script stores each old `contentHash` in `jobs_phase1_content_hash_backup`, backs up any conflicting same-name index definition in `jobs_phase1_index_backup`, adds normalized fields/indexes, and preserves all other original fields. Rollback:

```bash
npm run jobs:migrate:rollback
```

Rollback disables the newly approved source records, restores original content hashes and any replaced index definition, and removes the unique identity index. It deliberately retains additive fields/indexes and the backup collections so no catalog data is discarded. Remove backups only after a verified backup and explicit owner approval.

## Measured storage and vector trade-off

An earlier representative-document estimate used a 2,000-character description and a 1,536-element numeric vector: 22,896 bytes/job old shape and 23,738 bytes/job additive shape. A current local sample of 100 active records measured 28,160 BSON bytes/job with legacy vectors and 7,664 bytes/job after projecting vectors out; the measured vector array averages 20,410 bytes/job. Mongo reported 23,518,464 logical data bytes, 46,649,344 allocated bytes and 2,940,928 index bytes for 806 documents. These are local logical/allocated Mongo figures, not compressed Atlas billing estimates; real descriptions, indexes, replicas and backups affect production storage.

| Vector representation | BSON vector bytes/job | Vector BSON at 1M jobs | Storage reduction | Expected quality note |
| --- | ---: | ---: | ---: | --- |
| Current 1,536 numeric dimensions | 20,410 | 19.01 GiB | baseline | Current compatibility and quality baseline |
| 1,024 dimensions | 13,243 | 12.33 GiB | 33.3% | Usually a moderate trade-off; must evaluate ranking quality |
| 512 dimensions | 6,563 | 6.11 GiB | 66.7% | Greater storage reduction, more likely to lose nuanced semantic matches |
| 256 dimensions | 3,235 | 3.01 GiB | 83.3% | Strong compression, highest ranking-quality risk |

These are BSON array sizes measured with the existing BSON runtime. Quantized `int8`/binary vectors could be substantially smaller, but storing them as the current Mongo `[Number]` array would not save space; it requires a binary vector schema, decoding/cosine changes, provider support, and quality evaluation. No dimension or storage format was changed. For Voyage, its API supports configurable dimensions/quantization; see the official [dimension and quantization guide](https://docs.voyageai.com/docs/flexible-dimensions-and-quantization).

## Cost model (incremental, estimates)

Approved public feeds are unauthenticated and do not charge per API request. No paid service, database, or package was added. The following estimates include embedding API spend only, using OpenAI `text-embedding-3-small` at $0.02 per 1M input tokens and 200 input tokens/job. Assume 25% of indexed jobs change matching text each month; the initial full index is shown separately. Actual token counts and provider selection vary.

| Indexed jobs | One-time full indexing | Monthly embedding spend at 25% changes | Approx. monthly embedding input |
| ---: | ---: | ---: | ---: |
| 10,000 | $0.04 | $0.01 | 0.5M tokens |
| 100,000 | $0.40 | $0.10 | 5M tokens |
| 1,000,000 | $4.00 | $1.00 | 50M tokens |

MongoDB storage, indexes, Redis memory, and worker compute are on existing infrastructure; the current hosting tier and unit prices were not provided, so their dollar amounts cannot be honestly calculated here. The BSON growth above is the capacity estimate to apply to your Atlas pricing. Costs are reduced by provider request caps, cursor continuation, six-hour shared demand caching, unchanged-content hashes, embedding batches of 32, existing Redis caching, expiry, capped candidate retrieval, and no LLM in discovery.

## Tests and known limitations

Tests cover source normalization fixtures, source-identity fallback, bounded retries/timeouts, policy gate, exact quota cap, aggregated demand, restart-safe cursors after a worker failure, Mongo migration/rollback preserving vectors, query index usability, location fallback, profile-version cache invalidation, match queue coalescing, bulk idempotent writes, match ownership 404, and discovery read-only behavior.

Known limits: Remote OK/Remotive do not provide reliable country codes in every feed item; unknown location eligibility is retained and shown as unknown. Jobicy occupation tags are source category labels, not a universal SOC/ESCO taxonomy. Currency conversion is not inferred. Jobicy demand terms use title/content tag search; provider location slugs are not yet used because their taxonomy must be discovered/verified. Candidate ranking remains capped and deterministic, not a promise of complete web coverage.
