# LLM providers and resume extraction

## Provider boundary

All model calls go through `src/ai/llm.js` and the provider adapters in `src/ai/providers/`. Features should call `invokeLLM`; they should not construct vendor clients directly. `LLM_PROVIDER` selects the provider, while model IDs are configured separately. This keeps structured-output validation, retries, cancellation, quotas, and usage estimates consistent and makes another provider additive.

## Resume extraction

The resume parser uses the configured provider's small tier first. Gemini defaults to `gemini-3.1-flash-lite` for both tiers to avoid silently escalating to a paid model. It retries once only when the first result has no facts that can be matched to the source. Achievements must match the resume wording, and unsupported role, skill, education, date, and metric values are removed before saving. If both attempts yield no grounded facts, the API returns `FACTS_NOT_EXTRACTED`; it never creates demo facts.

PDF parsing currently extracts selectable text with `pdf-parse`; DOCX parsing uses Mammoth. Scanned/image-only PDFs are not OCR processed and should be OCR'd before upload. Extraction prompts are capped at 100,000 characters. The raw extracted text is encrypted in the database; the original uploaded file goes to S3-compatible storage when configured.

## Gemini (default)

Set the following on the **backend only**:

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-server-side-key
GEMINI_MODEL_SMALL=gemini-3.5-flash-lite
GEMINI_MODEL_STRONG=gemini-3.5-flash-lite
```

Gemini requests are implemented with LangChain's `ChatGoogleGenerativeAI` adapter (`@langchain/google-genai`) and pass through the shared `invokeLLM` boundary for quotas, retries, circuit breaking, and usage tracking. This integration version is pinned to the LangChain 0.3 core line used by this repository; move the LangChain packages together when migrating to core 1.x. Gemini 3.6/3.8 Flash calls omit `temperature`, which Google's current Gemini 3.6 guide identifies as unsupported.

Create a key in [Google AI Studio](https://aistudio.google.com/apikey). Keep it restricted to the Gemini API where possible. The chat model selector is a server-owned allowlist populated by configured provider adapters. Gemini chat choices include Gemini 2.5 Flash/Flash-Lite (legacy), 3.1 Flash-Lite, 3.5 Flash-Lite, 3.6 Flash, and 3.8 Flash; Groq offers GPT OSS 20B and GPT OSS 120B. Only enabled entries explicitly marked `free_tier` are selectable. Paid-only, deliberately restricted high-cost, and unknown/retired Gemini IDs (including Gemini 2.5 Pro and 3.1 Pro Preview) are rejected by the catalog and Gemini adapter, including when configured as an internal Gemini model. Modifying the browser request cannot unlock them. The default/internal Gemini tiers use 3.5 Flash-Lite to keep cost low. Auto may use an enabled strong-tier model when the router selects it.

Google currently recommends 3.5 Flash-Lite or 3.8 Flash for new projects and limits Gemini 2.5 API access to projects that have actively used those models before. The legacy 2.5 Flash choices are left available for compatible projects; they may fail with model-unavailable on a new project. Gemini 2.5 Pro has free-tier pricing in Google's table, but is excluded from the picker because its paid-tier rates are much higher and access is legacy-restricted. Gemini 3.1 Pro Preview is paid-only. Gemini Free Tier availability and request limits depend on the project and can change. “Free-tier eligible” describes model pricing eligibility only: a billed API project can still incur standard model charges. App model restrictions block paid-only and deliberately excluded high-cost model IDs; they do not control the billing tier of a Google Cloud project. For a no-charge setup, use an API project without billing and review Google AI Studio's current limits. This is separate from data privacy: Google's Free Tier terms allow prompts and responses to be used to improve products, as described below.

Gemini standard text cost estimates are recorded for the enabled models. As published at the documentation review on 2026-10-15, 3.6 and 3.8 Flash are $0.75/$3.75 per million input/output tokens through 2026-12-31, changing to $1.50/$7.50 from 2027-01-01. The estimator switches on that date. Recheck pricing before release; it is not a cap on provider billing. Gemini 3.6/3.8 are enabled only for chat through this catalog and will not be selected for extraction unless explicitly set in backend configuration; the free-model guard rejects paid/unknown IDs.

The allowlist blocks paid model IDs; it cannot change the billing tier of the API key. To enforce a hard no-charge deployment, use a Google AI Studio project that remains on the free tier and do not attach billing. Free-tier limits can result in throttling or unavailable responses. If billing is enabled on the project, the provider may charge for requests beyond free allowances even when the selected model is on this list.

The picker is loaded from authenticated `GET /api/v1/ai/models` and is empty when no configured provider exposes a selectable chat model. Each chat turn must send the selected model ID; missing, paid, or unknown IDs are rejected server-side. Explicit choices bypass the separate model-powered router classifier, so the requested model answers the turn directly. Auto uses `LLM_PROVIDER` as its preferred provider and falls back to another configured provider when the preferred provider lacks the requested capability tier. Other features use the configured provider and tier defaults.

**Resume privacy:** Google's pricing page says free-tier content may be used to improve Google products; paid-tier content is not. Do not send production resumes to the free tier unless the user has been informed and your privacy/consent policy permits it. Use a separately reviewed, approved provider for confidential production data and review retention and regional processing terms. The chat selector does not imply that free-tier data is appropriate for sensitive content.

Official references: [LangChain Gemini adapter](https://reference.langchain.com/javascript/langchain-google-genai), [models and access notes](https://ai.google.dev/gemini-api/docs/models), [pricing and data use](https://ai.google.dev/gemini-api/docs/pricing), [Gemini 3.6 migration and parameter guidance](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6), [API keys](https://ai.google.dev/gemini-api/docs/api-key), and [structured output](https://ai.google.dev/gemini-api/docs/structured-output).

## Anthropic

Set `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `MODEL_SMALL`, and `MODEL_STRONG`. The key remains server-side. Use the provider's current model IDs and pricing when configuring a deployment.

