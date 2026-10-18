# Known issues and evidence gaps

Last reviewed: 2026-10-18

Last verified against commit `feat/data-supply` worktree on 2026-10-18.

## As built (verified in code)

Known evidence gaps are listed below; they describe validation limits, not source activation.

- The local JobStream measurement could not resolve its API host (`ENOTFOUND`); live yield, request count for a complete sync, and elapsed full-sync time are **Unverified**.
- The 300-row occupation sheet is a predicted-label review sheet, not ground truth. Precision and recall remain **Unverified** until a reviewer fills the correct-family column.
- The current ATS URL detector found zero supported Greenhouse, Lever, or Ashby boards in the inspected local catalog. It does not cover all URL formats or the broader market; SmartRecruiters, Recruitee, and Workable validation remains unverified.
- France Travail reuse and quota rights are not verified. NAV adapter behavior is fixture-tested only unless valid local credentials are configured. Both sources remain disabled.
- ESCO exact-release licensing and import are **Unverified**; no reference dataset was downloaded. GeoNames and O*NET license notes are in `data-supply-strategy.md`.
- No approved source currently provides a measured India/Kerala nursing catalog target. Current indexed counts are local snapshots, not total market yield.
- Runtime Redis, worker health, S3 configuration, and production source switches must be verified in the target deployment; this local task did not access production.

## Target design (not built yet)

Complete the source-specific legal and yield gates, human occupation labels, and country coverage evidence before enabling any new ingestion source.
