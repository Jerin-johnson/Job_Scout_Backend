# 02 — LLM layer and routing

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

src/ai/llm.js:115 resolves provider/model, price and data policy, checks quota, invokes adapters, retries classified transient errors, and awaits UsageEvent writes. streamLLM at line 309 streams chunks and writes final/partial/failure usage in finally. Nonstream uses an Opossum breaker; streaming does not pass through that breaker. Adapters are registered in src/ai/providers/index.js.

Gemini uses @langchain/google-genai, Groq uses @langchain/groq / OpenAI-compatible calls, Anthropic uses its LangChain adapter. Exact installed package versions are in package-lock.json.

SMALL and STRONG are separate config fields. Gemini defaults both to gemini-3.5-flash-lite (same model); Groq defaults to openai/gpt-oss-20b and openai/gpt-oss-120b (different models). Chat exposes only configured enabled free-tier catalog entries. Production startup rejects mocks and validates selected model/provider and embedding credentials/pricing.

Chat calls routeRequest for classification/tier selection, then streams the selected model directly (src/controllers/aiController.js:112–128). It does not route answer generation through a tool-enabled graph. Explicit model choice bypasses Auto tier choice. Router has deterministic Tier 0 checks, a small structured classifier and an escalation path; no tool executor was found.

The versioned price catalog is MODEL_PRICING_VERSION 2026-10-15.1; values are USD per million tokens. Examples: Gemini 2.5 Flash-Lite $0.10/$0.40 input/output; 2.5 Flash $0.30/$2.50; 3.1 Flash-Lite $0.25/$1.50; 3.5 Flash-Lite $0.30/$2.50; Gemini 3.6/3.8 Flash $0.75/$3.75 through 2026-12-31, then $1.50/$7.50 starting 2027-01-01; Groq OSS 20B $0.075/$0.30 and 120B $0.15/$0.60. Cache rates are stored separately where available. These are code estimates, not provider invoices.

Structured output uses Zod schemas. No active tool-call executor was found. Prompt formatting/cache hints are not local response caching.

## Target design (not built yet)

Use a feature policy registry to bind data class, allowed model/provider, max tokens, retries, output schema and quota. Add tools only with server-side authorization and an allowlisted read-only registry. Measure small/strong quality and cost before using distinct tiers.

**Unverified:** provider/account model access, pricing and terms can change. Verify at deploy time. LANGFUSE_* configuration is parsed but no active Langfuse client callsite was found.
