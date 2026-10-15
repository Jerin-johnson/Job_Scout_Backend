# AI cost-control research and implementation plan

**Prepared:** 2026-10-15  
**Scope:** Research and read-only audit of the current JobScout backend. This report does not change application code.  
**Pricing note:** Public provider rates and terms change. Prices below are the values visible in the linked provider sources on the access date; verify again before rollout.

## Executive summary

### Five findings that matter most

1. **Request quotas are configured but the normal request path does not increment them.** `quotaService.incrementQuota()` is defined, but a repository-wide search found no callers. The advertised daily chat, match, and monthly tailoring count limits therefore do not currently limit consumption. See `src/services/quotaService.js:70-190`.
2. **USD limits are preflight checks, not spend reservations.** Concurrent requests can all read the same remaining balance and proceed; spend is written only after a provider response. Provider calls that succeeded but whose response/usage logging failed can be omitted. This makes both the per-user daily budgets and global cap advisory rather than hard ceilings (`src/services/quotaService.js:70-108,194-252`; `src/ai/llm.js:123-135,219-250`).
3. **Redis failure changes enforcement to per-process memory.** Multiple instances each get independent counters, and counters reset on restart. For a global spend cap and abuse protection, this is a fail-open behavior, not a safe degraded mode (`src/services/quotaService.js:254-333`).
4. **Embedding usage is outside the LLM ledger and can silently become synthetic vectors.** Job discovery, memory retrieval, and ingestion call embedding APIs directly; the service records no tokens/cost and catches errors by returning deterministic mock vectors. In production, retrieval can look successful while using semantically meaningless vectors (`src/services/embeddingService.js:39-80`; call sites listed in Audit).
5. **The configured plan budgets do not match subscription economics at full utilization.** Current daily caps permit $3/$45/$150 per 30-day month for Free/Pro/Premium, against locally configured subscription prices $0/$15/$35. These are upper spending allowances, not profitable targets. A 25%-of-revenue threshold only warns after spend; it does not stop calls.

### Five recommended actions

1. Treat the LLM gateway as a **hard policy boundary**: authorize entitlement, atomically reserve a maximum cost/token amount, call a provider, reconcile actual usage, then release unused reservation. If the durable reservation store is unavailable, reject paid AI work with a clear retryable 503; never silently switch production enforcement to local memory.
2. First fix correctness and measurement: wire request counters; ledger every generation and embedding; use provider/model/version, plan-at-request, request/idempotency IDs, estimated-vs-reported usage, outcome, and timestamp; await durable writes or use a transactional outbox.
3. Set maximum per-call input/output and session limits; allow only explicitly configured model IDs with current rates. Keep paid-tier models disabled unless the product entitlement explicitly permits them and budgets reserve their worst-case cost.
4. Introduce a plan-aware **monthly AI allowance** plus a daily abuse throttle, rather than allowing a user to spend their full daily USD cap for 30 days. Set plans from measured unit economics and a margin target, then support usage-based top-ups only with user consent.
5. Do not route resumes or other personal data through an unpaid provider tier by default. Google’s Gemini API terms for Unpaid Services say submitted content and responses may be used to improve products and may be reviewed by people; Paid Services have materially different terms. Make provider/plan eligibility, disclosure, consent, retention, and region decisions explicit before production launch.

## 1. Product and market research

### What cost control should optimize

Treat AI as a variable cost of serving a user, not as an undifferentiated API bill. For a plan, calculate:

`AI gross margin = (net subscription revenue − attributable AI inference/embedding cost) / net subscription revenue`

Use net revenue after refunds, taxes, payment fees, discounts, and collection failures when those figures are available. The present code only has a local plan list and payment capture/refund events; it does not calculate contribution margin by cohort. No credible universal “AI cost as a percent of revenue” threshold applies to this product. Pick a target margin as a business decision, then validate it with observed distributions (median, p90/p95, maximum, and abuse cases), not only the average.

Use four linked control layers:

- **Entitlement:** whether this account/plan may invoke this feature and model class.
- **Allowance:** user and plan limits over a clear billing period, with an explicit UI balance and policy for exhaustion.
- **Abuse control:** rate limits, concurrency limits, token-size limits, retry budgets, and spend velocity controls.
- **Business kill controls:** per-provider/model/feature switches and a global stop, backed by alerting and an audited operator workflow.

Request-count-only caps are simple to explain but unfair across model and prompt sizes. Token-only caps overlook model price differences, retries, cache billing, embeddings, and tools. A spend allowance is economically aligned but needs a reliable cost estimator and reservation. A hybrid is most suitable here: plan feature entitlements + monthly spend/token allowance + daily and per-minute safety caps + per-session caps for long workflows.

### Attribution and gateway pattern

