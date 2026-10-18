# JobScout data-supply strategy

Last verified against commit `95607da` plus the `feat/data-supply` working-tree changes on 2026-10-18.

**Research date:** 2026-10-18. **Access date:** 2026-10-18 for every linked page. This is product/engineering research, not legal advice. Unless stated otherwise, storage/display rights for third-party job descriptions remain **Unverified** and the source stays disabled pending source-specific written approval.

## Operating constraints

- The indexed catalog is not the whole internet. The currently approved feed registry has Remote OK enabled by default; Jobicy is terms-reviewed but disabled unless explicitly enabled in a local environment; Remotive is blocked pending written redistribution permission. Greenhouse, Lever, and Ashby remain per-company and pending review. JobStream, NAV, France Travail, licensed vendors, and government notices remain disabled.
- Discovery reads MongoDB only. Ingestion is worker-owned, repeatable, quota-bound, cursor-persisted, and disabled unless source policy and registry approval permit it. No aggregator is activated by this research.
- Public availability or an API key does not establish redistribution rights. Every source needs evidence for display, caching duration, attribution, change/deletion handling, and sublicensing before activation.

## Local catalog snapshot (2026-10-18)

The local development database has 617 active indexed records before source-policy filtering: Jobicy 511, Remote OK 99, mock_public_board 4, Remotive 3. The actual no-profile Jobs discovery response uses the policy-filtered public source list: **99 visible active jobs, all Remote OK** (first page 50; `hasMore` true). Jobicy's 511 are hidden because its default enable flag is false; Remotive's 3 are hidden because written redistribution permission is absent, even though the local registry has stale `enabled/approved` booleans; the static activation policy still blocks it. The mock source's 4 are excluded because it has no approved public source record. Querying the local source registry found Remote OK as the only visible source; this is a local snapshot, not global coverage.

The 617 local jobs have no structured `countryCode` populated, so exact country-based coverage cannot be reported. Occupation labels: 73/617 unclassified (11.83%); the remainder are rule outputs, not verified accuracy. Do not treat the catalog as the whole internet.

## Acquisition-method matrix

