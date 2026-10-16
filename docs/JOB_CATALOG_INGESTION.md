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

Discovery never fetches feeds. BullMQ repeat jobs run source ingestion. Role/location terms are aggregated from profile preferences in MongoDB with a minimum count of three, so no individual preference or user ID is exposed to the source query planner. The term list is cached in existing Redis for six hours; if aggregation is unavailable, ingestion falls back to a broad feed fetch. Remotive uses its documented `search` parameter and Jobicy uses its documented `tag` filter for demand scans. A full unfiltered sync is still performed at least every 24 hours (and resumed across pages) for stale detection and coverage; source daily quotas remain the hard ceiling. Remote OK currently has no demand query in its feed adapter, so its daily request remains broad.

The admin source panel shows cap, use/remaining, run state, latency, fetched/new/updated/duplicate/error counts, and coverage from the last full sync. Query quotas are reserved atomically in MongoDB; paid overage is not possible.

## Normalized records and dedupe

New fields are additive: `identityKey`, `sourceJobId`, `canonicalUrl`, `structuredLocation`, `compensation`, `provenance`, `status`, `firstSeenAt`, `lastSeenAt`, `sourceExpiresAt`, `sourceCheckedAt`, `occupationCodes`, `recordHash`, and `embeddingMetadata`. Existing `salaryRange`, `sourceBoard`, `sourceUrl`, and other legacy fields remain populated for compatibility. Unknown salary/currency/location information remains unknown; the system does not invent USD conversions.

Identity is `(source, sourceJobId)`, then `(source, canonicalUrl)`, then `(source, normalized company/title/location)`. Embedding similarity is never used to merge records. `recordHash` detects any matching-relevant catalog field changes; `contentHash` covers the text actually sent to the embedding model. Descriptions are converted to bounded plain text (24,000 characters maximum). No whole raw feed payload is persisted.

Existing vectors missing provider/model/dimension metadata are labeled `legacy/unknown` at read time and are not deleted or silently re-embedded. A future re-embedding operation would need to:

1. Select one provider/model/dimension version and create a versioned cache/key namespace.
2. Batch and rate-limit work by source; estimate full token cost first and exclude expired records.
3. Write new vectors and metadata side by side while preserving the old vector/hash for rollback.
4. Compare match-quality evaluation sets and storage/latency before switching reads.
5. Remove the old vector only after approval and a verified rollback window.

## Indexes and retrieval

The candidate path applies active/expiry, country or eligible-country/worldwide, work mode, occupation family, optional location, and known USD annual salary filters before returning at most 400 candidates. The discovery graph requests at most 300 and scores deterministically; it does not call ingestion or an LLM. Unknown salary is retained rather than incorrectly excluding a potentially suitable job. Legacy salary fields are used as a fallback when new compensation metadata is absent.

Indexes include:

- `job_identity_unique`: sparse unique identity key.
- `job_candidate_location_mode`: status + country + work mode + expiry + posted date.
- `job_candidate_recent_feed`: status + source + posted date + ID + expiry, supporting a recent-first bounded scan across approved feeds.
- `job_candidate_active_recent` and `job_candidate_occupation`.
- `job_source_coverage`: source + status + expiry for periodic coverage metrics.
- Existing `expiresAt` TTL index.

Use `Job.find(filter).sort(...).limit(400).explain("executionStats")` with actual production filters after deployment. The integration test uses a hint to verify the structured compound index exists and is usable. Recheck winning plan and docs examined/returned as the catalog grows.

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

Sample BSON sizing used the current schema with a representative 2,000-character description and a 1,536-element numeric vector. The old shape measured 22,896 bytes/job; the additive schema measured 23,738 bytes/job (+842 bytes, about 3.7%). This is logical BSON, not compressed Atlas disk usage. At one million similar jobs that is about 22.1 GiB logical BSON total, including about 19.0 GiB for numeric-array vector values and their BSON array keys. Actual descriptions, compression, indexes, replicas, and storage overhead change the physical bill.

| Vector representation | BSON vector bytes/job | Vector BSON at 1M jobs | Storage reduction | Expected quality note |
| --- | ---: | ---: | ---: | --- |
| Current 1,536 numeric dimensions | 20,411 | 19.01 GiB | baseline | Current compatibility and quality baseline |
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

Tests cover source normalization fixtures, source-identity fallback, bounded retries/timeouts, policy gate, exact quota cap, aggregated demand, restart-safe cursors after a worker failure, Mongo migration/rollback preserving vectors, query index usability, and discovery read-only behavior. The final test results are reported with this delivery.

Known limits: Remote OK/Remotive do not provide reliable country codes in every feed item; unknown location eligibility is retained and shown as unknown. Jobicy occupation tags are source category labels, not a universal SOC/ESCO taxonomy. Currency conversion is not inferred. Jobicy demand terms use title/content tag search; provider location slugs are not yet used because their taxonomy must be discovered/verified. Candidate ranking remains capped and deterministic, not a promise of complete web coverage.
