# 13 — Failure modes and runbooks

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

| Symptom                                        | Code behavior / diagnosis                                                                          | First safe action                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| No recommendations/all low                     | Read dev funnel: catalog, eligibility, cap, location and score histogram.                          | Check docs/JOB_MATCHING.md; verify facts, country code and source coverage. Do not tune weights from one profile. |
| Provider missing or unknown                    | Startup validates credential/model price; shared layer returns a safe provider error.              | Check variable names/catalog status without printing secrets; restart after config correction.                    |
| Free-tier personal data blocked                | Production guard returns AI_PERSONAL_DATA_PROVIDER_BLOCKED.                                        | Select a reviewed paid API policy or keep feature unavailable; do not weaken the guard.                           |
| Daily quota/cap                                | User/global spend or feature counter returns 429; monthly shadow only logs.                        | Inspect sanitized ledger/config; do not raise limits without approval.                                            |
| Redis outage in production                     | AI quota path fails closed with retryable 503.                                                     | Restore Redis and inspect API/worker readiness.                                                                   |
| Model transient error                          | Only classified 429, 5xx and network errors retry; timeout is not retried.                         | Use request ID/error class; retry user request only when appropriate.                                             |
| Stream fails/cancels                           | Stream finalization writes estimated partial/failure usage when user context exists.               | Inspect request ID/outcome; never log response content.                                                           |
| Resume S3 upload succeeds but completion fails | Completion may retry idempotently with the same key; facts reload is separate from upload success. | Retry completion, not the file upload; inspect request ID and S3 CORS, never expose signed URL.                   |
| Source run stuck                               | Check JobSource run state/lease/quota/circuit, Redis and BullMQ worker.                            | Do not clear locks or raise quota to force fetch; wait for allowed interval.                                      |
| Stale match result                             | Profile/score version participates in cache; empty match cache TTL is short.                       | Inspect profileVersion, scoreVersion, refresh status and cache health.                                            |

## Target design (not built yet)

Add deployed provider/queue runbooks, queue-age alerts, spend reconciliation and safe dry-run recovery commands. Add cache poisoning/stale-empty incident steps and a named kill-switch owner.

**Unverified:** production alert thresholds, restore RTO/RPO and Redis failover drills. Ask the on-call owner and inspect deployment runbooks.
