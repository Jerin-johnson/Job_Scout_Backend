# Job catalog scale research

Last verified against commit `f4b536709b1154acf5d88a0e7ce9c58ec19be1b7` plus working-tree changes on 2026-10-17.

## As built (verified in code)

The research and implementation status below distinguish verified code from unmeasured provider reach.

## Target design (not built yet)

Source adapters and measurements marked Unverified are not production-enabled.

Research date: 17 October 2026. Accessed URLs below on 17 October 2026. Public pages describe published product or API terms only; unpublished ranking, source coverage, deduplication, freshness, and ghost-job detection are not inferred as fact.

## Products and practices

| Product | Public statements | Not verified publicly |
| --- | --- | --- |
| Jobright | Public product materials market job discovery and career assistance ([Jobright](https://www.jobright.ai/)). | Data contracts, freshness, duplicate handling, ghost-job filters and catalog size. |
| LinkedIn Jobs | Recommendations may use profile information and activity ([LinkedIn job recommendations](https://www.linkedin.com/help/linkedin/answer/a512279/jobs-you-may-be-interested-in-overview?lang=en)). | Feed sources, deduplication logic, freshness and verification rates. |
| Indeed | Employer guidance discourages duplicate job postings and describes posting integrity ([Indeed job-posting integrity](https://www.indeed.com/help/employers/articles/job-posting-integrity-and-duplicates?co=US&hl=en)). | Internal matching and ingestion implementation. |
| Wellfound | Public listings expose startup roles and may show location, compensation and equity information ([Wellfound jobs](https://wellfound.com/jobs)). | Source reach, ranking, deduplication and ghost-job rules. |
| Adzuna | API terms set usage and attribution requirements; this project does not enable it without an approved license ([Adzuna API terms](https://developer.adzuna.com/docs/terms_of_service)). | Whether a future commercial license permits durable storage and republication under this product's use. |

These are product comparisons, not evidence about internal systems. An implementation pattern commonly used for cross-source deduplication is deterministic identity first (source plus source ID), then a tracking-stripped canonical URL, then a conservative employer/title/location/date entity key. Content hashes detect changes. SimHash/MinHash or shingled similarity can flag candidates for review, but similarity alone is unsafe: two roles at the same employer can share most of their description. The approach here therefore never merges on embeddings or a description hash alone. The exact ATS-versus-aggregator canonical preference needs an audited cross-source match before consolidation. This is a design recommendation; large-scale engineering evidence for this repo is still pending.

## MongoDB findings and decisions

- Use unordered `bulkWrite` with bounded client batches and an identity unique index. MongoDB documents unordered writes as continuing after individual operation errors and the driver/server split large batches as needed ([bulk writes](https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/)). Current app batch size is 500; benchmark rather than assuming larger is faster.
- Index only observed query shapes. Compound-index order determines which prefixes can serve a query; every index adds storage and write work ([compound indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/create-compound-index/)). Use `explain("executionStats")` on representative data ([query optimization](https://www.mongodb.com/docs/v8.0/core/query-optimization/)).
- Partial indexes can reduce index size when a stable predicate (such as active records) is present in all relevant queries ([partial indexes](https://www.mongodb.com/docs/v8.0/core/index-partial/)). Existing indexes and actual Mongo deployment support must be checked before relying on them.
- WiredTiger supports Snappy, zlib and zstd collection compression. Compression saves disk at CPU cost; in-memory collection data is uncompressed, so disk compression is not a substitute for RAM sizing. The default for most collections is Snappy; zstd must be configured and measured on the actual deployment ([WiredTiger compression](https://www.mongodb.com/docs/manual/core/wiredtiger/)).
- Catalog reads use keyset cursor pagination and bounded projections. A count is cached/approximate, not a full `$facet` over every result. No Atlas Search or separate search service is assumed. MongoDB documents explain plans as the way to check index coverage and plans ([query optimization](https://www.mongodb.com/docs/v8.0/core/query-optimization/)).
- Keep description/detail and vector access separate from list queries. `job_details` and `job_vectors` are additive; old fields remain until an independently approved retirement.

## Source policy and measured reach

No source is activated without a registry policy, current terms, attribution, retention, request budget, verification date and product approval. A source that forbids catalog storage/redistribution remains disabled.

| Candidate | Auth and policy summary | Full-sync job count, requests, duration, country/non-IT mix |
| --- | --- | --- |
| Sweden JobStream | The current official catalog says CC0/public/no registration, with snapshot and change-stream support ([catalog](https://data.arbetsformedlingen.se/dataservice/jobstream/), [v2 API](https://jobstream.api.jobtechdev.se/swagger.json)). | An older getting-started guide says an API key is needed ([guide](https://gitlab.com/arbetsformedlingen/job-ads/jobsearch-apis/-/blob/main/docs/GettingStartedJobStreamEN.md)); reconcile access requirements before scheduled ingestion. No complete bounded sync measurement has run; snapshot is about 300 MB and must be streamed. |
| Sweden JobSearch | Official API terms and product fit have not been verified for this implementation. | Unverified; disabled. |
| Norway NAV feed | JWT required; feed provides deltas/conditional requests. Terms require prompt removal/update of inactive or changed ads ([feed guide](https://navikt.github.io/pam-stilling-feed/), [API terms](https://arbeidsplassen.nav.no/vilkar-api)). No user token supplied. | Unverified; fixture-only and disabled. |
| France Travail | OAuth and use-specific terms/license review required; free API access alone does not establish redistribution permission. | Unverified; disabled. |
| Remote OK | Public API; exact listing link and source attribution required ([API](https://remoteok.com/api)). | No complete sync measurement in this pass; quota remains registry-limited. |
| Remotive | Current terms prohibit copying/reproducing or redistributing listings without written permission ([terms](https://remotive.com/terms-of-use)). | Not measured; disabled pending written permission. |
| Jobicy | Terms prohibit storage/republication/redistribution absent prior written consent ([terms](https://jobicy.com/terms-and-conditions)). | Not measured; disabled pending written permission. |
| Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Workable | Curated public employer boards only; no slug crawling. Source-specific policies still need approval before ingestion. | Per-company yield varies; not measured in this pass. |
| USAJOBS | Official API requires a key ([API reference](https://developer.usajobs.gov/api-reference/job-apis)); no credential supplied. | Not measured; disabled. |
| Canada Job Bank, UK/Ireland/Australia/NZ/Gulf public feeds, Indian NCS/state feeds | Public redistributable bulk-feed access not established for this implementation. | Unverified; disabled pending source and terms review. |
| Adzuna | License and terms blocked pending written approval ([terms](https://developer.adzuna.com/docs/terms_of_service)). | Not measured; disabled. |
| EURES | Partner-only under current understanding; no approved access. | Rejected pending changed terms/authorization. |
| LinkedIn, Naukri, Indeed, Glassdoor, unofficial German interfaces | No scraping or reverse-engineered APIs. | Rejected. |

Honest reach today: full-sync yield is still **Unverified**; no numeric claim about deduplicated global or India-relevant free supply is justified. The local Mongo snapshot is 806 records: Jobicy 699, Remote OK 99, Remotive 4, and mock public-board 4. That is not a completed sync or an estimate of what can legally be reached. Remotive and Jobicy are held from new ingestion pending written permission. Public feeds are not the whole internet. India-specific supply likely needs employer/hospital participation and licensed partnerships; Adzuna, NCS, NORKA and employer feeds need their own approval and terms.

## Scale and cost limits

`node scripts/benchmark-jobs-scale.js --sizes=100k,500k,1m` was run against local loopback MongoDB on 2026-10-16 with 1,000-op batches. Results: 100k at 5,493 ops/s, 2.66/10.30ms catalog p50/p95, 0.64/1.61ms candidate p50/p95, 9.58MB data and 8.45MB indexes; 500k at 6,308 ops/s, 9.16/30.06ms catalog, 0.64/1.39ms candidate, 60.5MB data and 45.7MB indexes; 1M at 6,303 ops/s, 12.83/50.19ms catalog, 0.49/1.05ms candidate, 122.2MB data and 87.8MB indexes. Recommended refresh was 58.28/273.71ms, 258.77/1,221.29ms, and 490.17/2,111.45ms respectively. An explain on the local 806-record catalog returned 400 candidates with 402 keys and 400 documents examined, using `job_candidate_recent_feed`, in 9ms. This benchmark uses compact synthetic documents and its RSS is the Node client, not MongoDB server RAM; see [scale-up measurements](jobs-scale.md) for caveats and BSON measurements from the local catalog. The benchmark's interrupted-run temporary collection was inspected and removed. A 1M production working-set RAM profile and hosting size remain **Unverified**.

Production monthly compute/storage cost is **Unverified** until host class, region, replica topology, backups and retention are known. This design has no per-job LLM or embeddings, so incremental AI/embedding API spend is $0; existing Mongo/Redis/worker costs are not zero and cannot be priced from repository code.

## Occupation quality status

The existing reproducible 100-title manually labeled check was rerun against the local catalog on 2026-10-16. It is a seeded sample of existing titles, not the requested independent stratified 300-job evaluation. Overall accuracy is 73/100 and 21/100 predictions are `unclassified`; the catalog-wide unclassified share is 155/806 (19.2%). Per-predicted-family precision was: accounting-finance 1/3 (33.3%), customer-support 8/9 (88.9%), data 1/1 (100%), design 5/5 (100%), education 1/1 (100%), healthcare 0/1 (0%), marketing 3/5 (60%), operations 8/9 (88.9%), product 1/1 (100%), sales 21/21 (100%), security 5/5 (100%), software 18/18 (100%), unclassified 1/21 (4.8%). Per-gold-family recall was: accounting-finance 1/1 (100%), customer-support 8/13 (61.5%), data 1/3 (33.3%), design 5/7 (71.4%), education 1/1 (100%), human-resources 0/1 (0%), marketing 3/5 (60%), operations 8/14 (57.1%), product 1/2 (50%), sales 21/23 (91.3%), security 5/6 (83.3%), software 18/23 (78.3%), unclassified 1/1 (100%). Source unclassified shares were mock public board 2/4 (50%), Remote OK 16/99 (16.2%), Remotive 1/4 (25%), Jobicy 136/699 (19.5%). Labels/sample size are too small and source-skewed for release claims; the requested independent 300-job stratified quality gate remains open and the <10% unclassified goal is not met.

Do not claim that 100k/500k/1M are supported until the benchmark runs and the actual explain plan and resource profile are reviewed. Tune batch size and worker concurrency from those measurements; avoid extra indexes that do not serve a measured query.
