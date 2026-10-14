# JobScout API - Architectural & Operational Assumptions

1. **Standalone Package Structure**:
   - Single root `package.json` with ESM (`"type": "module"`), Node 22+.
   - No frontend code or monorepo workspaces in this repository; Next.js frontend will consume `jobscout-api` via documented API contract and OpenAPI specs.

2. **Database & External Services Graceful Degradation (Local / CI Smoke Execution)**:
   - When MongoDB or Redis are not reachable or unset in the environment, the application will not abruptly crash on import or module loading.
   - Per requirements:
     - **Redis down**: Cache operations fail OPEN (bypass cache transparently), rate-limiter fails OPEN for cheap reads and CLOSED for heavy mutating actions.
     - **Mongo disconnected / Mock mode**: Healthcheck `/health/ready` accurately reports service connectivity status (returns 503 if dependencies are unreachable, 200 if connected).
     - **Smoke test suite (`scripts/smoke.js`)**: Can run against a running HTTP server via `BASE_URL` or launch the Express app in-process with mock/in-memory stubs for disconnected cloud services so that developer smoke checks pass deterministically in CI/local even without live Atlas/Redis instances.

3. **Models & AI Engine**:
   - Small Model: `MODEL_SMALL` (default `claude-3-5-haiku-latest` / `claude-haiku-5-5`).
   - Strong Model: `MODEL_STRONG` (default `claude-3-5-sonnet-latest` / `claude-sonnet-5-5`).
   - Embedding Provider: `EMBEDDING_PROVIDER` (`voyage` or `openai`), falling back to a deterministic semantic embedding mock if API keys are dummy/not provided during testing.
   - All LLM invocations route strictly through `src/ai/llm.js`.

4. **Security & Cryptography**:
   - Field-level AES-256-GCM encryption for stored resume text uses `RESUME_ENCRYPTION_KEY` (32-byte hex or base64) with key versioning (`v1`).
   - SSRF protection: URL ingestion validates target IPs using a private-range blocklist (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`).
   - CSRF protection: Requires custom header `X-Requested-With` or `Sec-Fetch-Site` plus strict `Origin` header validation against `WEB_ORIGIN`.

5. **Human Approval Safeguards**:
   - Tailored resumes and email drafts require human approval via the LangGraph `interrupt()` mechanism before export (PDF/DOCX) or dispatch (Resend).
   - Auto-apply is intentionally omitted from the MVP.