| Method | Access and terms for storing/displaying | Attribution / retention / redistribution | Cost and yield | Regional relevance |
|---|---|---|---|---|
| Official government/open feeds | Use only a documented API/feed or dataset license. Government status alone does not grant a blanket license. JobTech JobStream says ads are CC0 and exposes snapshot + change stream; NAV explicitly allows consumers to republish/display ads and requires immediate removal/update on inactive/deleted/updated events. France Travail API needs its applicable API terms and OAuth application agreement reviewed before storing/displaying. | Display source and application link. For NAV, consume inactive/deleted events promptly and update modified ads; no retention after inactive. JobTech CC0 attribution is useful product provenance. France Travail storage/display permission is Unverified pending exact application-specific conditions. | No feed usage fee found for JobStream/NAV; engineering and storage costs remain. France Travail quota/cost is application-specific. JobStream script attempted one bounded snapshot request on 2026-10-18 but returned **0 rows / 0 bytes** because DNS failed (`ENOTFOUND`); usable yield is Unverified. NAV/France Travail fixture-only. | JobStream: Sweden. NAV: Norway. France Travail: France. None is evidence of India supply; Europe only. |
| ATS public endpoints (Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Workable) | Employer-authorized public boards can be queried through vendor-documented APIs where terms allow. Greenhouse/Lever/Ashby are a disabled, company-curated path. SmartRecruiters/Recruitee/Workable endpoint and rights need per-platform review; not enabled. Discover boards only from known catalog apply/careers URLs, employer submissions, or lists supplied by JobScout. | Preserve employer/company and original apply URL. Store only fields authorized by platform/employer; expiry follows source checks. Do not crawl career sites or infer board slugs at scale. | No direct API fee verified for implemented Greenhouse/Lever/Ashby public boards. Yield is limited to known company URLs; validation makes one bounded API request per candidate. | Useful for direct employer postings globally, including hospitals and India/Gulf employers once curated. Healthcare supply depends on employer list quality. |
| Licensed job-data vendors | Commercial API/dataset contracts vary. Obtain written product-display and caching/deletion rights, provenance source breakdown (especially LinkedIn/Indeed copies), geographic coverage, ATS-native-only filtering, and closure/update API scope. Public API availability does not grant redisplay rights. | Contract must cover display in paid products, descriptions/snippets, caching, backups, derived fields/embeddings, exports, deletions, attribution, and termination purge. Unverified for every vendor below. | Cost examples below are subscription-price floors under explicit 10%-daily-change assumptions; no signup or API call made. | Vendors advertise global coverage; India/Gulf/nursing precision has not been independently validated. |
| Publisher/affiliate feeds | No publisher feed is configured. Each publisher must document an affiliate/API program and permitted presentation, attribution, and click-out behavior. | Terms-specific. Store/redistribution right Unverified until reviewed and approved. | Often performance-based or negotiated; unknown. | Potentially useful for local publishers and nursing under direct agreement. |
| Government recruitment notices | Kerala PSC, NHM Kerala, ESIC, state health departments, SSC, Railways, and bank recruitment pages publish notices. A public notice page, PDF, or robots allowance does not itself grant systematic extraction/republication rights. Each page's copyright, terms, robots rules, and PDF rights need review. No scraper is enabled. | Prefer source links and short factual metadata. Reproducing notice text/PDFs is Unverified and flagged for legal review. India Government Open Data License applies only to resources actually published under it; it requires attribution and excludes third-party rights and personal data. | No licensing fee assumed; manual curation, PDF parsing, and legal review are costs. Volumes are modest but expire quickly. | High potential relevance for Kerala healthcare and public-sector roles; no quantified reachable supply without permission/structured feeds. |
| Employer self-serve posting | Employers submit postings directly, with verified ownership and explicit terms granting display, retention until expiry, moderation, correction, and removal. Not implemented. | Require employer authorization, attribution, contact privacy, anti-scam checks, complaint handling, and rapid takedown. | Infrastructure/moderation cost only; yield depends on employer acquisition. | Strong potential for local hospitals and India/Gulf employers, but requires trust/safety operations. |
| Partner portals (NCS, NORKA, etc.) | NCS public materials describe partner integration and partner-posted listings; a current public API contract, fields, and feed terms were not found. Unverified. Do not scrape the portal. NORKA agreement needs outreach. | Seek MoU, approved API/feed, schema, display/storage/retention rights, attribution, inactive/update signals, and permitted international recruiter information. | Partnership and integration effort; no public API cost verified. | Potentially strong India/Kerala and Gulf relevance once a signed partner route exists. |

## Vendor comparison (official public pages; no calls or signups)

Prices change and are not a purchase recommendation. All product redistribution terms are Unverified until the vendor provides a written answer explicitly allowing listings in JobScout.

