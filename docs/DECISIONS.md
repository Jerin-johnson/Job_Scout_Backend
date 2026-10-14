# Architecture Decision Records (ADRs)

This document tracks fundamental architectural decisions, the context behind them, and their consequences.

---

## ADR-001: Standalone Express Backend vs Monorepo Workspaces

### Context

Initial consideration explored an npm monorepo with web and api workspaces. However, decoupling the frontend client (`jobscout-web`) into its own repository allows the backend (`jobscout-api`) to operate as an independent, focused microservice with distinct deployment pipelines, containerization, and scaling requirements.

### Decision

JobScout API is implemented as a **standalone repository** with a single root `package.json` (no workspaces). The frontend repository consumes the API via the versioned REST + SSE contract and OpenAPI specification.

### Consequences

- **Positive**: Simpler container builds, zero shared-dependency hoisting issues, independent CI/CD release cycles.
- **Negative**: Shared contracts must be published or synchronized via OpenAPI generation (`npm run openapi`).

---

## ADR-002: Pure ES Modules with JSDoc + Zod (Zero TypeScript)

### Context

TypeScript introduces build compilation steps, source map overhead, and potential type divergence from runtime behavior. We require strict runtime contracts without compilation overhead.

### Decision

Use pure JavaScript (Node.js 22 LTS ES Modules). Enforce static types via standard JSDoc annotations and enforce runtime verification using Zod schemas for all network boundaries (HTTP requests, LLM structured outputs, and database mutations).

### Consequences

- **Positive**: Zero compile steps; instant hot-reloading (`node --watch`); runtime safety guarantees where TypeScript cannot help (untrusted user inputs and LLM completions).
- **Negative**: Requires discipline in writing JSDoc tags for developer tooling autocompletion.

---

## ADR-003: Dual-Process Topology (`server.js` + `worker.js`) from One Image

### Context

Web traffic (HTTP requests, SSE chat streams) requires low-latency, non-blocking responsiveness. Ingestion of thousands of job postings, vector embedding calculations, and scheduled email digests are CPU/IO-intensive background tasks.

### Decision

Package both services into a single Docker image with two entrypoints:

- `node src/server.js`: HTTP API server.
- `node src/worker.js`: BullMQ worker service.
  In staging/production (Railway/Fly/Render/K8s), scale the HTTP process for API traffic and scale the worker process based on queue depth.

### Consequences

- **Positive**: Single build artifact in CI; shared codebase and database models; background crashes cannot terminate API servers.
- **Negative**: Requires independent deployment service configuration for web and worker.

---

## ADR-004: Centralized LLM Wrapper (`src/ai/llm.js`) as Single Chokepoint

### Context

Direct model calls across multiple controllers lead to unmonitored token spending, missing prompt caching, lack of circuit breakers, and unmanaged rate limits.

### Decision

**Every** model invocation across the entire system must route through `src/ai/llm.js`. Direct calls to `@langchain/anthropic`, `@langchain/openai`, or other SDKs outside this file are strictly forbidden. The wrapper enforces:

1. Anthropic prompt caching (`cache_control: { type: "ephemeral" }`) on static system prompts and profile facts.
2. Hard limits (`max_tokens`, timeouts, and circuit breakers).
3. Pre-flight user daily USD budget and quota checks.
4. Telemetry logging to `usageEvents` and Langfuse tracing.

### Consequences

- **Positive**: Guaranteed cost guardrails; prompt caching reduces repeated token costs by up to 90%; instant observability.
- **Negative**: Any new model parameter or provider capability must be exposed through the wrapper interface.

---

## ADR-005: 3-Tier AI Router with Parallel Race Optimization

### Context

Running full LLM classification sequentially before responding introduces 800–1500ms latency and consumes model tokens even for trivial queries or repeat questions.

### Decision

The AI Router executes **Tier 0** (exact/semantic cache, slash commands, direct Mongo queries) and **Tier 1** (Claude 3.5 Haiku structured classifier) in **parallel**. If Tier 0 yields an instant hit, Tier 1 is aborted via `AbortController` and the cached result is returned in < 50ms ($0.00 cost). Only complex tasks with confidence >= 0.7 escalate to Tier 2 (Claude 3.5 Sonnet + LangGraph).

### Consequences

- **Positive**: 70–80% of traffic handled at Tier 0/1; sub-50ms responses for cached/deterministic requests; drastic cost reduction.
- **Negative**: Slight complexity in managing parallel promise racing and abort signals.

---

## ADR-006: Mandatory Truthfulness Validation via Fact IDs (`factId`)

### Context

LLMs frequently hallucinate job titles, employment durations, metrics, or technologies when tailoring resumes to match job descriptions, exposing candidates to severe professional risk.

### Decision

During candidate resume parsing, experience and skills are converted into immutable **STRUCTURED FACTS**, each tagged with a unique `factId` (nanoid). During resume tailoring (LangGraph Graph B), a mandatory `truthfulnessCheck` validates every generated bullet point against existing `factId`s. Bullets without verified sources are rejected and regenerated (max 2 retries) or dropped. Inventing employers, degrees, dates, or metrics is barred.

### Consequences

- **Positive**: 100% auditable resume claims; candidates can defend every bullet point in interviews; trust and compliance.
- **Negative**: Requires extra validation node latency during resume generation.

---

## ADR-007: Resilience Matrix: Fail-Open Cache vs Fail-Closed Heavy Quotas

### Context

In distributed production systems, Redis or external dependencies may experience temporary transient unavailability. The system must degrade gracefully.

### Decision

1. **Redis Down &rarr; Cache Fails OPEN**: Cache reads return `null`, allowing the application to fetch from MongoDB Atlas or compute the result directly.
2. **Redis Down &rarr; Quota Fails CLOSED for Heavy Tier 2 Actions**: Prevents unmetered expensive LLM runs during Redis outages.
3. **Redis Down &rarr; Rate Limiter Fails OPEN for Cheap Reads**: Prevents legitimate users from being locked out of read-only dashboard browsing.

### Consequences

- **Positive**: High uptime for users during cache flushes while protecting corporate API budgets against infinite spend.
- **Negative**: Users temporarily cannot trigger heavy resume tailoring if Redis is fully down.

---

## ADR-008: Refresh Token Rotation with Token Family Reuse Detection

### Context

Stolen refresh tokens stored in cookies or client storage can allow attackers persistent unauthorized account access.

### Decision

Implement refresh token rotation where every refresh token belongs to a cryptographic `familyId`. Each time a refresh token is used, it is revoked and replaced by a new token in the same family. If a previously used/revoked token is presented again (indicating token replay or theft), the **entire token family is immediately revoked**, invalidating all sessions for that device.

### Consequences

- **Positive**: State-of-the-art token security; immediate mitigation against stolen refresh tokens.
- **Negative**: Users with network race conditions might occasionally need to re-login if multiple parallel requests use the same refresh token.

---

## ADR-009: Verification via `npm run smoke` rather than Test Suites

### Context

Traditional unit test suites often mock too many layers and fail to verify actual end-to-end integration, health checks, database connections, and latency targets.

### Decision

Verification is driven exclusively by `npm run smoke`, an automated script that tests the live server contract, latency per step, security headers, structured errors, caching, auth flows, and AI routing. This same script acts as the staging release gate in CI/CD before production deployment.

### Consequences

- **Positive**: Guarantees actual production readiness and measured step latencies; zero test-runner bloat.
- **Negative**: Requires running instances or mock-mode fallbacks to execute locally.
