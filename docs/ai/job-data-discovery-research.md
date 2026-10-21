# Job data discovery: public evidence and independent design

**Research date:** 2026-10-20. Jobright source use is unknown unless explicitly labeled otherwise. A public interface's existence is not evidence that Jobright uses it.

Last verified against commit `19a9e22951fe449e40690b88248c5db499eda809` for repository references in this research set.

## As built (verified in code)

The current backend has a Mongo `JobSource` policy/quota/cursor registry, source adapters, a BullMQ ingestion worker, and catalog-only API discovery. See [job source policy](18-job-source-policy.md) and [catalog scaling](../architecture/job-catalog-scaling.md). This confirms IrowzScout code structure only; it does not confirm Jobright's sources.

## Target design (not built yet)

Source ranking, adapter controls, and lifecycle practices below are proposals to apply only after source-specific approval and testing.

## Evidence classification

| Source/mechanism                                   | Classification for Jobright                   | Independent availability and conditions                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Specific employer career pages / public ATS boards | Unknown                                       | Publicly accessible boards can be queried where the ATS documents this use and the employer board is listed/curated. Validate every board, bound rate, respect terms and robots, persist attribution and original application URL.                                                                                                                                                                                       |
| Greenhouse                                         | Industry capability, unconfirmed for Jobright | Greenhouse's Job Board API is designed for public job-board data. Employer-authorized Harvest APIs are a different interface and require authorization. Use the public board API only for an identified employer board; do not treat Harvest as a discovery shortcut. [Overview](https://support.greenhouse.io/hc/en-us/articles/10568627186203-Greenhouse-API-overview), [developer docs](https://docs.greenhouse.io/). |
| Lever                                              | Industry capability, unconfirmed for Jobright | Lever documents public postings endpoints keyed by employer site, including regional endpoints. Use only for curated/listed employer sites and according to current docs/terms. [Postings API](https://github.com/lever/postings-api), [developer documentation](https://hire.lever.co/developer/documentation).                                                                                                         |
| Ashby                                              | Industry capability, unconfirmed for Jobright | Ashby publicly documents a job posting API; access is keyed to an employer's published job board. Confirm current API terms, fields, and freshness before enabling. [Ashby developer documentation](https://developers.ashbyhq.com/).                                                                                                                                                                                    |
| Workday and other employer portals                 | Unknown for Jobright                          | Employer-specific and often not a general-purpose open feed. Integrate only a documented/authorized employer interface; no session automation, CAPTCHA bypass, or undocumented endpoint harvesting.                                                                                                                                                                                                                      |
| Licensed aggregators/public aggregators            | Unknown for Jobright                          | A vendor's API access does not automatically grant storage, display, redistribution, or derived-data rights. Obtain field-level license, retention/deletion, attribution, refresh, and credit terms first.                                                                                                                                                                                                               |
| Sitemaps and `JobPosting` structured data          | Industry capability, unconfirmed for Jobright | Employer pages may publish job structured data. Google documents `datePosted`, eligibility location, and `validThrough`; a filled job should be removed. This is a discovery signal, not a reuse license. [Google JobPosting documentation](https://developers.google.com/search/docs/appearance/structured-data/job-posting).                                                                                           |
| Jobright's exact source list                       | Unknown                                       | Public materials reviewed do not identify a complete source register or per-source license. The privacy policy mentions outside sources in general, not specific job feed vendors.                                                                                                                                                                                                                                       |

## Hard-to-find but public opportunities

Use a company-managed allowlist populated by explicit employer submissions, user-requested “Track this company,” and approved source registrations. Discover only public board identifiers and feeds documented for that board. A newly posted job can be found through a scheduled bounded delta poll, sitemap `lastmod` (as a hint, not truth), structured `datePosted`, provider cursors/ETags, and a change/removal feed. No search-engine query scraping is needed.

Private/confidential postings, invitation-only portals, authenticated systems, CAPTCHA-protected content, and pages whose terms disallow collection are out of scope. Publicly reachable does not mean licensed to store or redistribute.

## Ingestion lifecycle recommendation

Use one adapter per source with a registry gate requiring approved terms reference, license/permission reference, attribution, retention, quota, verification timestamp, and explicit operator approval. Default disabled. Existing backend `JobSource` registry and adapter/worker model already implements this policy shape; source eligibility remains governed by `docs/ai/18-job-source-policy.md` and `docs/ai/data-supply-strategy.md`.

Worker-only scheduled polling: per-source interval and request budget; bounded concurrency, timeout, transient-only retries with ceiling, circuit breaker, and dead-letter for exhausted permanent errors. Store per-source cursor and conditional validators where supported. Normalize, hash only display/match-relevant fields, upsert on `(source, sourceJobId)` then canonical URL, preserve provenance and variants, and mark stale/closed from authoritative deletion/expiry signals. If a source has no deletion feed, use conservative source-specific age policy plus polite link sampling. Never infer closure solely from a temporary fetch failure.

Keep descriptions/raw payloads only where terms explicitly permit; cap size and retention, isolate detailed content from hot search documents, and make deletion propagate to derived data. Record fetched/new/changed/duplicate/closed/error/quota/latency and coverage-by-country/occupation counters. Public UI must say “indexed jobs from enabled sources,” show source and posted/checked date, and link to the authoritative application page.

## Current IrowzScout fit

The backend has source adapters, a Mongo source registry with approval and quota fields, BullMQ scheduling, cursor/state/health tracking, canonical and group identity fields, source provenance, expiry state, and indexed catalog-only discovery. Existing policy documents describe Remote OK as the active baseline, Jobicy behind an explicit environment and registry gate, and Remotive blocked pending written redistribution permission. Other regional/ATS adapters are disabled by default. Confirm live source counts from local admin/catalog reports; this research did not access Mongo or production.

## Cost controls

The cheapest discovery request is an indexed catalog read. Do not trigger ingestion on user search. Poll only enabled sources on their approved cadence; use deltas and ETags; batch Mongo writes; do not invoke an LLM per listing. Embed only new/changed text if a measured retrieval need justifies it, and do not embed expired jobs. See [reference architecture](irowzscout-reference-architecture.md) for infrastructure assumptions and cost ranges.

## Verification

Checked source policy/model fields and the worker/catalog boundary in backend source and docs; checked official vendor API and Google structured-data documentation on 2026-10-20. Current source counts are explicitly not claimed because no database was queried. `npm run docs:check` validates local documentation structure.
