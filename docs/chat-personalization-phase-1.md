# AI Chat personalization — Phase 1

**Status:** Implemented; Phase 2 is not started.  
**Scope:** Profile grounding, request routing, real response streaming, interim history, chat UI corrections, and verification.

## Request flow

1. `GET /api/v1/ai/models` returns `Auto (recommended)` plus the server-allowlisted Gemini chat models. The browser defaults to Auto. The browser never receives the Gemini API key.
2. `GET /api/v1/ai/context` returns a minimal greeting, a candidate card, and up to three suggestions. The API derives the user ID from authentication. The card uses a 60-second shared cache; profile, resume, application, and preferred-name writes invalidate it.
3. `PATCH /api/v1/ai/preferred-name` updates the signed-in user’s preferred name. Empty string restores the account name fallback.
4. `POST /api/v1/ai/chat` accepts a prompt (2,000 characters maximum), optional model ID, a temporary thread ID, and at most six previous turns (2,000 characters each). `threadId` is still not persisted; persistence is Phase 4.
5. The router checks deterministic patterns and heuristics before using its structured classifier on ambiguous short follow-ups. It picks a tier; the model catalog resolves that tier without embedding provider IDs in routing rules.
6. The backend creates the prompt in this order: static persona/safety rules, candidate context wrapped as data, quoted client history, current prompt. Prior assistant turns are converted to user-role quoted content, so client history cannot create a privileged assistant instruction.
7. The LLM layer streams model chunks and reports aggregate usage after completion. On the provider’s stream failure before any output, it falls back to invoke; after partial output, it returns a safe error instead of repeating a partial answer.

Transient connection and 5xx failures during the pre-response invoke fallback are retried once with a short delay. Quota failures are surfaced without a rapid retry. Provider failures are classified into safe network, timeout, quota, configuration, model-availability, invalid-request, capacity, and upstream-service categories. Logs include a request ID and non-sensitive category/status metadata, not raw provider error text or user prompt data. The browser removes an empty assistant placeholder after failure, retains partial output, and retries the exact request payload.

SSE event order is `routing`, `status`, `status`, zero or more `token`, then `done`; failures return `error`. The endpoint keeps authentication, CSRF, quota checks, the existing rate limiter, and a 30-second abort timeout.

## Candidate card

The card contains preferred name, current role, target roles, estimated years of experience, top skills, preferred locations, plan, active application count, follow-ups due, resume availability, and last completed interview score. It uses MongoDB projections/counts rather than loading resume text or full application documents. The profile card is capped at 1,800 characters (about 450 tokens at a rough four-characters-per-token estimate); it is usually much smaller. No long-term memory is read or injected.

The cached card is user-scoped. Writes through the profile/resume and application controllers invalidate it, as does the preferred-name endpoint. A short TTL remains as a safety net for out-of-band writes.

## Chat UI

- Greeting, count summary, and suggested prompts are returned from live user state.
- Preferred name can be changed in place.
- Auto is selected initially; the model menu lists the recommended option and available advanced choices.
- Retry is visible only after a failed turn and uses the same request body, model selection, and history.
- Enter sends; Shift+Enter inserts a newline.
- The memory panel says memory is not enabled, has no misleading controls, and opens as a drawer below desktop width.
- The live message region and completion status are announced to assistive technology.

## Privacy and data handling

No prompt, resume text, or profile text is logged by the new chat flow. Success telemetry contains latency, first-token latency, model, input/output token counts, route, context-cache hit, and status. Provider failures are logged without provider error text because provider errors can echo request content. Token counts are provider-reported when available, otherwise they are marked as estimates. The frontend shows this distinction.

**Launch decision required:** Gemini’s official terms say unpaid Gemini API prompts and responses may be used to improve Google services and may be reviewed by people; those terms say not to submit personal or confidential information to unpaid services. Paid Gemini API usage is not used for product improvement and is processed under Google’s data-processing terms. Do not launch resume/profile grounding on an unpaid Gemini project until the product/legal owner selects and documents the required data-processing tier. A key by itself does not reveal whether its Google project is on Free or Paid Tier. This implementation does not infer billing tier from `GEMINI_API_KEY`.

## Provider research snapshot

Official Google documentation reviewed on **2026-10-15**. Rates, limits, and model IDs can change; re-check them before Phase 2 and deployment.

### Allowlisted model capabilities

| Model | Native function calls | Parallel / sequential calls | Structured output with tools | Input / output limit | Notes |
| --- | --- | --- | --- | --- | --- |
| Gemini 3.1 Flash-Lite | Supported | Supported / supported | Gemini 3 series supports this in preview | 1,048,576 / 65,536 tokens | Stable model; Google describes it for efficient, high-volume, straightforward work. |
| Gemini 3.5 Flash-Lite | Supported | Supported / supported | Gemini 3 series supports this in preview | 1,048,576 / 65,536 tokens | Stable model; optimized for high-throughput, low-cost tasks. |

The current server chat allowlist also includes Gemini 3.6 Flash, Gemini 3.8 Flash, Gemini 2.5 Flash, and Gemini 2.5 Flash-Lite. The 2.5 models are legacy and Google currently limits access to projects that have previously used them. Gemini 2.5 Pro has free-tier pricing in Google's table but stays disabled because its paid-tier rates are much higher and access is legacy-restricted; Gemini 3.1 Pro Preview is paid-only. `modelCatalog.js` returns only enabled `free_tier` entries, and the Gemini adapter rejects unknown or non-allowlisted model IDs as defense in depth. Gemini 3.6/3.8 requests omit `temperature` per Google's 3.6 parameter migration guidance. This catalog gate blocks paid-only and deliberately excluded high-cost model IDs; it cannot determine whether the server's Google project has billing enabled.

