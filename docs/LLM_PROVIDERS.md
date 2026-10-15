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
GEMINI_MODEL_SMALL=gemini-3.1-flash-lite
GEMINI_MODEL_STRONG=gemini-3.1-flash-lite
```

Gemini requests are implemented with LangChain's `ChatGoogleGenerativeAI` adapter (`@langchain/google-genai`) and pass through the shared `invokeLLM` boundary for quotas, retries, circuit breaking, and usage tracking. This integration version is pinned to the LangChain 0.3 core line used by this repository; move the LangChain packages together when migrating to core 1.x.

Create a key in [Google AI Studio](https://aistudio.google.com/apikey). Keep it restricted to the Gemini API where possible. The chat model selector is a server-owned allowlist and currently contains Gemini 3.1 Flash-Lite and Gemini 3.5 Flash-Lite only. Both currently have a free tier; paid/pro/preview models are not exposed as selectable chat models. The backend validates every submitted model ID against that allowlist, so modifying the browser request cannot unlock another model. The default/internal Gemini tiers are also configured to Flash-Lite to avoid hidden quality retries increasing cost. Google lists standard paid rates of $0.25/$1.50 per million input/output tokens for 3.1 Flash-Lite and $0.30/$2.50 for 3.5 Flash-Lite. Verify current quotas and pricing before release because they can change. Cost telemetry uses these conservative paid-tier rates even when the account receives free-tier usage.

The allowlist blocks paid model IDs; it cannot change the billing tier of the API key. To enforce a hard no-charge deployment, use a Google AI Studio project that remains on the free tier and do not attach billing. Free-tier limits can result in throttling or unavailable responses. If billing is enabled on the project, the provider may charge for requests beyond free allowances even when the selected model is on this list.

The picker is loaded from authenticated `GET /api/v1/ai/models` and is empty when no Gemini key is configured. Each chat turn must send the selected model ID; missing, paid, or unknown IDs are rejected server-side. Explicit choices bypass the separate model-powered router classifier, so the requested model answers the turn directly. Other features continue to use the configured provider and tier defaults.

**Resume privacy:** Google's pricing page says free-tier content may be used to improve Google products; paid-tier content is not. Do not send production resumes to the free tier unless the user has been informed and your privacy/consent policy permits it. Use a separately reviewed, approved provider for confidential production data and review retention and regional processing terms. The chat selector does not imply that free-tier data is appropriate for sensitive content.

Official references: [LangChain Gemini adapter](https://reference.langchain.com/javascript/langchain-google-genai), [models](https://ai.google.dev/gemini-api/docs/models), [pricing and data use](https://ai.google.dev/gemini-api/docs/pricing), [API keys](https://ai.google.dev/gemini-api/docs/api-key), and [structured output](https://ai.google.dev/gemini-api/docs/structured-output).

## Anthropic

Set `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `MODEL_SMALL`, and `MODEL_STRONG`. The key remains server-side. Use the provider's current model IDs and pricing when configuring a deployment.

## Adding a provider

1. Add an adapter under `src/ai/providers/` with normalized structured output, usage metadata, cancellation, and errors.
2. Register it in `src/ai/providers/index.js` and extend the `LLM_PROVIDER` environment enum.
3. Add server-side environment variables and safe defaults in `src/config/env.js` and `.env.example`.
4. Add a model-aware price estimator or explicitly mark cost unavailable; never report a paid call as free.
5. Keep feature calls on `invokeLLM` so quotas, retries, circuit breaking, and usage recording remain shared.
6. Validate each structured result with its Zod schema and preserve provider privacy/retention guidance in this document.