| Vendor | Public price / credit model | ATS-native-only / provenance / closure | Illustrative monthly cost for active inventory |
|---|---|---|---|
| TheirStack | Official API plan lists $49/1,500, $100/5,000, $169/10,000, $240/20,000, $400/50,000, $600/100,000, $900/200,000, $1,200/500,000, $1,500/1,000,000, $2,300/2,000,000 and $5,500/5,000,000 API credits. Search charges one credit per returned job. | Product aggregates career sites, ATS and job boards. Docs recommend webhooks for scheduled updates and say repeated records can be charged again; discovered_at_gte can avoid re-fetching old records. Exact source-only/ATS-only filter and redisplay rights Unverified. | Assumption: 10% of active inventory changes daily, 30 days/month (3× active count as new records), use the smallest published tier covering monthly credits. 50k→150k credits: $900; 100k→300k: $1,200; 500k→1.5M: $2,300. Backfill, retries, and non-job credits excluded. |
| Coresignal | Public self-service prices show $49/2,500 credits, $199/12,000, $499/35,000, $1,000/150,000, $1,500/1,000,000, $3,000/4,000,000, $5,000/10,000,000. One successful job record consumes one credit. | Vendor describes multi-source postings and deduplication. Public material includes company sites, professional networks, ATS platforms and aggregators. ATS-only filtering and display/caching rights Unverified. Closure delta semantics require confirmation. | Same 10%-daily-change assumption: 50k→150k credits: $1,000; 100k→300k: $1,500; 500k→1.5M: $3,000. Exact retrieval plans and limits require confirmation. |
| Fantastic.jobs | Official API page: 500 jobs/week trial (7 days); $95/20k jobs/month; $175/50k; $250/100k; $500/250k; $900/500k. Overage shown for higher tiers. | Claims broad ATS/job-board coverage, hourly refresh and expired/modified job APIs; also advertises LinkedIn/Wellfound/Y Combinator coverage. ATS-only switch, exact provenance, and product-display/caching license Unverified. | Under monthly included-job model (not assumed to pay per full refresh): 50k→$175; 100k→$250; 500k→$900. Clarify whether returned records, active inventory, and updates share a counter before contracting. |
| Bright Data | Official Jobs Scraper API advertises a 5,000-record/month free tier, $1.50/1,000 records PAYG, or $499/month for 384,000 records (then $1.30/1,000). Jobs datasets are separately priced by record count and refresh cadence. | Explicitly advertises LinkedIn, Indeed, Glassdoor and other job boards; not ATS-native-only. Update/expiry and redisplay rights require contract. Avoid sources held by policy. | With 10%-daily change ×30: 150k/300k/1.5M record calls yield $225/$450/$2,250 PAYG, excluding dataset subscriptions/minimums. |
| Jobspipe | Official pricing and terms for exact product could not be verified from a stable official page on this date. Unverified; don't model cost or integrate. | ATS filtering, provenance, closure, and display rights Unverified. | Not estimated. |

### Questions for vendors in writing

1. May JobScout store and display full postings, including descriptions, to end users (including paid users)? What field/snippet limits apply?
2. Which original sources appear, including LinkedIn/Indeed copies? Can we request ATS/employer-site-only results and filter each record by source?
3. What is the per-record credit definition for new, changed, repeated, closed, and deleted listings? Monthly cost for 50k/100k/500k active inventory refreshed hourly or daily?
4. May derived features, embeddings, snippets, and match explanations be retained? What must be purged on closure, contract end, export, or deletion?
5. What attribution, source URL, retention, redistribution, caching, backup, and deletion rules apply? Share regional quality samples for India, Kerala nursing, Gulf, UK/Ireland nursing, and freshers.
6. What SLA, quota, burst, retry, and hard budget cap apply?

## NCS and partner pathway

Verified in official NCS public material: partner-posted jobs are distinguished from direct postings; partner apply actions may redirect jobseekers to the partner. NCS confirms private job portals can register as placement organizations; FAQs list organization/registrant identity and registration fields. NCS has MoU partners and identifies partner listings with “Powered By”/partner labeling. A public API contract or right to bulk-export/store/re-display listings was not found. Public search pages are not an approved ingestion interface; do not scrape.

**What Jerin must request from NCS:** contact NCS partnership/help channel for current partner/MoU process; ask for approved API/feed, test environment and credentials, schema/data dictionary, direct vs partner vacancy semantics, active vs cumulative counts and freshness, international placements/approved recruiter fields, use/display/caching/redistribution terms, attribution, change/delete feed, rate limits, and data-protection requirements. Public brochures contain historical cumulative/point-in-time vacancy claims; not current feed-yield measurements.

## Government notices and legal flags

The Government Open Data License - India grants broad reuse only to covered shareable datasets, requires prescribed attribution and non-endorsement, and excludes personal information, third-party rights, and data the publisher cannot license. OGD says resource-level license metadata controls. NDSAP concerns shareable non-sensitive public-sector data; it is not a blanket license for every ministry/state recruitment page. robots.txt is a crawler instruction, not a copyright or redistribution license. Kerala PSC, NHM Kerala, ESIC, Kerala/state health departments, SSC, Railways, and bank pages/PDFs each need legal/terms/robots review. No crawler is enabled.