Maintain an internal gateway contract that is independent of provider SDKs. Each invocation should have an immutable request ID and record: account and plan snapshot, feature, provider, exact model ID/version, region/tier where applicable, input/output/cache token counts, whether counts are provider-reported or estimated, estimated/reserved/final cost, latency/first-token latency, retry count, cancellation/timeout/error outcome, stream completion, and pricing-table version. Do not store raw prompts/resume text in cost analytics. Use a provider adapter registry as the extension seam; policy, entitlement, reservations, telemetry, redaction, retry decisions, and streaming cancellation belong in the shared gateway, not in each adapter.

The present `UsageEvent` has a useful start (`feature`, `model`, token/cache counts, cost, latency), but does not store provider, plan, request/trace ID, outcome, estimation status, or reservation linkage. It has a 90-day TTL (`src/models/UsageEvent.js:1-52`). A TTL ledger can support recent dashboards; it is not by itself a financial ledger. Preserve billing/provider invoices separately and reconcile sampled usage and provider invoices.

### Current provider facts relevant to JobScout

| Provider / model in current implementation | Published API price | Availability and privacy observations | Recommendation |
|---|---:|---|---|
| Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`) | $0.30/M input, $2.50/M output (paid standard pricing) | Current Google model guide presents it for production use. Unpaid quota has different data terms and Google explicitly says not to submit sensitive, confidential, or personal information to Unpaid Services. | Keep as the low-cost default only under an explicitly selected and approved service tier; do not call the user-facing model “free” as a guarantee. |
| Gemini 3.6 Flash (`gemini-3.6-flash`) | $0.75/$3.75 per M through 2026-12-31; $1.50/$7.50 from 2027-01-01, according to the model launch guide | Current catalog shows it enabled and eligible for “free tier”; actual free availability/limits are project/account dependent. | Strong model candidate, but pricing config must be time-aware and should not equate free quota with privacy-safe processing. |
| Gemini 3.8 Flash (`gemini-3.8-flash`) | $0.75/$3.75 per M through 2026-12-31; $1.50/$7.50 from 2027-01-01 | Current Google recommendation for new projects; free quota is still account/project and terms dependent. | The current local rate table misses this enabled model; add/test its effective-date rate before allowing paid traffic. |
| Gemini 2.5 Flash-Lite | $0.10/$0.40 per M | Google says access is limited to projects that actively used 2.5; not a good assumption for new projects. | Legacy option only; don’t make this the new-account default. |
| Gemini 2.5 Flash | $0.30/$2.50 per M | Same legacy project access restriction. | Keep explicitly marked legacy; verify project eligibility. |
| Groq GPT-OSS 20B (`openai/gpt-oss-20b`) | $0.075/$0.30 per M; cached input price shown as $0.0375/M | Free-plan limits shown by Groq: 30 RPM, 1K RPD, 8K TPM, 200K TPD (account/model-specific; recheck console). Prompt caching is automatic on supported models, no extra charge, with discount only on successful hit. | Strong candidate for low-cost chat after privacy/quality review and a realistic throughput check. The UI must not imply limitless free service. |
| Groq GPT-OSS 120B (`openai/gpt-oss-120b`) | $0.15/$0.60 per M; cached input price shown as $0.075/M | Same free-plan limits shown for this model; limits are low relative to broad product traffic. | Good higher-capability alternative; enforce budget, fallback rules, and provider rate-limit handling. |
| OpenAI `text-embedding-3-small` | $0.02/M input tokens | OpenAI states API inputs/outputs are not used for training by default; abuse monitoring logs may contain content and are retained up to 30 days by default. | Current code’s OpenAI embedding choice is inexpensive, but must be metered and selected deliberately. |
| Voyage `voyage-large-2-instruct` | $0.12/M tokens (listed as older model pricing; no free tokens offered for it) | Current Voyage embedding docs show 16,000-token input limit and 1024 dimensions. Voyage batch has 12-hour completion window and 33% discount for supported current models; validate this older model’s batch support before relying on it. | The model is an older API choice. Verify supported/current model and vector dimensions before launch; do not silently mix embedding spaces. |
| Anthropic configured fallback | Provider adapter pricing is hard-coded by “haiku”/“sonnet” family, not exact model ID. | Current defaults `claude-3-5-haiku-20241022` and `claude-3-5-sonnet-20241022` are retired (Haiku 3.5 Feb 19, 2026; Sonnet 3.5 Oct 28, 2025). | Provider is operationally unsafe with these defaults; set supported active models and exact price metadata or disable Anthropic until done. |

Rates above are list prices, not a quote or a promise of free credits. Provider free tiers change, are subject to per-project limits, and may apply different data terms. A model catalog’s `access: "free_tier"` is not an enforcement mechanism for billing status, project eligibility, or data policy.

### Cost-control patterns observed in adjacent products

There is no single standard SaaS plan formula. Mature products commonly combine a subscription feature entitlement with an included allowance and disclose what happens when the allowance is used; some expose paid overage while others throttle or ask users to upgrade. For JobScout, the useful design principle is **transparent limits by plan and feature, not a hidden backend-only ceiling**. Keep model selection separate from entitlement so a provider/model can be added without duplicating plan rules. Show the user a monthly allowance, a near-limit warning, and the exhaustion/reset date. Admins need aggregate spend and per-feature/provider margin, not only API-key spend.

## 2. Code audit

### Inventory of billable paths

All observed generation calls are routed through `invokeLLM()` or `streamLLM()`:

| Workload | Current call site(s) | Current accounting/control |
|---|---|---|
| Chat response | `src/controllers/aiController.js:123` → `src/ai/llm.js:268` | Chat quota precheck, selected model routing, stream telemetry only after generator finishes. |
| Intent classification | `src/ai/router.js:123` | Uses shared invocation; route logs currently set `costUsd: 0`, so routing analytics understate classifier cost. |
| Resume extraction | `src/services/resumeParserService.js:159,176` | One small-model extraction plus strong retry when grounded facts are inadequate; separate billable invocations. |
| Resume tailoring / cover letter | `src/ai/graphs/tailoringGraph.js:62,138` | Shared gateway; extraction and tailor features differ. |
| Interview preparation | `src/ai/graphs/interviewGraph.js:155,258` | Shared gateway. |
| Mock-interview question plan | `src/services/interview/sessionService.js:219` | Generated at session creation, before start-quota reservation. Repeated draft creation can incur repeated model cost without consuming the daily started-session quota. |
| Mock-interview answer evaluation and report | `src/services/interview/sessionService.js:626,716` | Session token reservation/cap exists; report schema retries once, but each gateway retry/report retry can add provider cost. |
| Job/profile/memory embeddings | `src/services/embeddingService.js:43-80`, called by `jobIngestionService.js:62`, `discoveryGraph.js:44`, `longTerm.js:49,154` | **Not in UsageEvent or plan/global USD checks.** Job embeddings have a 90-day shared content-hash cache. |

### Current enforcement and the concrete gaps

- **Plan allowances exist:** `src/shared/constants/plans.js:1-76` defines Free/Pro/Premium prices `$0/$15/$35` monthly (USD), INR `$0/₹1,200/₹2,800`, and daily AI budgets `$0.10/$1.50/$5`. Chat request limits are 20/200/1,000 per day; match and tailoring counters also exist. Their counter-increment method has no call site, so those request ceilings are not actually applied.
- **USD prechecks exist:** `checkQuota()` checks kill switch, user-day spend, global-day spend, and some feature counters. It does not reserve funds before provider work. Provider usage is recorded only after success, mostly asynchronously. Unknown provider pricing returns zero (for example the Gemini estimator returns zero when it has no rate entry), making an unpriced model effectively free to the internal budget.
- **Global limit is not global under outage:** spend/counters fall back to an in-process `Map`. With N app processes, there can be N separate observed budgets; a process restart loses them. The comment that makes a “Redis fails open” decision is material for financial exposure.
- **UTC and local-day definitions differ:** general AI daily spend/counters use UTC date keys; mock-interview started-session quota uses the user-local day. A user can encounter two reset policies on the same screen unless product copy distinguishes them.
- **Free offline/mock responses are mixed with production behavior:** a missing provider credential produces a mock text/schema response in `src/ai/llm.js:139-181,287-304`. This helps local development but can make production appear healthy while giving non-AI results if provider setup is absent. Production should fail startup or health-check readiness, not degrade silently to a mock.
- **Retry policy can multiply spend:** `invokeLLM()` retries any non-abort error up to two additional times (`src/ai/llm.js:187-215`), rather than only safe transient failures. A timeout after a provider accepted/processed a request can result in a second billable attempt. Mock interview report separately retries invalid output once (`sessionService.js:714-760`). Add an explicit per-request retry/spend ceiling and classify retryable failures.
- **Streaming disconnects can hide partial cost:** chat forwards cancellation (`aiController.js`), which is good. But when any stream output has been emitted and then the provider stream fails/cancels, the generator throws before final ledger write (`llm.js:313-359`). Partial provider usage may be billed but is lost locally. The current `usageIsEstimated` check occurs after estimated token fallback, so it can incorrectly report estimates as provider-reported. Non-stream call paths do not consistently add request deadlines.
- **Usage ledger is best effort:** Mongo write is fire-and-forget, Redis counters update separately, and failed event writes only log. There is no reconciliation trail. A post-provider Redis exception falls back to memory. For a financial policy, one failed analytics write must not quietly erase attribution or unblock more calls.
- **Embedding provider selection/fallback is unsafe:** `EMBEDDING_PROVIDER=voyage` without a Voyage key can fall through to OpenAI, possibly creating an unexpected bill. Any provider failure returns a deterministic mock embedding. Production matching then returns plausible but wrong results without a visible status. Embedding costs never affect `GLOBAL_DAILY_USD_CAP`.
- **Embedding index-space risk:** OpenAI `text-embedding-3-small` produces 1,536 dimensions by default, while Voyage `voyage-large-2-instruct` produces 1,024. `Job.embedding` is a generic number array and has no provider/model/version metadata. Switching providers without re-embedding invalidates cosine comparisons. The job embedding cache key contains only content hash; it does not include provider/model/version, so changing embedding config can also reuse incompatible vectors.
- **Prompt cache:** `CacheKeys.exactQuery()` is read-only in the repository search; no writer was found. Its key is SHA-256 of normalized raw prompt plus context version and has no user ID. At present no output is cached through this route, so there is no known cross-user cached-response leak there; do not add a writer without user/content policy and tenant-aware keys. The resume-facts cache key is based on the global file hash and can reuse sensitive extracted facts across accounts (`CacheKeys.resumeParse`, `resumeParserService`); audit its cache value/retention and scope before expansion.
- **Cache helps some, but not all, repeat work:** job embeddings cache by content hash for 90 days; resume parse facts by file hash for 30 days; candidate context and memory have user/version keys. Cache hit/miss metrics are process counters, not durable cost attribution. The LLM wrapper’s “Anthropic cache_control” prompt formatting is not portable: Gemini maps those parts to plain text, and Groq folds system text into a user message. Gemini implicit caching is provider-side and not guaranteed. Existing usage extraction does not account for Gemini cached-token usage or Groq cached prompt tokens.
- **Rate limiting is not a spend limiter:** general 100/min, auth 10/15min, and heavy AI 10/min limit API velocity but not token/cost amounts. In-memory fallback is per-process. The heavy limiter is described as fail-closed in a comment but `createStore()` chooses memory when Redis is not ready; verify behavior under a live Redis failure.
- **Admin financial visibility is partial:** `/admin/metrics` gets daily AI cost from UsageEvent but uses server-local midnight while quota spend keys use UTC, and it counts only usage events (missing embeddings and failed streams). Billing overview aggregates captured/refunded Razorpay payments in original currencies; it does not include provider spend, payment fees/tax, FX normalization, refunds pending reconciliation, or cohort margin (`src/controllers/adminController.js:34-131,284-365`).

### Tiers, models, keys, startup, and repository hygiene

- **Product prices in config:** Free `$0`, Pro `$15`, Premium `$35`; internal INR amounts are `$0/₹1,200/₹2,800`. Razorpay plan IDs in `.env.example` are placeholders. The actual Razorpay subscription amount was not verified because it is controlled by the remote Razorpay plan configuration. Check production Razorpay plan IDs/amount/currency against `PLAN_CONFIG` before showing a margin dashboard.
- **Configured budgets:** `.env.example` sets `DAILY_USER_USD_BUDGET=5` and `GLOBAL_DAILY_USD_CAP=500`, but a normal plan’s nonzero `dailyUsdBudget` takes precedence. The environment value is fallback only. `AI_KILL_SWITCH` exists and `checkQuota()` enforces it for user-associated generation calls; direct embedding calls do not use that gate.
- **Provider keys:** backend secrets are `GEMINI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `VOYAGE_API_KEY`; none belong in frontend environment variables. Only the selected LLM provider key should be required in a production deployment, plus exactly one configured embedding provider key when embedding-backed product features are enabled.
- **Production startup validation:** JWT access/refresh and resume-encryption values must be 32+ chars. Provider/payment/storage/email envs still accept dummy defaults or empty strings; `NODE_ENV=production` does not enforce real provider keys/models or reject dummy credentials. `.env` is ignored by `.gitignore`; `.env.example` is not ignored and contains development/example values. Confirm the example secrets are never used outside local development and rotate any value that was ever deployed.
- **Provider model catalog:** currently Gemini free models and Groq GPT-OSS models are exposed in chat picker; paid Anthropic is not. Gemini has an allowlist at adapter construction, good defense-in-depth. For configured Gemini 3.6/3.8, estimator has date-sensitive prices; for any unlisted model it returns `$0`. The 3.8 model is enabled but does not appear in `GEMINI_PRICING_PER_MILLION`, so cost tracking can report zero for it. Keep catalog enablement coupled to price metadata and provider availability validation.
- **Provider policy/quality:** Anthropic’s current default model IDs are retired; update to active models or disable provider. Groq’s two current model rates are in local code. LLM provider registry provides a useful Open/Closed extension pattern, but policy/ledger functionality is still coupled to the single `llm.js` gateway and direct embedding code bypasses it.

