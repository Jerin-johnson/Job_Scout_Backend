# 03 — Cost, quota, and limits

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

quotaService checks AI_KILL_SWITCH, Redis-backed daily spend, global spend, feature counters, and monthly shadow allowance. DAILY_USER_USD_BUDGET defaults to $5/day; GLOBAL_DAILY_USD_CAP defaults to $500/day. Daily/global caps block. Monthly allowance logs would-block only when AI_MONTHLY_ALLOWANCE_SHADOW_MODE=true; there is no monthly enforcement/reservation. Standard spend keys use UTC calendar dates; mock-interview daily quota uses a validated user timezone.

Redis outage in production fails AI operations with retryable 503; in-memory counters are allowed only outside production with AI_ALLOW_MOCKS=true. Shadow ratio defaults to 0.25 of plan price. A user/global spend precheck is not atomic with provider calls, so concurrent calls can race.

UsageEvent stores provider/model, feature, plan/version, request/attempt IDs, status/outcome, estimated-usage flag, input/output/cached tokens, pricing version, retries, cost and latency; TTL is 90 days. Writes are awaited before a successful model call returns; streams record partial/cancelled usage during finalization. Tokens can be estimated when provider metadata is missing.

Mock interviews: Premium default 3 sessions/day; token cap 12,000/session; trial disabled by default; retention 90 days; question/evaluation tiers small, final report strong. Config is in src/config/env.js and session service. The session reserves token room for the report and stores consent timestamp/version.

Unit-cost formula: (inputTokens × inputRate + outputTokens × outputRate + cachedInputTokens × cachedRate + cacheWriteTokens × writeRate) / 1,000,000. Model rates live in src/ai/modelPricingCatalog.js. No sanitized production ledger totals or representative prompt-token distributions were available, so actual cost/request and monthly bill are **Unverified**. Matching hot-path model cost is $0/request because scoring is deterministic; hosting and source API costs are separate.

## Target design (not built yet)

Add atomic reserve-before-call and settle-after-call, feature-specific kill switches, plan entitlements, idempotent settlement and provider billed-usage reconciliation. Run shadow evaluations before enforcement. No monthly enforcement or UI meter is implemented.

**Unverified:** Redis failover, deployment clock synchronization, production plan billing and provider billing exports. Check production telemetry before setting limits.