Google does not publish a numerical tool-selection reliability guarantee. Its guidance says tool declarations should be clear and strongly typed, active tools kept to 10–20 maximum, and every proposed call validated with robust error handling and authentication. Native provider support does not mean the current LangChain adapter in this repository exposes a tool loop; it currently does not. That adapter/tool-loop work is Phase 2.

### Cost and latency controls

- Gemini 3.1 Flash-Lite supports `minimal`, `low`, `medium`, and `high` thinking levels; `low` is the documented low-latency/low-cost choice. The LangChain adapter currently does not pass a thinking-level option; Phase 2 should validate the adapter/API path before enabling it.
- Standard output tokens are bounded in the LLM layer (`maxTokens`); streaming uses a 1,200-token output cap.
- Implicit caching is available for newer Gemini models, but it is best for large repeated prefixes. Google’s current caching table does not state a minimum for either allowlisted Flash-Lite model; it lists 4,096 for several other Gemini 3 models and 2,048 for Gemini 2.5 Flash/Pro. This app’s small prompt prefix is below those documented thresholds, so no cache savings are assumed. The `cache_control` field in the existing formatter is not a Gemini caching mechanism.
- Explicit caching has TTL-based storage billing and is intended for substantial repeated corpora. It is not justified for the current short profile card.
- Batch can discount offline work by 50% but is asynchronous (up to 24 hours); it is unsuitable for interactive chat. Flex is best-effort and slower. Priority costs more and is not justified for the initial chat. Standard is appropriate for this real-time request/response feature.

### Pricing, limits, and deprecations

Standard text rates from Google’s current pricing page:

- Gemini 3.1 Flash-Lite: Free Tier inputs/outputs are listed as free; Paid Tier $0.25 / 1M input and $1.50 / 1M output tokens.
- Gemini 3.5 Flash-Lite: Free Tier inputs/outputs are listed as free; Paid Tier $0.30 / 1M input and $2.50 / 1M output tokens.
- Gemini 2.5 Flash-Lite: Free Tier inputs/outputs are listed as free; Paid Tier $0.10 / 1M input and $0.40 / 1M output text tokens.
- Gemini 2.5 Flash: Free Tier inputs/outputs are listed as free; Paid Tier $0.30 / 1M input and $2.50 / 1M output text tokens (standard prompts under 200k tokens).
- Gemini 3.6 Flash and 3.8 Flash: Free Tier inputs/outputs are listed as free; Paid Tier $0.75 / $3.75 per 1M input/output tokens through 2026-12-31 and $1.50 / $7.50 from 2027-01-01. The backend cost estimator switches rates on that date.

Actual Free Tier request limits are project/tier/account dependent and change; Google directs developers to AI Studio for the active RPM, TPM, and RPD values and warns that published limits are not guaranteed. No single fixed free-tier limit is safe to encode. Google recommends 3.5 Flash-Lite or 3.8 Flash for new projects; access to 2.5 models is limited to projects that have actively used them in the past. The 3.1 Flash-Lite **preview** ID was shut down May 25, 2026; the allowlist correctly uses the stable ID. Model IDs and pricing should be rechecked before release.

### Data tier and recommendation

For resume, profile, and application details, the Free Tier is not suitable under Google’s stated terms. The launch owner should decide whether to enable chat only with a paid API project (or an enterprise arrangement after contractual review). This is a privacy/legal decision and remains open; this report does not make that decision.

Recommended shape: use 3.5 Flash-Lite as the default low-cost model, keep 3.1 Flash-Lite and compatible 2.5 Flash choices available where needed, and route genuinely complex requests to 3.6 or 3.8 Flash only when the router selects a strong tier. Keep an all-small-model option for the cost baseline. There is no measured live per-turn cost/latency yet because the current environment has not been benchmarked with a verified provider key; do not use mock timings as production estimates. For illustration only, assuming 1,500 input and 350 output tokens at current 3.5 Flash-Lite Standard rates, a paid turn is approximately **$0.001325** before caching, thinking-token overhead, or any separate tool charge. These are arithmetic estimates, not measured usage.

### Live API

Gemini Live uses a persistent WebSocket session for low-latency bidirectional realtime streams and supports text as well as audio/video. It is technically capable of text input, but it is unnecessary for ordinary turn-based text chat, where the existing HTTP SSE endpoint is simpler. Revisit Live for future voice mock interviews, where streaming microphone audio and immediate spoken responses match the API’s design.

## Verification and limitations

- Added unit checks for prompt ordering/grounding, missing-profile guidance, profile injection delimiting, history bounds and demotion, routing tiers, SSE event order, and exact failed-request retry behavior.
- Added a `mongodb-memory-server` integration test for user-scoped profile/context joins, active/follow-up counts, resume existence, and latest interview score.
- Streaming usage falls back to rough token estimates if the provider does not return usage metadata. Live first-token latency and live token counts require a verified provider key and a real request.
- Chat history is interim client-provided context, not durable conversation storage. Memory remains deliberately off pending consent design in Phase 3.
- Phase 2 read-only tools, citations/sources, and write actions are not included.