## 3. Worked cost simulation

### Assumptions

- Treat plan prices as monthly because that is how `PLAN_CONFIG`/Razorpay subscription plans are used; remote charged price remains unverified.
- 30-day month; one chat turn contains **3,000 billable input tokens and 500 output tokens**; no tools, search, retries, cached-input discount, or taxes/payment fees.
- Paid list rates are used to avoid assuming free provider quota is available or suitable for resume data. This is an upper-bound illustrative workload only, not measured JobScout telemetry.
- Cost formula: `(input tokens × input rate + output tokens × output rate) / 1,000,000`.

| Model/rate | Cost per assumed turn | Free 20 turns/day (monthly) | Pro 200 turns/day (monthly) | Premium 1,000 turns/day (monthly) |
|---|---:|---:|---:|---:|
| Gemini 3.5 Flash-Lite ($0.30/$2.50 per M) | $0.00215 | $1.29 vs $0 revenue | $12.90 vs $15 | $64.50 vs $35 |
| Gemini 3.6 Flash promo through 2026-12-31 ($0.75/$3.75 per M) | $0.004125 | $2.48 vs $0 | $24.75 vs $15 | $123.75 vs $35 |
| Gemini 3.6 Flash from 2027-01-01 ($1.50/$7.50 per M) | $0.00825 | $4.95 vs $0 | $49.50 vs $15 | $247.50 vs $35 |
| Groq GPT-OSS 20B ($0.075/$0.30 per M) | $0.000375 | $0.23 vs $0 | $2.25 vs $15 | $11.25 vs $35 |
| Groq GPT-OSS 120B ($0.15/$0.60 per M) | $0.00075 | $0.45 vs $0 | $4.50 vs $15 | $22.50 vs $35 |

