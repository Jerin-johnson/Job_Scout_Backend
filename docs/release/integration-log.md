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

## Data supply implementation updates — 2026-10-18

- Corrected the Jobicy decision memo and source research: 24 request starts/day is our conservative app-side budget; the public guide does not state a daily quota. The implemented hourly minimum, attribution, canonical URL, caching, rolling seven-day feed, and status checks are the enforced conditions.
- Added privacy opt-in for job interaction counts, consent version/timestamp storage, withdrawal cleanup, export without the pseudonymous actor key, account-deletion cleanup, frontend Settings control, and OpenAPI contract.
- Fixed stale catalog totals by removing the stale discovery count cache path; normal discovery now counts only active, unexpired records from enabled/approved sources.
- Added `docs/ai/KNOWN_ISSUES.md` and `docs/ai/CHANGELOG.md`, and updated release checklist coverage/consent safeguards.
- Current local evidence is recorded in `docs/ai/data-supply-strategy.md`; 300 occupation labels still require human answers, ATS discovery is limited to supported URL patterns, and live JobStream yield remains **Unverified** after local DNS `ENOTFOUND`.
- Corrected full backend suite using MongoDB 8.0.8 system binary and loopback access: 189 passed, 0 failed, 1 skipped (optional). Backend lint: 0 errors, 2 existing `no-console` warnings. `docs:check` passes.
- Frontend contract/UI tests passed 47/47 and lint passed (Next.js `next lint` deprecation notice). Production build succeeded in a temp copy outside OneDrive; the direct build under OneDrive failed with `EPERM` creating `.next/server/app/dev`.
- Backend smoke is still **Unverified/failed in this environment**: the local Redis and MongoDB loopback connections are denied (`EACCES`), leaving dependent HTTP/LLM checks failing. First attempt also loaded an unavailable hosted Redis hostname from local configuration (`ENOTFOUND`); no external Redis was contacted after switching the test to loopback.
- `npm audit --omit=dev --audit-level=high` was retried for both repositories; both failed before advisory data due DNS `ENOTFOUND registry.npmjs.org`.
- Graphify updated from existing reports without semantic LLM analysis: backend 1,940 nodes/4,079 edges/139 communities; frontend 999 nodes/1,894 edges/82 communities. `graphify-out/` remains ignored in both repositories.

## Engineering standards — 2026-10-18

- Added a cross-platform branch/commit standard, official-reference summary, GitHub ruleset instructions, hook troubleshooting, and owner-only release checklist in both repositories.
- Hook install remains intentionally unverified until the owner installs Husky, lint-staged, and commitlint; no package manifest dependencies or lockfiles were changed.
- Sources accessed 2026-10-18: Husky setup/how-to, lint-staged README, commitlint CI setup, GitHub rulesets and Actions security hardening, Git attributes. See each repository's `docs/engineering/git-standards-research.md` for URLs.

## Hook and CI scaffolding — 2026-10-18

- Added Husky v9 hook scripts, lint-staged and commitlint configs, staged/outgoing secret and forbidden-path scanner, branch/commit validation, CI workflows pinned to full action SHAs, PR templates, CODEOWNERS placeholders, and GitHub branch ruleset docs in both repos.
- Added `docs/engineering/commit-baseline.txt` to validate only commits introduced after the captured feature-branch baseline (backend `9c2cf309...`, frontend `a2dd0303...`). Existing commit history is untouched.
- No hook dependencies or lockfiles were edited. Hook state remains unverified until owner installation.
- Backend lint: 0 errors, 2 existing warnings; docs check passed; secret scan passed. Frontend lint passed, test suite 47/47 passed, docs link check passed, and secret scan passed. Existing whole-repo Prettier check is not a gate because it reports 97 pre-existing formatting differences.

- Review correction: retained the backend's pre-existing comprehensive `.github/pull_request_template.md` after a case-insensitive Windows path collision; no existing checklist items were dropped.
- Follow-up review hardening: hooks now stop on staged lint failures, and CI explicitly configures the Redis service to `noeviction` using the existing ioredis dependency.
