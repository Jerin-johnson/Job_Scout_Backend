# Job source policy and coverage

Last verified against commit `Phase 3 working tree` on 2026-10-16.

## As built (verified in code)

Source registry records require a terms/legal reference, attribution text and URL, retention/staleness rules, quota, adapter module, and a verification date. A new source starts disabled and unapproved. Company board approval and source policy approval are separate. The job catalog describes only the feeds currently indexed; it is not the whole internet. Each card carries source and posted date when supplied by its feed.

Remote OK, Remotive and Jobicy are enabled under their current policies. Greenhouse, Lever and Ashby public APIs have adapters but source-level ingest remains disabled by default; company slugs must be verified individually and approved. The current implementation supports admin review for submitted Greenhouse, Lever and Ashby URLs. No unverified company slugs are seeded. Ashby requires `isListed === true`.

Adzuna India is implemented behind a disabled registry record, fixture-tested only, quota-limited to 25 requests/minute, 250/day, 1,000/week and 2,500/month by default. Source approval/enablement is guarded until licensing, required attribution badge and storage/display review attestations are present. Read the terms checklist in [Phase 3 job quality](17-phase3-job-quality.md). SmartRecruiters and Recruitee were not added because public anonymous endpoints/terms could not be verified. LinkedIn, Naukri, Foundit, Indeed and Glassdoor are never scraped. Their external search buttons only open the respective job-search websites.

## Target design (not built yet)

Curate hospital, Indian, Gulf and other employer boards in the admin-managed list after verifying the legal owner, board slug, public API, terms, retention and attribution. Add new sources only after policy review and user approval.

## Coverage limitations

Current supply is strongest in remote roles from Remote OK, Remotive and Jobicy. It cannot be represented as broad national inventory; local Kerala nursing and other location-specific non-IT catalog coverage will remain poor until relevant hospitals/employers are curated and approved. Use the admin coverage report by occupation, country, source and eligibility before claiming availability. See [classification coverage](15-classification-and-catalog-coverage.md).