**Current daily USD budgets alone:** Free `$0.10 × 30 = $3`, Pro `$1.50 × 30 = $45`, Premium `$5 × 30 = $150`. Even before considering other AI features, a user can theoretically be allowed to spend more than the plan revenue. A free account can accrue cost without revenue. These maxima should not be presented as included allowances until management deliberately funds them.

The table also shows why per-request caps and model restrictions matter: on Gemini 3.6’s post-2027 rate, the maximum 1,000-turn Premium chat allowance alone would cost `$247.50/month`, seven times the configured `$35` plan price. A $5/day spend cap still allows `$150/month`. Realistic caps should be set from observed token distributions and target gross margin. A proposed first launch policy is to meter all AI and enforce a conservative **monthly AI cost allowance** by plan, while leaving the actual numeric values for a pricing decision after a 2-4 week shadow-measurement period. Don’t mistake the numbers above for approved quotas.

### Cost model work still needed

Instrument actual p50/p90/p95 input/output by feature and model, then simulate each plan at 25%, 50%, 80%, and 100% of active users using current usage distributions. Include resume parse retry rate, interview questions/evaluations/report token reservations, embeddings per job/profile, cache hit rate, provider minimums, and failure retries. Convert Razorpay net receipts by currency and payment date; do not compare USD model cost to INR revenue without recorded FX. Publish gross-margin distribution by plan and feature.

