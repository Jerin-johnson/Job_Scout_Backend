# ADR 0008: Conservative rules-based job eligibility

Last verified against commit `Phase 3 working tree` on 2026-10-16.

## As built (verified in code)

`src/services/jobs/eligibility.js` extracts country, region, remote scope, authorization/sponsorship signals, confidence and a shortened evidence phrase using deterministic patterns. Unknown stays unknown. Catalog requests hide explicit mismatches by default and support `showAnyway`. No personal profile data is sent to an LLM or written to eligibility logs. Backfill is additive and resumable; unset `eligibility.version` to make a row eligible for a later re-evaluation.

## Decision

False eligibility claims can mislead applicants. Use conservative rules, visible evidence and an explicit unknown state. Do not infer work authorization from remote status or from a country’s name alone.

## Target design (not built yet)

Add reviewed source-specific language patterns and measure false inclusion/exclusion on consented, labeled data before using richer inference.
