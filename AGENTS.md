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
