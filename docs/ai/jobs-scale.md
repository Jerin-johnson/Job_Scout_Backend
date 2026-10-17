# Job catalog scale-up: research and implementation notes

Last verified against commit `f4b536709b1154acf5d88a0e7ce9c58ec19be1b7` plus working-tree changes on 2026-10-17.

## As built (verified in code)

The job storage split, source activation gate, catalog cursor, token filters, benchmark runner, and Jobs UI cursor consumer are implemented in the current working tree. Automated test results are reported separately; production dataset performance and provider yield are not inferred from implementation alone.

## Target design (not built yet)

Live NAV/France Travail ingestion, complete JobStream snapshot/change ingestion, full variant consolidation, independent 300-job occupation labels, and hosting-specific scaling are future work until their prerequisites below are met.

Research reviewed 17 October 2026. Public statements and provider terms are cited; observed implementation details are labeled separately. See [scale research](scale-research.md) for competitor coverage, official source terms, storage recommendations, and measured/unverified supply.

## Public-source and competitor notes

| Product/source | Publicly verifiable statements | What is not public / not assumed |
| --- | --- | --- |
| Jobright | Markets AI job discovery, resume/profile matching, and job-search assistance ([Jobright](https://www.jobright.ai/)). | Its internal feed contracts, deduplication, freshness, ghost-job rules, and infrastructure scale are not published. |
| LinkedIn Jobs | Public product materials describe recommendations informed by profile, preferences and activity ([LinkedIn job recommendations](https://www.linkedin.com/help/linkedin/answer/a512279/jobs-you-may-be-interested-in-overview?lang=en)). | Internal source coverage, deduplication and job verification rates are not public. |
| Indeed | Public employer guidance requires one posting per genuine opening and describes duplicate job-posting rules ([Indeed job-posting integrity](https://www.indeed.com/help/employers/articles/job-posting-integrity-and-duplicates?co=US&hl=en)). | The internal matching and crawling systems are not public. |
| Wellfound | Public job pages advertise startup roles and expose company, location, compensation/equity and job details ([Wellfound jobs](https://wellfound.com/jobs)). | Its sourcing, deduplication and freshness implementation is not public. |
| Adzuna | Its developer terms specify request ceilings and attribution/display requirements. The key is explicitly license-blocked until written commercial terms are supplied ([Adzuna API terms](https://developer.adzuna.com/docs/terms_of_service)). |

Deduplication patterns in this implementation are based on provider/source identity first, a normalized canonical URL next, and a conservative company/title/location/date key as a grouping aid. Similarity alone must never trigger a merge. A content fingerprint can detect changed content or suggest a review; it is not a job identity. Public engineering write-ups describe URL normalization, entity resolution, and SimHash/MinHash as common techniques, but none authorizes merging distinct openings. Employer ATS postings should be preferred over aggregator copies when a verified cross-source equivalence exists. No similarity auto-merge or full variant consolidation is currently enabled.

## MongoDB decisions

- Existing MongoDB is reused. Ingestion uses unordered `bulkWrite` in bounded batches of 500; MongoDB's high-level driver splits oversized operation groups, and unordered writes continue after individual failures ([MongoDB bulk writes](https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/)). The app's smaller batch is an operational memory/error-isolation choice, not the server's maximum.
- Unique source identity is enforced by a unique sparse index. Compound indexes are limited to actual read shapes; every extra index costs write work and disk. MongoDB documents covered queries and warns indexes can degrade high-write workloads ([index design](https://www.mongodb.com/docs/manual/data-modeling/schema-design-process/create-indexes/)).
- Catalog cursors use `postedAt DESC, _id ASC`; they do not use `skip`. Search tokens use existing title/company token arrays, while details and vector payloads are excluded from catalog projection.
- `job_details` and `job_vectors` are additive collections. `job_details` has an expiry TTL index; legacy vectors carry `legacy/unknown` metadata on copy. Existing fields remain intact for rollback. The explicitly approved local-only copy was applied on 2026-10-16: 806 job records scanned, 806 details copied, and 806 legacy vectors copied. It wrote only to loopback development MongoDB; no production database was touched. Current local counts are `jobs=806`, `jobdetails=806`, and `jobvectors=806`. The legacy fields remain available for rollback.
- Collection compression depends on the deployed storage engine/configuration. Zstandard availability is not assumed without checking the actual MongoDB deployment. Atlas Search is not assumed; no dedicated search service is proposed as part of this implementation.
- `$facet` is not used on the hot path. A cached active-job total is approximate/stale for up to five minutes; exact, highly selective counts would add database work.

## Data model and migration

`jobs` retains list/matching fields and source identity. `job_details` stores display description and requirements. `job_vectors` stores vectors with provider/model/dimension; no new vectors are created. Existing `rawDescription`, `requirements`, and embedding fields remain in `jobs` during rollout so old application versions and rollback remain possible. This is a transitional additive split, not a destructive shrink.

Commands (backend repository; both refuse non-loopback/production URIs):

```powershell
npm run jobs:storage:report
npm run jobs:storage:apply
```

`report` is read-only. `apply` is resumable and copies into additive collections. Rollback: deploy the prior application code; it continues reading the legacy `jobs` fields. Leave the new collections untouched until verified. Do not unset legacy fields until a separately approved cleanup migration. This application rollback does not require data deletion; a later cleanup of additive collections needs separate approval.

## Ingestion and search behavior

- New/changed operations are normalized once and written unordered in batches. Unchanged hashes are marked seen in batches. Failed/partial runs do not execute the completed-full-sync stale sweep already present in the worker.
- Source registry records contain terms URL/reference, attribution, retention rule, quota and verification time. Approval and enablement are separate. Remotive remains disabled pending written redistribution permission. Jobicy's current public API guide permits integrations with attribution and caching; it is approved in policy but remains disabled by default until an operator explicitly enables it for measurement/use. Existing data is not deleted by this change.
- Remote OK's API requires a followed source link and explicit source attribution ([Remote OK API](https://remoteok.com/api)); per-sync yield and country/occupation distribution still require an executed complete local sync.
- NAV's feed supports incremental pages, ETag/Last-Modified, and requires immediate removal/update when ads become inactive/changed. It requires a JWT consumer token, which was not supplied, so it remains fixture-only/disabled ([NAV feed docs](https://navikt.github.io/pam-stilling-feed/), [NAV API terms](https://arbeidsplassen.nav.no/vilkar-api)).
- JobStream is public CC0 and keyless on the official data catalog, with current and historic records described ([Arbetsförmedlingen JobStream](https://data.arbetsformedlingen.se/dataservice/jobstream/)). Its stream/snapshot contract is documented in the official code repository; the full current snapshot is approximately hundreds of MB, so it must be streamed and bounded rather than loaded into memory ([JobStream API guide](https://gitlab.com/arbetsformedlingen/job-ads/jobsearch-apis/-/blob/main/docs/GettingStartedJobStreamEN.md)). No full sync was run in this implementation pass; measured yield remains Unverified.
- France Travail's current distribution terms/access require a license review. No OAuth calls or storage/display adapter is enabled without the license and an approved use.
- USAJOBS offers an official API with a key and attribution/redirect requirements ([USAJOBS API reference](https://developer.usajobs.gov/api-reference/job-apis)). No key was provided; it remains disabled.
- Public Greenhouse/Lever/Ashby endpoints and the existing curated company list tooling remain the allowed path for employer postings. Further company discovery is by supplied lists, employer submissions, and user track requests; not crawling.
- Yield, request count, sync duration, and regional/non-IT shares for every requested candidate feed require full provider-specific syncs. Since terms and credentials prevent several syncs, those figures are **Unverified**; no extrapolation from one page is labeled as full-catalog reach.

## Honest reach and current limitations

The local catalog contains 806 records (699 Jobicy, 99 Remote OK, four Remotive, and four mock public-board records); this is a point-in-time local DB count, not a full-sync yield. Remotive is held from new ingestion pending written permission. Jobicy is approved under its current public API guide but disabled by default until explicitly enabled. Publicly documented feeds do not equal a globally representative catalog. India-relevant free supply remains particularly uncertain because global remote listings often restrict work authorization and official Indian feeds lack a verified public, redistributable full feed in this repository. A precise count of deduplicated free jobs by country cannot be claimed until complete legal feeds are measured. Adzuna India, NCS/NORKA partnerships, hospital groups, and employers remain the likely licensed/partner channels for material India supply. **Current verified free reachable yield: Unverified**; do not describe 806 as globally reachable.

## Scale benchmark

Run only against local loopback MongoDB; temporary collections use random names and are dropped in `finally`:

```powershell
node scripts/benchmark-jobs-scale.js --sizes=100k,500k,1m
$env:JOBS_SCALE_BATCH_SIZE='500'
node scripts/benchmark-jobs-scale.js --sizes=100k
```

The script measures batched insert/upsert throughput, index build time, BSON average, logical/storage/index bytes, client RSS, p50/p95 catalog-like queries and candidate queries, plus `explain()` counters. Synthetic results measured on the local Mongo host (1,000-op batches, 5% duplicate upsert attempts; temporary collections are intended to be dropped) were:

| Synthetic jobs | Ingest ops/s | Ingest time | Index build | Avg BSON/job | Logical bytes | Storage bytes | Index bytes | Client RSS | Catalog p50/p95 | Candidate p50/p95 | Recommended refresh p50/p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100k | 5,493 | 19.1s | 2.28s | 900B | 90.6MB | 9.58MB | 8.45MB | 106.3MB | 2.66/10.30ms | 0.64/1.61ms | 58.28/273.71ms |
| 500k | 6,308 | 83.2s | 8.62s | 900B | 453.2MB | 60.5MB | 45.7MB | 48.8MB | 9.16/30.06ms | 0.64/1.39ms | 258.77/1,221.29ms |
| 1M | 6,303 | 166.6s | 16.74s | 900B | 906.5MB | 122.2MB | 87.8MB | 81.8MB | 12.83/50.19ms | 0.49/1.05ms | 490.17/2,111.45ms |

These are compact, repeated synthetic records and are not representative of full descriptions or production write concurrency. The RSS column is the benchmark Node client process, not `mongod` memory. A separate read-only sample of 100 existing local records measured an average of 7,664 BSON bytes/job excluding vectors and 28,160 bytes including vectors (20,501 bytes average vector payload/metadata). Linear data-only estimates from that real sample are 76.64MB/766.4MB/7.664GB at 10k/100k/1M jobs without vectors and 281.6MB/2.816GB/28.16GB with the existing vector payload; these exclude indexes, replicas, journals, backups, and compression. Measured local Mongo collection stats for 806 jobs were 23.52MB logical data, 45.59MB allocated storage, and 3.06MB indexes. A 1M production working-set RAM requirement and hosting size cannot be inferred from the compact benchmark; measure `mongod` working-set and index residency on the target deployment before sizing.

Incremental paid provider and embedding spend is $0 in this design (no LLM or embedding work in ingestion/search). Monthly cloud compute/storage costs are **Unverified**, not $0: host, instance class, replica-set topology, region, storage class, backups, egress and retention are unknown. A reliable 10k/100k/1M monthly dollar estimate requires those inputs. Keep costs down by using the existing Mongo/Redis/worker, bounded candidate retrieval, no per-job model calls, and scaling only after host-specific measurements.

## Before release

1. Obtain written redistribution permission for Remotive or keep it disabled; explicitly enable Jobicy only for a measured, approved run using the public keyless API and attribution.
2. Supply/register a NAV consumer token before enabling its adapter.
3. Confirm France Travail terms/license before implementing an adapter.
4. The local additive storage copy and synthetic 100k/500k/1M benchmark were run; repeat both on a representative host before setting production capacity. The storage migration is reversible because legacy fields remain.
5. Execute full-sync yield measurement per legally approved source, then independent dedup/occupation labels and query `explain()` against the actual production-shaped indexes.
