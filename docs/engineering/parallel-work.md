# Parallel Workstreams & Worktree Ownership

To support concurrent feature development without cross-workstream merge conflicts, JobScout uses dedicated Git worktrees per workstream across both `AiJob_search_backend` and `Ai_resume_frontend`.

## 1. Worktrees and Branches

All workstreams branch from `development` and live in sibling folders next to the primary repositories:

| Workstream              | Branch                  | Backend Worktree                          | Frontend Worktree                       |
| ----------------------- | ----------------------- | ----------------------------------------- | --------------------------------------- |
| Task A: Jobs Production | `feat/jobs-production`  | `../AiJob_search_backend-jobs-production` | `../Ai_resume_frontend-jobs-production` |
| Task B: Chat Agent      | `feat/chat-agent`       | `../AiJob_search_backend-chat-agent`      | `../Ai_resume_frontend-chat-agent`      |
| Task C: Product Loop    | `feat/product-loop`     | `../AiJob_search_backend-product-loop`    | `../Ai_resume_frontend-product-loop`    |
| Test Foundation         | `chore/test-foundation` | Managed on dedicated branch               | Managed on dedicated branch             |

## 2. File-Ownership Rules

### `feat/jobs-production` (Task A)

- **Backend primary ownership**:
  - `src/services/jobs/**`, `src/controllers/jobController.js`, `src/controllers/adminController.js`, `src/routes/jobs.js`, `src/routes/admin.js`
  - `src/models/Job.js`, `src/models/JobDetail.js`, `src/models/JobVector.js`, `src/models/JobSource.js`, `src/models/JobCatalogVersion.js`, `src/models/Company.js`, `src/models/TrackedCompany.js`, `src/models/Match.js`, `src/models/MatchRefresh.js`, `src/models/SavedSearch.js` (or alert models)
  - `src/services/matchRefreshService.js`, `src/services/emailDigestService.js`, `src/worker.js` (ingestion & alert schedules)
  - `scripts/*job*`, `scripts/*occupation*`, `scripts/*ats*`, `docs/ai/jobs-production.md`, `docs/ai/data-supply-strategy.md`
- **Frontend primary ownership**:
  - `src/app/app/jobs/**`, `src/app/app/admin/**`, `src/lib/jobs/**`, `src/lib/schema/jobs.js`

### `feat/chat-agent` (Task B)

- **Backend primary ownership**:
  - `src/ai/graphs/chatGraph.js` (and chat tool modules under `src/ai/tools/**` or `src/ai/**`)
  - `src/ai/chatStream.js`, `src/ai/checkpointer.js`, `src/ai/router.js`, `src/ai/candidateContext.js`
  - `src/ai/memory/**`, `src/controllers/aiController.js`, `src/controllers/memoryController.js`, `src/routes/ai.js`, `src/routes/memory.js`, `src/models/Memory.js`
  - `evals/*chat*`, `docs/ai/chat*`
- **Frontend primary ownership**:
  - `src/app/app/chat/**`, `src/components/chat/**`, `src/lib/chat-session.mjs`, `src/lib/schema/chat.js`

### `feat/product-loop` (Task C)

- **Backend primary ownership**:
  - `src/controllers/applicationController.js`, `src/controllers/interviewController.js`, `src/controllers/resumeMatchController.js`, `src/controllers/tailoringController.js`
  - `src/services/application*`, `src/services/interview/**`, `src/services/resume*`
- **Frontend primary ownership**:
  - `src/app/app/applications/**`, `src/app/app/interviews/**`, `src/app/app/resume/**`, `src/app/app/resume-match/**`

### Shared Files (Strict Coordination Rule)

The following files are shared across workstreams and must **only** be edited in small, isolated commits and reconciled by the Coordinator at merge time:

- `package.json` and `package-lock.json`
- `src/app.js`, `src/config/env.js`, `src/shared/constants/plans.js`, `src/services/exportService.js`, `src/controllers/privacyController.js`
- `openapi.json` / `docs/api/openapi.json`
- `docs/ai/CHANGELOG.md`, `docs/release/integration-log.md`, `docs/engineering/commit-baseline.txt`, and root documentation indexes
- Frontend `src/lib/api/operations.js` and `src/app/app/settings/page.jsx`

## 3. Testing Standard Transition (`chore/test-foundation`)

- Until `chore/test-foundation` (Vitest, Supertest, MSW, React Testing Library, Playwright) merges into `development`:
  - **Do not** write source-text regex tests (`fs.readFileSync` assertions on source code).
  - Write runtime **behavior tests** and keep pure logic in small, exported functions that are trivial to port.
  - Each workstream agent must report to the Coordinator which test files should be ported first once `chore/test-foundation` lands.
- After `chore/test-foundation` merges into `development`:
  - Rebase active workstream branches onto `development` and write all new tests in the new stack (Supertest with real MongoDB for routes, table-driven Vitest for logic, React Testing Library for components, Playwright for flows, contract tests for every API shape the frontend consumes).

## 4. Merge & Release Protocol

1. **Workstream Verification**: Before merging any workstream branch into `development`, run `npm run lint`, full test suites (including Mongo integration), `npm run docs:check`, `npm run openapi` (backend), `npm run build` (frontend), and update `docs/release/integration-log.md`.
2. **Merge to `development`**:
   - Create a local backup tag on `development`.
   - Merge the workstream branch into `development` using `--no-ff` and a Conventional Commit message (e.g., `chore(release): merge feat/jobs-production into development`).
   - Resolve shared-file conflicts (`openapi.json`, `CHANGELOG.md`, `integration-log.md`, `exportService.js`) cleanly and re-run full verification gates on `development`.
3. **Release to `main`**:
   - `main` is never edited directly and never receives feature branch merges directly.
   - `main` is updated **only** through the release process by merging a fully verified `development` branch with `--no-ff` (`chore(release): merge development into main`) and tagging the release candidate locally.
   - Never run `git push` from automated agents; pushing and GitHub branch protection are owner-only actions.