Pending review: store factual normalized notice metadata and source/application URL only where terms permit; don't mirror PDFs by default; preserve deadlines and update/deletion events; label official notices distinctly. Any notice LLM extraction must use untrusted text, strict schema + quote/span grounding, content-hash cache, one call maximum, configurable low token ceiling, hard $0 default cap, and remain disabled until budget approval. No live notice fetch or LLM call is part of this task.

## Legitimate ATS board discovery

Allowed: extract Greenhouse/Lever/Ashby/SmartRecruiters/Recruitee/Workable identifiers from application URLs already in the catalog, user “Track a company” URL, employer submission, or list supplied by JobScout. Validate each candidate with the documented source endpoint at bounded rate; output pending review only. Not allowed: broad web search/crawling, guessed slugs, job-board scraping, or using aggregator copies to seed company lists. The 2026-10-18 local harvest inspected 617 active jobs and found **0 ATS boards** in the catalog URL fields supported by the existing Greenhouse/Lever/Ashby detector; valid boards: 0; pending boards: 0; jobs on discovered boards: 0; India/remote jobs on discovered boards: 0. This is a measured zero for the detector's supported URL formats, not evidence that none of the six ATS platforms occur in unparsed job fields or the broader market. SmartRecruiters, Recruitee and Workable validation is not implemented and remains unverified.

## Coverage targets and honesty

The public catalog UI must say “jobs indexed from enabled sources,” not “all jobs.” Recommended is useful only when a segment can present fresh, eligible, deduplicated results. Proposed targets are not current supply claims.

| Segment | Initial useful target | Freshness target | Current evidence |
|---|---:|---|---|
| Kerala nursing | 100 active listings from at least 10 hospitals/employers | checked within 24h | None verified; employer/NCS/NORKA partnerships needed. |
| India fresher IT | 500 active listings; at least 25% entry-level tagged | 24h | Current global remote sources do not guarantee India/fresher eligibility. |
| India remote | 500 active India-eligible roles | 24h | Must use explicit country eligibility, not infer from “remote.” |
| Gulf nursing | 100 active roles from verified employers/approved partners | 24h; verify recruiter where required | No measured approved source. |
| UK & Ireland nursing | 250 active roles with nursing/location/authorization fields | 24h | JobStream/NAV/France do not cover UK/Ireland. |
| India government | 100 current open notices with close dates | daily | No lawful structured feed measured; manual/partner path first. |
| Global remote | 1,000 active remote listings with country eligibility | 24h | Count must be deduplicated and attributed. |

Publish active deduplicated counts, freshness distribution, eligibility-unknown share, source list, zero-result rate, and target gap. Do not extrapolate provider marketing totals to reachable supply. The current portfolio cannot substantiate these targets; it is not the whole internet.

## JobStream bounded live measurement

JobStream's official service exposes one streaming snapshot and change stream, not cursor-paged pages, and labels ads CC0. The measurement script makes at most one request, streams incrementally, emits counts and field-presence only, and stops at 250k records, 256 MiB, or 45 seconds. It writes no MongoDB. If it fails or hits a cap, report a bounded partial measurement, not a full-catalog count.

## Reference data licenses (import not bundled)

- GeoNames offers country extracts and alternate names under CC BY 4.0, commercial use allowed with attribution; data is aggregated and provided as-is. Country-specific extracts avoid live geocoding calls.
- O*NET database is generally CC BY 4.0 with attribution and change notice; external third-party content is excluded. Import only titles/skills covered by database license, not arbitrary site text.
- ESCO reuse license for an exact current release was not verified here: **Unverified**; do not import content yet.
- Keep dataset/release/download URL/license/attribution/fetch date and modified/derived mapping flags. No reference data was downloaded.

## Job tracking, employer posting and vendor integration (design only)

