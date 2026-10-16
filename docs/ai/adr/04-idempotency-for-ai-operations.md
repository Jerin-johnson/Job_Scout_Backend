# ADR 04 — Idempotency for AI-triggering operations

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Interview session creation, answer writes, report completion and resume completion use idempotency/scoped state; quota counters accept idempotency keys. Not every generative endpoint has a request-level idempotency key.

## Target design (not built yet)

Require operation-scoped idempotency before retryable provider work. Persist accepted-operation/quota state once, make retries return existing results, and test replay and cross-user ownership.