## 4. Proposed system design

### Entitlements and billing-period policy

Create a central `EntitlementService` / plan catalog that returns an immutable snapshot for a user: plan/version, enabled features, allowed provider/model classes, monthly included AI allowance, per-feature request/token ceilings, per-session caps, and billing reset timestamp. Do not read plan booleans ad hoc inside provider adapters. Admin plan changes should be versioned and auditable. Distinguish a product request quota from a token/spend budget and explain each in the UI.

Prefer a monthly allowance for subscription fairness, plus a rolling/day cap as an abuse safeguard. Reservation should be based on worst-case cost from the selected provider/model, bounded input tokens, configured max output tokens, tool budget, and retry ceiling. Reject a request before provider invocation if the estimate would exceed the remaining allowance. For free provider quota, still reserve internal shadow cost at the paid list rate; upstream rate-limit availability and privacy tier are not your product entitlement.

### Gateway and reservation lifecycle

1. Create a request ID and resolve the provider/model from server allowlists.
2. Validate feature entitlement, account state, user consent, model data classification, token limits, request rate, and concurrency.
3. Estimate a conservative maximum cost; atomically reserve against user-period and global/provider-period budgets. Reservation keys need idempotency and expiration recovery.
4. Execute provider with deadline, abort signal, idempotency where supported, and retry only for classified transient/idempotent cases. Each attempt is explicitly represented.
5. Reconcile reported usage and final provider price, write a durable ledger/outbox record, then release reservation difference. On uncertain timeout, retain a conservative reservation until invoice/request reconciliation.
6. For streams, write a start/attempt record and a final/cancelled/failed record even when the client disconnects. Capture usage trailers if provider provides them; otherwise store a marked estimate and a reconciliation status.

Use atomic Redis Lua scripts or a transactional durable store for low-latency reservation. For money-critical caps, Mongo conditional atomic updates or a dedicated ledger are the source of truth; Redis can be an acceleration layer. Define fail-safe behavior explicitly: a temporary global cap reserve may fail closed on infrastructure outage, with bounded emergency override accessible to admins and audited.

### Cost ledger schema (additive migration)

