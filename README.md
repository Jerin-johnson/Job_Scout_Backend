# JobScout backend

Node.js/Express API and BullMQ worker for the JobScout career workspace. The frontend is a sibling checkout at `../Ai_resume_frontend`.

## Quick start

1. Install Node.js 22, MongoDB, and Redis. Copy `.env.example` to `.env` and replace required local placeholders.
2. Run `npm ci` in this directory and `npm ci` in `../Ai_resume_frontend`.
3. Run `npm run dev:stack` here to start API (`localhost:4001`), worker, and web (`localhost:3000`).
4. Run `npm run lint` and `npm test` for static checks and the unit/MongoDB-memory-server test suite.

See [AI system documentation](docs/ai/README.md) for implementation details, limits, failure behavior, and target designs. See [local setup](docs/operations/local-setup.md) and [environment variables](docs/operations/environment-variables.md) before configuring integrations. Existing detailed documents under `docs/` are retained; the AI index identifies current verified sources.

Git branch and commit conventions: [engineering standards](docs/engineering/standards.md). Hooks are unverified until the owner installs them; see [hooks](docs/engineering/hooks.md) and [local setup](docs/operations/local-setup.md).
