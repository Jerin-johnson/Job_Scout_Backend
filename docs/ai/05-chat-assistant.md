# 05 — Chat assistant

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

POST /api/v1/ai/chat/stream validates a prompt up to 2,000 characters and at most six bounded history turns, consumes chat quota, builds server candidate context, calls routeRequest, resolves Auto or an allowlisted model, formats messages and streams SSE through streamLLM (src/controllers/aiController.js:80–148). A 30-second abort signal is used. The frontend uses react-markdown + GFM; raw HTML is disabled, remote images are suppressed, URLs are transformed/allowlisted, and user messages remain plain text.

Profile context is a turn-grounding card in src/ai/candidateContext.js; the client supplies bounded history per request. Chat does not call long-term memory retrieval or execute tools. A separate memory API/storage exists and job feedback can write memory; the pause flag is not visibly checked in that write path.

## Target design (not built yet)

Add session persistence and opt-in memory gated at every read/write; expose only read-only server-authorized tools; return action suggestions requiring user confirmation; route by measured complexity after verifying actual small/strong model differences. Keep streaming ledger and content-free logs.

**Unverified:** deployed CSP and production model allowlist. Verify response headers and GET /api/v1/ai/models after release.