Extend usage events with `requestId`, `attemptId`, `idempotencyKey`, `userPlan`, `planVersion`, `provider`, `model`, `feature`, `status`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `estimatedUsage`, `estimatedCostUsd`, `finalCostUsd`, `pricingVersion`, `reservedCostUsd`, `reservationStatus`, `latencyMs`, `firstTokenLatencyMs`, `retryCount`, `cancelled`, `errorClass`, and indexed timestamps. Use an idempotent unique index on `(provider, requestId, attemptId)` or equivalent. Avoid full prompt/resume content; if debugging requires content, use opt-in, redacted, short-lived traces with explicit access control. Keep event TTL policy aligned with support, finance, and regulatory retention requirements.

Track provider invoice/cost data separately and reconcile daily by provider/model/day. Record estimate variance, missing telemetry, unpriced model requests, and ledger write failures as operational alerts. Route all embeddings through the same budget/ledger boundary with task `embedding` and dimensions/model metadata.

### UX, degradation, and model selection

- Show remaining monthly allowance, reset date/time zone, and the reason for a blocked request. Warn at 70/90/100% and before switching to an explicitly more expensive model.
- Keep “Auto” default on a cost/quality policy. Explicit model selection should be allowed only if the model is currently available, priced, data-policy-approved, and within the user plan’s model entitlement. Never silently escalate to a paid model.
- Define fallback order per feature and privacy class, e.g., approved Groq low-cost → paid Gemini only if opted into provider disclosure and budgeted. If not allowed, return a partial/degraded response or ask the user to retry; do not silently use synthetic mock embeddings or responses in production.
- Avoid sending resume content to an unpaid Gemini API tier. Prefer billing-enabled Gemini API project / paid service or another approved processor with documented contractual terms. Paid Gemini still has limited safety/log retention in its policy; it is not automatically zero-retention. Review provider-specific data processing terms and eligible Zero Data Retention controls.
- Preserve structured-output validation and deterministic fallbacks where safe, but mark AI content as fallback and avoid charging an assumed zero for unknown models.

### Optimization order

1. Enforce output caps, truncate irrelevant context, summarize long chat history, and retrieve only the few profile/memory facts needed for the request.
2. Fix deterministic routing first; use small models for classification and extraction, stronger models only for hard/failed validations. Capture classification cost instead of recording zero in `RoutingLog`.
3. Use stable system/profile prefixes and provider-native caching. Gemini implicit cache hits are not guaranteed; available minima are model-specific. Groq caching is limited to supported models and discounted only after successful cache hits. Measure cache-token usage before calling a cache “savings.”
4. Use provider batch processing for background workloads with suitable latency: Gemini Batch is 50% of standard with target turnaround up to 24 hours; Voyage Batch advertises 33% discount and up to 12 hours for supported models. Do not use batch for an interactive resume upload or chat response unless product UX explicitly supports pending work.
5. Cache model-independent parsed facts only if privacy, user scoping, deletion, and retention are addressed; cache embeddings by provider+model+dimension+preprocessing version, not content hash alone.
6. Evaluate model quality on a private, consented gold set before choosing the cheapest model; compare grounded resume facts, extraction precision/recall, hallucination rate, score calibration, latency, and cost per accepted result.

### Abuse, observability, and config hardening

- Add per-user and per-IP request limits, token budgets, concurrent-call limits, max upload/page/text size, and spend velocity flags. Protect account creation and free trials from multi-account abuse without collecting unnecessary identity data.
- Make global/tenant/provider caps atomic. Add provider-level circuit breakers and a documented kill switch for all AI, a specific provider, model, or feature. Set on-call alerts before 50%, 75%, and 90% of global budget plus anomaly alerts for per-user outliers and cost spikes.
- Keep key rotation and secret manager injection; do not expose any AI secret in frontend `NEXT_PUBLIC_*`. Production startup should reject dummy keys, unset selected-provider credentials, unpriced/retired models, invalid limits, and mock fallback mode. Use `.env.example` only as placeholder documentation, never as production config.
- Track cost/request, cost/active user, cost/accepted extraction, cost/matched job, cost/completed interview, cost/revenue by cohort, provider error/retry rate, estimated-vs-reported variance, streaming completion/cancel rate, cache hit rate, and spend/reservation ledger lag.
- Alert on instrumentation gaps too: percentage of provider responses without usage, unpriced model calls, events not reconciled, stale reservations, Redis/Mongo degradation, and drift between app ledger and vendor invoices.

### Privacy / India DPDP and GDPR checkpoints

Resumes include personal information and can contain sensitive context. Minimize what leaves the app: structured relevant fields over full documents when task quality allows; short retention; encryption; restricted logs; user deletion that also removes caches and embedding records; provider inventory and subprocessors; region/transfer assessment; and a clear AI-specific notice/consent. Explain model-provider choices and whether the user’s resume/answers are sent to them. Keep data use separate from model training/analytics consent.

India’s DPDP Act 2023 and the notified DPDP Rules 2025 have staged commencement; the government notification schedules many substantive provisions/rules for 18 months after publication (May 2027), with certain provisions sooner. As of this report date, prepare now and confirm the exact applicable provisions and commencement against the Gazette before launch. GDPR obligations may apply based on users/market. Relevant principles include purpose limitation/data minimization, transparency, processor terms, and security. This is an engineering checklist, not legal advice; counsel must review lawful basis, notices/consent, cross-border processor arrangements, automated profiling implications, and retention.

