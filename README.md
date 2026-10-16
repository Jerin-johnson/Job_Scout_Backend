# JobScout API (`jobscout-api`)

Production-ready backend API service for **JobScout**, the subscription-based AI job-hunt agent (_Discover &rarr; Evaluate &rarr; Prepare &rarr; Manage_).

## Architecture Highlights

- **Framework**: Node.js 22 LTS + Express.js (ES Modules, pure JavaScript, JSDoc + Zod contracts).
- **Dual Process Entry**: `server.js` (HTTP REST + SSE) and `worker.js` (BullMQ workers), built from a single Docker image.
- **AI Router & Cost Guard**: 3-tier routing (Tier 0: exact/semantic cache, slash commands, direct DB; Tier 1: Haiku intent classification; Tier 2: Sonnet LangGraph workflows).
- **Security**: AES-256-GCM encryption for resume PII, strict SSRF blocking, CSRF defense, rate-limiting, and quota enforcement.
- **LLM providers**: Gemini is the default provider; Anthropic remains selectable through the shared `invokeLLM` boundary. See [`docs/LLM_PROVIDERS.md`](./docs/LLM_PROVIDERS.md).
- **Environment and credentials**: See [`docs/ENVIRONMENT_SETUP.md`](./docs/ENVIRONMENT_SETUP.md) for the backend/frontend variables, required secrets, integrations, and setup steps.
- **Job discovery**: catalog search spans indexed jobs from approved, enabled sources (currently Remote OK, Remotive, and Jobicy); it is not the whole internet. Profile-ranked recommendations are separate and do not trigger ingestion. See [`docs/JOB_CATALOG_INGESTION.md`](./docs/JOB_CATALOG_INGESTION.md).
- **Product architecture and scaling**: see the repository-level [`ARCHITECTURE_AND_SCALING.md`](../ARCHITECTURE_AND_SCALING.md) for frontend/backend boundaries and the staged scaling plan.
- **Admin operations**: role-protected metrics, account/job directories, audit entries, and explicit job ingestion are available under `/api/v1/admin`.
- **Admin setup**: see [`docs/ADMIN_OPERATIONS.md`](./docs/ADMIN_OPERATIONS.md) for secure first-admin provisioning and console operations.
- **AI mock interviews**: see [`docs/AI_MOCK_INTERVIEWS.md`](./docs/AI_MOCK_INTERVIEWS.md) for the session API, consent, quotas, lifecycle, database indexes, and rollout steps.

## Quickstart

### 1. Prerequisites

- Node.js >= 22.0.0
- Docker & Docker Compose (optional for local Mongo + Redis)

### 2. Setup Environment

```bash
cp .env.example .env
npm install
```

### 3. Local Infrastructure (Docker)

```bash
docker compose up -d
```

The API is published at `http://localhost:4001`; the frontend runs at `http://localhost:3000`.
With MongoDB/Redis running and both projects installed, `npm run dev:stack` starts the API and frontend together.

### 4. Running the Services

```bash
# Start the API and frontend together (the frontend lives beside this repo).
npm run dev:stack

# Start API Server in dev watch mode
npm run dev

# Start Background Worker in dev watch mode
npm run worker:dev

# Run Smoke Tests
npm run smoke

# Synchronize Database Indexes
npm run ensure-indexes

# Generate OpenAPI Specification
npm run openapi
```

## Verification & Deployment

- Run `npm run smoke` to test health, security headers, structured error handling, auth, AI routing, and webhook idempotency.
- CI automatically checks formatting (`npm run format`), linting (`npm run lint`), and builds the production Docker container.