Before employer posting: verify employer domain/registrant authority, moderate queue, impersonation/scam checks, report/takedown SLA, duplicate/repost detection, explicit display/retention license, and removal path. For overseas recruitment, verify applicable eMigrate registration and recruiter authorization; do not present that as legal certification. Threat model includes fake employers, credential phishing, advance-fee scams, malicious links, job-text prompt injection, PII in descriptions, and moderation privilege escalation. Vendor integration should isolate adapter with hard credit budget, ATS-native filter, cursor/idempotency, kill switch, provenance, closure/delete processing, and schema tests. Planning effort: 1–2 engineering weeks for a clear licensed feed; several weeks plus operations/legal for employer posting/partner portal. Ranges are not commitments.

## Official references (accessed 2026-10-18)

- Jobicy public API guide (feed, attribution, caching and request frequency): https://jobicy.com/jobs-rss-feed
- JobTech JobStream API overview and CC0 notice: https://jobstream.api.jobtechdev.se/
- NAV job ads API terms: https://arbeidsplassen.nav.no/vilkar-api
- France Travail API portal: https://francetravail.io/
- NCS jobseeker manual, partner integration: https://www.ncs.gov.in/User_Manuals/Jobseeker.pdf
- NCS FAQ, partner onboarding: https://www.ncs.gov.in/job-seeker/_layouts/15/ncsp/faqs.aspx
- Government Open Data License - India: https://data.gov.in/Godl
- OGD terms/resource-level license: https://www.data.gov.in/terms-of-use
- NDSAP policy page: https://www.meity.gov.in/content/national-data-sharing-and-accessibility-policy-ndsappolicy
- TheirStack pricing: https://theirstack.com/en/pricing?tab=api
- TheirStack job-search credits: https://theirstack.com/en/docs/api-reference/jobs/search_jobs_v1
- TheirStack periodic-fetch guidance: https://theirstack.com/en/docs/guides/fetch-jobs-periodically
- Coresignal pricing: https://coresignal.com/pricing/
- Coresignal credit accounting: https://docs.coresignal.com/api-introduction/credits
- Fantastic.jobs API pricing/features: https://fantastic.jobs/api
- Bright Data Jobs Scraper API pricing: https://brightdata.com/products/web-scraper/jobs-scraper
- Bright Data Jobs Data API source scope: https://brightdata.com/products/data-feeds/jobs-data-api
- GeoNames license/downloads: https://www.geonames.org/export/
- O*NET database license overview: https://www.onetcenter.org/license_agreements.html
- ESCO data: https://esco.ec.europa.eu/en/use-esco

## As built (verified in code)

- Source policy records, disabled Jobicy/Remotive defaults, admin approval gates, the local `ENABLE_JOBICY_INGESTION=true` flag, indexed catalog-only discovery, and source attribution are implemented.
- Company master dry-run/apply/rollback, review-only ATS candidate export, 300-row occupation label export/scorer, fixture-only licensed-feed checks, synthetic government-notice fixture, and consented interaction analytics are implemented on `feat/data-supply`.
- JobStream/NAV/France Travail adapters and fixtures are present but registry-disabled. The bounded live JobStream attempt got DNS `ENOTFOUND` without rows; live yield remains **Unverified**.
- Occupation accuracy cannot be measured until the 300-row label sheet is completed by a reviewer. Current local predicted-label counts are descriptive, not accuracy metrics.

## Target design (not built yet)

The reviewed vendor pilot, partner feeds, employer self-service portal, government notice collection, GeoNames/O*NET/ESCO imports, and source expansion remain proposals. No paid service, external reference dataset, live vendor call, or live government feed was activated.

## Admin coverage reporting — 2026-10-18

The admin coverage endpoint now reports deduplicated active counts, raw active counts, freshness by last-seen age, unknown-eligibility share, source/country/family aggregates, and explicit gaps against the initial segment targets above. Segment counts are structured-field estimates; fresher, authorization, hospital/employer verification, and complete eligibility are not inferred when the corresponding source fields are absent. `usersWithZeroEligibleJobs` is scoped to consented pseudonymous users with a zero-result event in the prior 30 days and is not an all-user census. The production UI presents these caveats.
