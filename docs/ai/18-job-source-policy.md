# Job source policy and coverage

Last verified against commit `1dcc456` plus Phase 3 working-tree changes on 2026-10-17.

## As built (verified in code)

Source registry records require a terms/legal reference, attribution text and URL, retention/staleness rules, quota, adapter module, and a verification date. A new source starts disabled and unapproved. Company board approval and source policy approval are separate. The job catalog describes only the feeds currently indexed; it is not the whole internet. Each card carries source and posted date when supplied by its feed.

Remote OK is enabled by default. Jobicy is approved by its public API terms but is disabled by default; local development can opt in with `ENABLE_JOBICY_INGESTION=true`. The current official guide (accessed 2026-10-18) says the public feed covers the last seven days, asks clients to preserve the canonical Jobicy URL and attribution, recommends caching, and says sync passes should be no more frequent than hourly; cursor pages are sequential and up to 200 jobs. It does not publish a daily request quota. Our registry conservatively caps request starts at 24/day and one-hour minimum interval. Listings that age out of the feed are checked through the batch status endpoint (up to 100 IDs); explicit `closed` closes immediately, `unknown` hides for recheck, and `active` refreshes a seven-day freshness window. Remotive remains disabled until a written redistribution permission reference is recorded. Greenhouse, Lever and Ashby public APIs have adapters but source-level ingest remains disabled by default; company slugs must be verified individually and approved. The current implementation supports admin review for submitted Greenhouse, Lever and Ashby URLs. No unverified company slugs are seeded. Ashby requires `isListed === true`.

Adzuna India is blocked on license approval; it is not enabled or queried. Its published defaults are 25 requests/minute, 250/day, 1,000/week and 2,500/month. The official terms limit commercial organizations' API use outside the stated publishing/research purpose to a 14-day validation trial, require written consent/license for ongoing work, and require a linked attribution badge at least 116x23 pixels when ads are displayed. Keep it disabled pending written approval. SmartRecruiters and Recruitee were not added because public anonymous endpoints/terms could not be verified. LinkedIn, Naukri, Foundit, Indeed and Glassdoor are never scraped. Their external search buttons only open the respective job-search websites.

Greenhouse, Lever and Ashby adapters remain off unless both the environment flag and reviewed source/company registry approvals allow them. `npm run jobs:ats:validate -- <input.csv> <verified.json>` validates a bounded company list and checks known public board endpoints sequentially. It does not approve companies or start ingestion. `npm run jobs:ats:import -- <verified.json>` inserts only valid rows as pending admin review and refuses production/non-loopback databases. The CSV template is `docs/templates/ats-companies.csv`.

## Target design (not built yet)

Curate hospital, Indian, Gulf and other employer boards in the admin-managed list after verifying the legal owner, board slug, public API, terms, retention and attribution. Add new sources only after policy review and user approval.

## Coverage limitations

Current supply is strongest in remote roles from Remote OK, Remotive and Jobicy. It cannot be represented as broad national inventory; local Kerala nursing and other location-specific non-IT catalog coverage will remain poor until relevant hospitals/employers are curated and approved. Use the admin coverage report by occupation, country, source and eligibility before claiming availability. See [classification coverage](15-classification-and-catalog-coverage.md).