## 5. Risks and decisions

| Priority | Risk | Cost / product impact | Suggested effort |
|---|---|---|---|
| P0 | Usage request counters have no callers | Count-based quotas do not enforce; uncontrolled feature volume | 1-2 days + regression tests |
| P0 | Preflight-only budget and local-memory fallback | Concurrent or multi-instance overspend; global cap not reliable | 3-5 days for atomic reservation and failure-mode tests |
| P0 | Embeddings bypass cost, policy, and health controls | Unmetered cost; silent quality failure; provider switching may corrupt vectors | 2-4 days plus re-embedding/migration plan |
| P0 | Gemini 3.8 enabled without local price entry | Cost is recorded as $0 | 0.5-1 day to price/version model catalog, test all enabled IDs |
| P0 | Free/unpaid Gemini privacy terms for resumes | Personal resume data may be used for product improvement/human review | Product/legal decision plus provider routing/disclosure work |
| P1 | Cost telemetry async and incomplete for stream failures | Admin reports and caps undercount actual cost | 2-4 days with durable request lifecycle/outbox |
| P1 | Monthly budget absent, daily caps permit $45/$150 per paid plan | Full daily use can exceed monthly subscription revenue; Free has unfunded cost | Pricing decision + 1-3 days to implement period allowance |
| P1 | Model defaults not production-validated; Anthropic defaults retired | Provider outages or wrong routing; unpriced model zero cost | 0.5-1 day + startup checks |
| P1 | Mock provider behavior can hide missing production configuration | Users receive fake results and operators see misleading health | 0.5-1 day |
| P1 | Retry-any-error & draft-interview generation before start reservation | Duplicate provider bills / repeated create-session abuse | 1-2 days |
| P2 | Cost and routing dashboard use different day boundary and source | Misleading global cap status and margin reporting | 1-2 days |
| P2 | Prompt/cache keys and embedding-cache versioning | Privacy surprises or stale/wrong cache data | 1-3 days including invalidation/version migration |

Decisions needed before implementation: monthly AI allowance and overage behavior per plan; whether resume uploads may ever use unpaid tiers; approved provider regions and retention; whether paid models are a Premium entitlement or user-funded option; global outage fail-closed policy; exact Razorpay plan prices/currency; and desired gross-margin target.

## 6. Tests and rollout plan

### Phase 0 — verify economics and provider readiness (1-2 days)

- Confirm Razorpay plan IDs, price, currency, cadence, trial, tax/fee treatment; align these with `PLAN_CONFIG`.
- Create a verified model/pricing catalog with effective dates, cache rates, currency, context/output limits, retired status, free-tier/data-policy class, and source URL.
- Reject provider/model pairs without a current rate in production. Confirm actual Google project billing tier and model access; validate Groq account rate limits and key.
- Decide privacy and retention posture with counsel. No resume payload should flow into a free Gemini tier until approved.

### Phase 1 — measure and close obvious gaps (3-5 days)

- Wire request counter increments exactly once per accepted operation; use request idempotency to avoid double count on retries/replays.
- Include provider embeddings in ledger and caps; disable mock-vector fallback outside development/test. Add estimator for embedding usage.
- Mark input/output usage as provider-reported or estimated; account for Gemini cached tokens, Groq cached usage, retry attempts, and interrupted streams.
- Add startup readiness checks for selected LLM key, embedding key, model allowlist, rate table, and non-mock production mode.
- Tests: counter increment exactly once; no counter on validation rejection; kill-switch coverage for embeddings and all generation paths; zero-price/unregistered-model rejection; fallback never masks production provider errors; streaming cancellation still emits a partial ledger event.

### Phase 2 — hard reservations and plan economics (4-7 days)

- Implement a reservation lifecycle and atomic per-user/month, per-user/day, provider/day, and global/day caps. Add bounded reservation expiration/reconciliation.
- Add monthly allowance; start in shadow mode and compare estimates to actual provider invoices/events. Then enable conservative enforcement behind a feature flag.
- Bring session question-plan creation under a create/draft limit or defer generation until the session starts. Bound retries and max input/output on every feature.
- Tests: concurrent requests at remaining budget; concurrent global cap race; multi-instance behavior; Redis/Mongo outage; reservation idempotency; timeout uncertain billing; provider reports zero usage; price version change at month boundary; DST/local-day edges; retries, cancellation, and outbox replay.

### Phase 3 — admin, experience, optimization (3-6 days)

