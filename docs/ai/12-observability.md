# 12 — Observability

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Structured logs use the shared logger. Chat completion events include latency, token counts, model, route and cache-hit metadata; failures log request ID and error class. UsageEvent includes feature, provider, plan, model, request/attempt, estimated usage, cost, latency and retry count. Development-only match debug shows funnel/profile counts, top job titles/scores and occupation families, not profile text or descriptions. Source registry stores fetched/new/updated/duplicate/error/latency and coverage counters.

Sentry initializes only when SENTRY_DSN is configured; release uses GIT_SHA or a version fallback. No Langfuse client use was found despite parsed LANGFUSE_* variables. No cost dashboard/alert implementation was found in this repository.

## Target design (not built yet)

Add dashboards/alerts for spend, quota blocks, partial streams, model latency, match funnel, source health and stale queues. Keep labels low-cardinality and omit profile IDs/text. Reconcile estimated UsageEvent spend with provider invoices.

**Unverified:** production Sentry scrubbing/sampling, log export/retention and provider billing integration. Confirm deployed settings and billing exports.
