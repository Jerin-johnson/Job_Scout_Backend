# ADR 0014: Deterministic job identity and conservative grouping

Last verified against commit `f4b536709b1154acf5d88a0e7ce9c58ec19be1b7` plus working-tree changes on 2026-10-17.

## As built (verified in code)

Identity and canonical grouping keys are generated; source-specific jobs are retained.

## Target design (not built yet)

Audited variant consolidation remains future work.

Status: accepted for identity keys and group metadata; canonical variant consolidation is not yet enabled.

## Decision

Identify records first by `(source, sourceJobId)`, then canonical URL with tracking parameters removed, then normalized company/title/location/employment/date. Content hashes signal changed content, not identity. Similarity alone never merges postings. Preserve source-specific records until an audited merge process can prove equivalence and retain source URLs/attribution.

## Limits

Current code computes a grouping key and stores group metadata but does not yet consolidate cross-source variants. A 100-record merge-precision sample and production dedup rate are Unverified. Do not render `Also listed on` until variants have verified records.
