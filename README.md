# JobScout API (`jobscout-api`)

Production-ready backend API service for **JobScout**, the subscription-based AI job-hunt agent (_Discover &rarr; Evaluate &rarr; Prepare &rarr; Manage_).

## Architecture Highlights

- **Framework**: Node.js 22 LTS + Express.js (ES Modules, pure JavaScript, JSDoc + Zod contracts).
- **Dual Process Entry**: `server.js` (HTTP REST + SSE) and `worker.js` (BullMQ workers), built from a single Docker image.
- **AI Router & Cost Guard**: 3-tier routing (Tier 0: exact/semantic cache, slash commands, direct DB; Tier 1: Haiku intent classification; Tier 2: Sonnet LangGraph workflows).
- **Security**: AES-256-GCM encryption for resume PII, strict SSRF blocking, CSRF defense, rate-limiting, and quota enforcement.

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

### 4. Running the Services

```bash
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
