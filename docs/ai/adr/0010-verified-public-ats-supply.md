# ADR 0010: Verified public ATS company feeds

Last verified against commit `Phase 3 working tree` on 2026-10-16.

## As built (verified in code)

Greenhouse, Lever and Ashby public job-board endpoints are supported through bounded adapters. Ashby postings must be listed. Company-list validation uses fixed provider endpoints, one request per second, a 5-second timeout, no redirects and a 2 MB body cap. The validator emits a separate output file; import stores only verified candidates in local Mongo as pending admin review. The source flags default off. ATS source schedules remain disabled until both environment and source/company approvals permit them. SmartRecruiters and Recruitee are not included because anonymous public endpoint terms/access were not verified.

## Decision

Use public employer ATS listings only, with verified company slugs and attribution. Do not scrape third-party job search pages. Keep source-level and company-level approvals separate.

## Target design (not built yet)

Build a curated admin-managed list of hospitals and India/Gulf employers after each board and source policy is reviewed.
