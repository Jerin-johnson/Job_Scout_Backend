# Data supply decision memo

**Date:** 2026-10-18
**Status:** Recommendations only. No vendor was contacted, no paid service was called, and no source was enabled.

## Vendor pilot

**Recommended candidate:** Fantastic.jobs API, lowest paid 20,000-jobs/month tier at the currently published $95/month. **Budget cap for any future pilot: $95/month, no overage, hard stop at the tier limit.** Do not subscribe or integrate until the vendor confirms in writing that JobScout may store and display returned jobs (including descriptions), tells us whether ATS-native-only is supported, supplies per-row provenance and closure/change semantics, and permits our planned retention/deletion behavior. Product claims include broad ATS/job-board scope plus LinkedIn/Wellfound/Y Combinator postings, so source composition is material. India, Gulf, Kerala nursing, and UK/Ireland nursing yield are unverified. If answers are unclear, choose no pilot.

TheirStack is a useful pay-per-return alternative for demand-driven user searches, but its API guidance recommends webhooks for periodic sync and charges again for repeated records. Coresignal offers credits and mixed-source deduplicated records, but rates and storage/display contract terms need confirmation. Bright Data includes LinkedIn/Indeed/Glassdoor job sources and therefore is not recommended while product policy avoids scraped-board copies. No vendor is approved or configured.

## NCS and NORKA

Jerin owns partnership outreach. Ask NCS for the current MoU/placement-organization process and an approved API/feed contract; specifically request fields/schema, direct vs partner source labeling, active vs cumulative vacancy metrics, international placement and approved recruiter fields, usage/display/caching rights, attribution, closure/update/deletion behavior, quota, credentials/test environment, privacy/security obligations, and onboarding. Public NCS pages establish partner listings/redirects but not bulk-feed rights. Contact NORKA separately for employer/recruiter partnership and authorized data-sharing terms. Do not scrape either portal.

## Government notices

Before collection, legal review should answer whether each page/PDF is government-owned or third-party; exact resource license/copyright; whether factual metadata may be extracted and displayed commercially; whether descriptions/PDFs may be cached or copied; attribution/disclaimer; applicable robots and terms; update/withdrawal signals; privacy/security restrictions; and whether the Government Open Data License applies to that exact dataset. No live collection is approved.

## Source decisions

- **Remote OK:** continue current approved registry behavior and attribution.
- **Jobicy:** conditions verified from its [official API guide](https://jobicy.com/jobs-rss-feed) (accessed 2026-10-18). Keep disabled by default. The public endpoint is keyless; preserve Jobicy attribution and canonical listing URL, cache results, respect the rolling seven-day feed, and do not start automated passes more often than hourly. The guide does **not** publish a 24-requests/day quota; 24/day is our conservative application-side budget derived from the hourly minimum. Local enablement is a single flag: `ENABLE_JOBICY_INGESTION=true`; the registry approval/terms gate still applies. No production enablement.
- **Remotive:** remains disabled until written permission explicitly allows storage and redisplay. Permission request draft remains in docs/ai/18-job-source-policy.md.
- **JobStream, NAV, France Travail, vendors, government notices:** disabled. JobStream's Open Data page says CC0; NAV API terms allow republishing/display and require immediate update/removal; adapters remain registry-disabled. NAV never retains inactive ads. France Travail per-application reuse and quota contract is unverified.
- **ATS boards:** harvesting produces candidates only. Validation output is review-only; import tool stores records as pending. Approval is separate and is not performed by harvesting.

## Recommended sequence

1. Complete NCS/NORKA written-permission outreach and curate hospital/India/Gulf employer boards. Expected gain is unquantified until an approved list and feed rights exist; likely highest India/Kerala nursing value.
2. Use JobStream in Sweden only after operator approves registry policy and validates output quality. It offers free, potentially broad Sweden-only public ads; India's share is zero by geography.
3. Run the low-tier Fantastic.jobs legal/vendor questionnaire. If approved and hard cap can be enforced, run a time-boxed fixture-backed pilot capped at 20k jobs/month and $95/month; don't assume India nursing yield.
4. Review NAV and France Travail as separate country feeds only after contract/credentials and legal approval. NAV inactive-ad deletion must be immediate.
5. Add government notice sources only after source-specific written rights and safe change/takedown workflow.

## Decisions still required from owner

- Approve or reject any future $95/month Fantastic.jobs pilot only after written contract answers.
- Provide/approve NCS, NORKA and employer contacts and written feed rights.
- Decide whether JobStream should be enabled after reviewing measured Sweden supply and quality.
- Provide completed 300-row occupation label sheet before ground-truth precision/recall is reported.
- Approve source-by-source legal review before enabling any source.
