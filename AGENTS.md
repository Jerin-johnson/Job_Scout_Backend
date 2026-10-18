# JobScout repository guide

JobScout is a Node.js 22 / Express backend with a sibling Next.js frontend. The API runs on port 4001, the web app on 3000, and BullMQ background work uses Redis and MongoDB.

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
- UI changes include responsive screenshots at 375/768/1280px in light and dark themes plus accessibility checks.
- Work in approved phases, pause at review gates, and ask before adding dependencies or infrastructure.
- If unsure, mark the claim Unverified and ask; do not present target designs as built behavior.

## Graphify-assisted codebase exploration

- For the reusable Graphify-guided exploration, implementation, validation, and review workflow, use `.agents/skills/graphify-development/SKILL.md` when applicable.
- Before exploring an unfamiliar feature or planning a change across multiple modules, check for the existing Graphify report and query the graph when it is available. Use the installed Graphify skill or commands confirmed by `graphify --help`; do not invent commands or query results.
- Use graph results to locate relevant files, modules, functions, classes, dependencies, and callers. Treat the graph as a navigation aid, not as authoritative evidence of runtime behavior.
- Inspect the actual source, configuration, and tests for the relevant components before changing them. Prefer focused graph queries and file searches over repository-wide reading; reuse current summaries instead of repeatedly reading large docs.
- Use judgment for small isolated changes; do not run an expensive graph operation when it adds no value.
- Reuse a readable, current graph. If it is missing, unreadable, or clearly stale, use the installed Graphify workflow to update or rebuild it. In Codex, `$graphify .` runs the full workflow and `$graphify . --update` requests an incremental update. The installed CLI also documents `graphify query "<question>" --graph graphify-out/graph.json`, `graphify update .`, and `graphify extract .`; verify syntax with `graphify --help` before use.
- If Graphify is unavailable, say so and continue with targeted source exploration. Never claim to have consulted a graph that was not usable.

## Non-trivial implementation workflow

For non-trivial changes, understand the request, consult Graphify when useful, inspect relevant source and tests, explain the current behavior, identify dependencies and regression risks, and propose a minimal plan. Implement only the approved scope, run relevant tests and quality checks, review the final diff, and report results and remaining risks. Keep this workflow proportionate for simple isolated changes.

## Token-efficient development

- Prefer targeted graph queries and file searches; avoid unrelated module reads, repeated repository-wide scans, and duplicating large source excerpts in explanations.
- Do not regenerate Graphify artifacts without a reason. Keep plans and reports concise but technically complete; token efficiency does not replace required source inspection or tests.

## Git and commit safety

- Never commit automatically unless explicitly requested. Never amend, reset, or rewrite history without explicit authorization.
- Inspect Git status before staging and stage only intended files. Exclude credentials, secrets, local environment files, generated caches, and unintended Graphify artifacts from commits.
- Review the staged diff before committing. Run relevant tests and checks before recommending a commit, and report failed or skipped checks honestly. Never claim an unrun test passed.

## Git and engineering standards

- Follow `docs/engineering/standards.md`; use conventional commit messages and merge branches with the documented branch model.
- Tests and smoke are loopback-only; use `tests/test-env.js` and never load hosted MongoDB or Redis URLs for tests.
- Hooks are unverified until installed by the repository owner. CI and GitHub rulesets are the actual enforcement layer.
