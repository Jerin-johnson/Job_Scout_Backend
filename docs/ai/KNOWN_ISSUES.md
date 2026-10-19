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
- The 300-row occupation review sheet has no human-corrected labels; it cannot provide per-family precision/recall yet. The independent 100-title fixture is not a substitute for the requested stratified 300-row review.
- GeoNames and O*NET licenses were reviewed, but no release was downloaded or imported in this run. Local additive import and rollback evidence remain pending.
- Docker is installed, but the Compose stack health and backup/restore rehearsal are **Unverified** until the owner runs the local stack commands in `docs/operations/backup-restore.md`.
- Local active-catalog age snapshot on 2026-10-18: 59/617 listings (9.56%) were older than 30 days; Remote OK was 59/99 (59.6%), Jobicy 0/511, Remotive 0/3, and mock fixtures 0/4. A separate 83/617 (13.45%) met the conservative possible-repost date-gap rule. Counts include disabled-source rows; these signals are advisory, not proof that a role is closed.
- GeoNames/O*NET official file metadata checks succeeded, but bounded transfers of the requested extract set did not complete. No reference records were imported. No dataset files remain in the workspace or task temp folder.
- Feedback submission is authenticated, text-only, limited to five submissions/hour/user, included in export/deletion, and retained for up to 180 days. Production Sentry deployment verification remains **Unverified**.

## Target design (not built yet)

Complete the source-specific legal and yield gates, human occupation labels, and country coverage evidence before enabling any new ingestion source.
