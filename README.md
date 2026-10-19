# JobScout backend

Node.js/Express API and BullMQ worker for the JobScout career workspace. The frontend is a sibling checkout at `../Ai_resume_frontend`.

## Quick start

1. Install Node.js 22, MongoDB, and Redis. Copy `.env.example` to `.env` and replace required local placeholders.
2. Run `npm ci` in this directory and `npm ci` in `../Ai_resume_frontend`.
3. Development mode (TypeScript via `tsx`):
   - API Server: `npm run dev` (starts `src/main/server.ts` on `http://localhost:4001`)
   - Worker Service: `npm run worker:dev` (starts `src/main/worker.ts`)
   - Full Stack: `npm run dev:stack` (starts API, worker, and frontend)
4. Production build:
   - Compile: `npm run build` (compiles to `./dist`)
   - Run API: `npm start` (runs `dist/src/main/server.js`)
   - Run Worker: `npm run worker` (runs `dist/src/main/worker.js`)
5. Verification:
   - Typecheck: `npm run typecheck`
   - Test suite: `npm test`
   - Linting: `npm run lint`
   - Docs check: `npm run docs:check`

See [AI system documentation](docs/ai/README.md) for implementation details, limits, failure behavior, and target designs. See [local setup](docs/operations/local-setup.md) and [environment variables](docs/operations/environment-variables.md) before configuring integrations. Existing detailed documents under `docs/` are retained; the AI index identifies current verified sources.

Git branch and commit conventions: [engineering standards](docs/engineering/standards.md). Hooks are unverified until the owner installs them; see [hooks](docs/engineering/hooks.md) and [local setup](docs/operations/local-setup.md).

Engineering standards and local hooks: [standards](docs/engineering/standards.md), [hooks](docs/engineering/hooks.md), [branch protection](docs/engineering/branch-protection.md).

Beta operations: [production config checklist](docs/operations/production-config-checklist.md), [backup and restore](docs/operations/backup-restore.md), and [hosting options](docs/decisions/hosting.md).
