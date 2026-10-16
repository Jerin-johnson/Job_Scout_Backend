# ADR 0010: Verified public ATS company feeds

Last verified against commit `Phase 3 working tree` on 2026-10-16.

## As built (verified in code)

Greenhouse, Lever and Ashby public job-board endpoints are supported through one bounded adapter. Ashby postings must be listed. Exact HTTPS host validation, no off-host redirects and a 2 MB response cap protect track-company verification. User-submitted companies remain pending admin review; ATS source schedules remain disabled until source-policy approval and enablement. SmartRecruiters and Recruitee are not included because anonymous public endpoint terms/access were not verified.

## Decision

Use public employer ATS listings only, with verified company slugs and attribution. Do not scrape third-party job search pages. Keep source-level and company-level approvals separate.

## Target design (not built yet)

Build a curated admin-managed list of hospitals and India/Gulf employers after each board and source policy is reviewed.
