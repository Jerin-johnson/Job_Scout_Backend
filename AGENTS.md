# JobScout repository guide

JobScout is a Node.js 22 / Express backend with a sibling Next.js frontend. The API runs on port 4001, the web app on 3000, and BullMQ background work uses Redis and MongoDB.

## Operating mode (Antigravity single source of truth; do not create GEMINI.md)

- Plan first: produce an implementation plan artifact and a task list; update the task list as you work; end with a walkthrough artifact listing evidence (commands, test output). Proceed without asking unless a stop condition occurs.
- Hard limits: never run `git push` to any remote; no force operations, no history rewrite, no deploy or publish; databases and Redis must be loopback only; never read, print or copy values from `.env` files; no paid services or signups; no new dependency except the pre-approved ones below (otherwise log the need in `docs/decisions/pending-approvals.md` and use a non-dependency fallback).
- Pre-approved devDependencies: `husky`, `lint-staged`, `@commitlint/cli`, `@commitlint/config-conventional`.
- Stop and ask only if: a real secret appears in the repo or history, a non-local write or destructive migration is required, a source's terms forbid a planned use, or a command would reach a hosted service.
- Commits: Conventional Commits, small, on feature branches. Keep `docs/release/integration-log.md` updated after every step so another agent can resume.
- UI changes: verify responsive behavior at 375, 768 and 1280px in light and dark themes plus accessibility checks (skip screenshots when instructed by the user for fast execution).
- Testing standard (`chore/test-foundation` transition): Until `chore/test-foundation` (Vitest, Supertest, MSW, React Testing Library, Playwright) merges, do not write source-text regex tests; write behavior tests; keep pure logic in small functions that are easy to port. After it merges to `development`, rebase and write ALL new tests in the new stack (Supertest with real MongoDB for routes, table-driven Vitest for logic, React Testing Library for components, Playwright for flows, contract tests for every API shape the frontend consumes). Report which test files should be ported first.

## Directory map

- `src/controllers`, `src/routes`, `src/services`, `src/repositories`: HTTP, validation, business rules, data access.
- `src/ai`: shared model layer, providers, graphs, candidate context, memory.
- `src/models`: MongoDB schemas and indexes.
- `src/worker.js`: scheduled ingestion and asynchronous jobs.
- `tests`, `evals`: unit, MongoDB-memory-server integration, and AI-quality fixtures.
- `docs/ai`: verified AI behavior and explicitly unbuilt target designs.

## Commands

- Install: `npm ci` in backend and sibling frontend.
- Start all local services: `npm run dev:stack` (API + worker + frontend); separately `npm run dev`, `npm run worker:dev`, and frontend `npm run dev` are available.
- Test/lint/format: `npm test`, `npm run lint`, `npm run format`.
- Build frontend: `npm run build` in `../Ai_resume_frontend`.
- OpenAPI / indexes: `npm run openapi`, `npm run ensure-indexes`.

## Implementation rules

- Keep HTTP parsing in controllers/routes, business logic in services, and database access in repositories/models.
- Validate request bodies with Zod. Preserve the common error shape and request ID.
- Scope every user-owned database read/update/delete by authenticated `userId`; cross-user access should return 404.
- Make schema migrations additive and provide a report/rollback before destructive data changes.
- Never log credentials, resume contents, answers, prompts, presigned URLs, or raw provider responses.
- Every model invocation uses `src/ai/llm.js`; every vector operation uses the metered/kill-switch-aware `embeddingService` boundary. Do not add per-job LLM calls to ingestion or matching.
- Prefer deterministic rules before LLM use. Cache generated/embedded content by a stable content hash where safe.
- Wrap user/job-provided text as untrusted input; validate structured output; never render raw HTML from model output.
- Tool authorization and `userId` come from server state, not model arguments.
- Keep prompt versions explicit and run the relevant evals when prompt or scoring behavior changes.

## Definition of done

- Tests and lint pass; an AI prompt/scoring change includes evaluation results.
- Update documentation in the same change. Use “Unverified” where repository evidence is missing.
- UI changes include responsive checks at 375/768/1280px in light and dark themes plus accessibility checks.
- Work in approved phases, pause at review gates, and ask before adding dependencies or infrastructure.
- If unsure, mark the claim Unverified and ask; do not present target designs as built behavior.

## Graphify-assisted codebase exploration (Antigravity workflow)

- For the reusable Graphify-guided exploration, implementation, validation, and review workflow, use `.agents/skills/graphify-development/SKILL.md` and `.agents/rules/graphify.md` (installed via `graphify antigravity install`).
- Query the graph first: before exploring an unfamiliar feature or planning a change across multiple modules, check `graphify-out/GRAPH_REPORT.md` and query `graphify-out/graph.json` (or the parent `../graphify-out/merged-graph.json` for cross-repo questions) using `graphify query "<question>" --graph graphify-out/graph.json`, `graphify explain "<node>"`, or `graphify path "<A>" "<B>"`.
- Verify against source: treat graph results as a navigation aid, not authoritative proof of runtime behavior. Inspect actual source files, configuration, OpenAPI contracts, and tests before modifying code.
- Update after changes: after modifying code or docs, update the repository graph (`graphify update .` or `graphify extract . --code-only`) and refresh the merged parent graph (`graphify merge-graphs AiJob_search_backend/graphify-out/graph.json Ai_resume_frontend/graphify-out/graph.json --out graphify-out/merged-graph.json`). Keep `graphify-out/` ignored and uncommitted.

## Non-trivial implementation workflow

For non-trivial changes, understand the request, consult Graphify first, inspect relevant source and tests, explain the current behavior, identify dependencies and regression risks, and propose a minimal plan. Implement only the approved scope, run relevant tests and quality checks, review the final diff, and report results and remaining risks. Keep this workflow proportionate for simple isolated changes.

## Token-efficient development

- Prefer targeted graph queries and file searches; avoid unrelated module reads, repeated repository-wide scans, and duplicating large source excerpts in explanations.
- Do not regenerate Graphify artifacts without a reason. Keep plans and reports concise but technically complete; token efficiency does not replace required source inspection or tests.

## Git and commit safety

- Never amend, reset, or rewrite history without explicit authorization.
- Inspect Git status before staging and stage only intended files. Exclude credentials, secrets, local environment files, generated caches, and unintended Graphify artifacts from commits.
- Review the staged diff before committing. Run relevant tests and checks before committing, and report failed or skipped checks honestly. Never claim an unrun test passed.

## Git and engineering standards

- Follow `docs/engineering/standards.md` and `docs/engineering/parallel-work.md`; use conventional commit messages and merge branches with the documented branch model.
- Tests and smoke are loopback-only; use `tests/test-env.js` and never load hosted MongoDB or Redis URLs for tests.
- Husky hooks (`pre-commit`, `commit-msg`, `pre-push`), lint-staged, and commitlint are installed and enforced alongside CI and GitHub rulesets.
