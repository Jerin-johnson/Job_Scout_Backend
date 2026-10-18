# ADR 0014: Deterministic job identity and conservative grouping

Last verified against commit `f4b536709b1154acf5d88a0e7ce9c58ec19be1b7` plus working-tree changes on 2026-10-17.

## As built (verified in code)

Identity and canonical grouping keys are generated; source-specific job documents remain intact. Ingestion links active records only when their exact `groupKey` matches. This key is based on a normalized canonical URL when available, otherwise normalized company/title/location/employment/date. Vectors and fuzzy similarity are never used to consolidate jobs. Each group picks an active ATS source as canonical when present, stores `canonicalJobId` on variants, and stores at most 10 source/URL alternatives on the canonical record. Job detail returns `alsoListedOn` from that bounded list.

This is a display grouping: it does not delete, overwrite, or hide source records. ATS-first ranking is configured for Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Workable and USAJOBS; these registries remain disabled until separately approved.

## Target design (not built yet)

Near-duplicate candidates with different exact keys remain unmerged. The key intentionally favors precision over recall; a future fingerprint review must require exact entity-key agreement or company agreement plus independently verified title/location evidence. A 100-record real-world merge-precision sample and production dedup rate remain Unverified until there are labeled examples and more than one approved active source.

Status: exact-key variant linking is enabled; destructive consolidation is not.

## Decision

Identify records first by `(source, sourceJobId)`, then canonical URL with tracking parameters removed, then normalized company/title/location/employment/date. Content hashes signal changed content, not identity. Similarity alone never merges postings. Preserve source-specific records until an audited merge process can prove equivalence and retain source URLs/attribution.

## Limits

Current local data has limited cross-source overlap because only Remote OK is enabled by default; Jobicy is local opt-in and other sources are disabled. Do not interpret the group count as deduplicated catalog coverage. Exact-key grouping can miss equivalent postings whose URLs and entity fields differ.
