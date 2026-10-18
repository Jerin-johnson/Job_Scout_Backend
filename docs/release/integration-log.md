# Development integration status

Updated: 2026-10-18

## Local integration

- Backend and frontend remain separate Git repositories. Their feature branches were merged locally into `development` in this order: `feat/jobs-phase-3`, `feat/jobs-scale`, `feat/resume-match`; the resume-match API/OpenAPI contract fix was also integrated. No repository history was combined.
- `backup/pre-integration-2026-10-18` and `dev-integration-2026-10-18` are local recovery points. Feature branches remain available. No push or deployment was performed.
- The frontend and backend `.gitignore` files already ignore `graphify-out/`; generated Graphify artifacts remain untracked.

## Verification

- Frontend contract/UI tests: 46 passed. `next lint` passed (Next.js deprecation notice only).
- Frontend production build succeeded from a clean source copy under the system temporary directory. Direct OneDrive and sandbox builds hit Windows `EPERM`; the isolated unsandboxed build completed. Route output and generated static pages were verified.
- Backend full suite: 183 passed, 0 failed, 0 skipped, including the optional interview Mongo integration case. It used the installed MongoDB 8.0.8 system binary because mongodb-memory-server 8.2.6 could not be downloaded in this network environment.
- Backend smoke: 44 passed against a temporary in-memory MongoDB with mock storage/AI, no provider or S3 calls. Default smoke mode seeds a synthetic job and does not ingest external feeds; `SMOKE_ALLOW_INGESTION=true` and `SMOKE_ALLOW_LIVE_AI=true` are explicit opt-ins.
- Backend lint has 0 errors and 2 existing `no-console` warnings. `docs:check` passed. OpenAPI source and published docs files are byte-identical to HEAD; Git reports metadata-only modified status, so they were not staged.
- Read-only index preview connected to local MongoDB: no retention or trial backfills required, no obsolete index to drop, no indexes to create/replace, and `writesPerformed: false`.
- `npm audit --omit=dev --audit-level=high` could not reach `registry.npmjs.org` (`ENOTFOUND`). Dependency audit results are unverified.

## Release decision

Do not merge `main` until the dependency audit can run successfully and all release gates are green. No production database was accessed or modified. No production migration or index mutation was run.