## Groq

Set these on the backend only:

```dotenv
LLM_PROVIDER=groq
GROQ_API_KEY=your-server-side-key
GROQ_MODEL_SMALL=openai/gpt-oss-20b
GROQ_MODEL_STRONG=openai/gpt-oss-120b
```

The adapter uses the repository's existing LangChain `ChatOpenAI` client against Groq's OpenAI-compatible API, so no additional package is needed. It folds static system instructions and context into the initial user message because Groq's GPT-OSS reasoning guidance recommends avoiding system-role prompts. Both models are listed for the free plan, subject to account and project rate limits; this is not a production SLA. Groq's current developer rates list $0.075/$0.30 per million input/output tokens for GPT OSS 20B and $0.15/$0.60 for GPT OSS 120B. Developer-tier usage requires a payment method and is billed; configure provider spend limits if upgrading. Recheck model availability, pricing, and limits before launch.

Official references: [LangChain Groq integration](https://reference.langchain.com/javascript/langchain-groq), [Groq model catalog and pricing](https://console.groq.com/docs/models), [rate limits](https://console.groq.com/docs/rate-limits), [billing tiers](https://console.groq.com/docs/billing-faqs), and [API errors](https://console.groq.com/docs/errors).

## Adding a provider

1. Add an adapter under `src/ai/providers/` with normalized structured output, usage metadata, cancellation, and errors.
2. Register it in `src/ai/providers/index.js` and extend the `LLM_PROVIDER` environment enum.
3. Add server-side environment variables and safe defaults in `src/config/env.js` and `.env.example`.
4. Add a model-aware price estimator or explicitly mark cost unavailable; never report a paid call as free.
5. Keep feature calls on `invokeLLM` so quotas, retries, circuit breaking, and usage recording remain shared.
6. Validate each structured result with its Zod schema and preserve provider privacy/retention guidance in this document.
