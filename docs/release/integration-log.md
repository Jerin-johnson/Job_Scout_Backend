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
- Local development occupation backfill was dry-run first, then applied additively: 617/617 records now carry classifier version 7; 73 remain unclassified (11.83%). Aggregate verification confirmed 617 total/versioned records. No production database was accessed.
- `npm audit --omit=dev --audit-level=high` could not reach `registry.npmjs.org` (`ENOTFOUND`). Dependency audit results are unverified.

## Release decision

Do not merge `main` until the dependency audit can run successfully and all release gates are green. No production database was accessed or modified. No production migration or index mutation was run.

## Data supply feature branch — 2026-10-18

- Started `feat/data-supply` from `development` in both the backend and frontend repositories after confirming each worktree was clean. The repositories retain separate histories; `main` is untouched.
- Graphify reports were readable and queried in both repositories (backend: 1,854 nodes; frontend: 996 nodes). Targeted queries covered ingestion/adapters, ATS tools, company storage, classification, job interaction/privacy paths, coverage endpoints, and jobs UI.
- GitHub workflow review: backend has `.github/workflows/ci.yml` with tests, lint, docs validation, and Docker build configured with `push: false`; no deployment step found. Frontend has no `.github/workflows` directory.
- Retried `npm audit --omit=dev --audit-level=high` in both repositories; both failed before receiving advisory data because DNS resolution for `registry.npmjs.org` returned `ENOTFOUND`.
- Local MongoDB read-only classifier sampling succeeded after requesting sandbox network access; the earlier sandboxed attempt was denied at loopback. The sample output was 100 current jobs and is predicted-label distribution only, not ground-truth accuracy.