- Add admin dashboard by plan/provider/model/feature: gross/net subscription revenue, AI spend, contribution margin, forecasts, cap utilization, ledger lag, estimate-vs-invoice delta, and model/feature kill switches with audit history.
- User UI for monthly allowance, reset date, model class/price explanation, warnings, and actions at exhaustion. Add a clear provider privacy label for each selectable model.
- Test cache-hit accounting, batch-job durability, cost-based router decisions, quality benchmark regression, and deletion of prompts/resume facts/cache/embeddings.
- Roll out: local tests → provider contract tests with mocked HTTP → staging with billing-enabled test projects and synthetic data → 1% internal traffic shadow → 10% shadow → 10% enforced beta → staged rollout. Set rollback on missing ledger, reservation mismatch, quality regression, p95 latency, provider 429/5xx, or spend alert. Keep global stop available throughout.

### Acceptance criteria

- Every billable LLM and embedding operation is associated with a unique request/attempt and a plan snapshot; unpriced models cannot run in production.
- Quotas are atomic across app instances and the documented failure policy is tested. No local-memory fallback is allowed to claim global enforcement.
- A provider timeout, retry, stream disconnect, cancellation, or malformed structured result leaves a ledger record or conservative pending reservation.
- Simulated per-plan costs and margin are reproducible from code/config and real usage; Razorpay receipts are normalized only with a recorded exchange rate and fee data.
- A user can understand what model/provider will process their resume, what allowance remains, what happens at the limit, and when it resets.
- Admin can identify model/feature spend spikes and disable a provider/model without deploying code; every override is audited.

## 7. Source register

All URLs below were accessed **2026-10-15**. Provider pricing and terms are mutable and should be snapshotted in deployment configuration/version control.

### Official provider documentation

- Google AI for Developers, [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) (model token and cache pricing, free/paid tier distinctions).
- Google AI for Developers, [Gemini models](https://ai.google.dev/gemini-api/docs/models) (model availability; current 2.5 access note and new-project recommendations).
- Google AI for Developers, [What’s new in Gemini 3.6 Flash and 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6) (3.6/3.5 price facts and effective promotional window).
- Google AI for Developers, [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) (unpaid vs paid service data use, human review, regional use restrictions; effective March 23, 2026 per page).
- Google AI for Developers, [Context caching](https://ai.google.dev/gemini-api/docs/generate-content/caching) (implicit cache behavior/minimums, explicit-cache cost/TTL).
- Google AI for Developers, [Batch API](https://ai.google.dev/gemini-api/docs/batch-api) (50% of standard price, asynchronous 24-hour target).
- Google AI for Developers, [Zero data retention in Gemini Developer API](https://ai.google.dev/gemini-api/docs/zdr) (paid service limits and ZDR requirements).
- Groq, [Supported models](https://console.groq.com/docs/models) (supported production models, prices, developer limits).
- Groq, [Rate limits](https://console.groq.com/docs/rate-limits) (free-plan quotas and headers; account-specific limits should be checked in console).
- Groq, [Prompt caching](https://console.groq.com/docs/prompt-caching) (supported models, automatic behavior and cache discount conditions).
- Voyage AI, [Pricing](https://docs.voyageai.com/docs/pricing) (older embedding model rates; batch pricing/availability caveat).
- Voyage AI, [Text embeddings](https://docs.voyageai.com/docs/embeddings) (model dimensions/context limits and embedding parameters).
- OpenAI, [text-embedding-3-small model](https://developers.openai.com/api/docs/models/text-embedding-3-small) (current model price and dimensions).
- OpenAI, [Data controls](https://developers.openai.com/api/docs/guides/your-data) (API training default and abuse-monitoring retention).
- OpenAI, [Embedding model announcement](https://openai.com/index/new-embedding-models-and-api-updates/) (price history and stated price per 1K tokens; use current model page for current price).
- Anthropic, [Model deprecations](https://docs.anthropic.com/en/docs/about-claude/model-deprecations) (retired model IDs and dates).

### Applicable regulation references (scope check, not legal advice)

- Government of India, MeitY, [Digital Personal Data Protection Rules 2025 Gazette notification](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) (staged rule commencement).
- Government of India, [DPDP Act 2023](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf).
- Government of India, MeitY, [commencement notification under DPDP Act](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) (phased dates).
- European Union, EUR-Lex, [General Data Protection Regulation (EU) 2016/679](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679) (including data minimization, transparency, processor, and security provisions).

### Local code/config references

- `src/shared/constants/plans.js`; `.env.example`; `src/config/env.js`
- `src/ai/llm.js`; `src/ai/router.js`; `src/ai/providers/{gemini,groq,anthropic}.js`; `src/ai/providers/index.js`
- `src/services/quotaService.js`; `src/models/UsageEvent.js`; `src/controllers/adminController.js`
- `src/services/embeddingService.js`; `src/services/jobs/jobIngestionService.js`; `src/ai/graphs/discoveryGraph.js`; `src/ai/memory/longTerm.js`
- `src/services/resumeParserService.js`; `src/services/interview/sessionService.js`; `src/shared/cache.js`; `src/middleware/rateLimiter.js`

---

**Review checkpoint:** No application code was changed. Review the product decisions in section 5 and the proposed allowance/rollout policy before implementation begins.
