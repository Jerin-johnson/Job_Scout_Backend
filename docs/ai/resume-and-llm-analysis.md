# Resume intelligence, matching, and LLM boundaries

**Research date:** 2026-10-20. Public Jobright model internals are not disclosed beyond its privacy policy's provider categories.

Last verified against commit `19a9e22951fe449e40690b88248c5db499eda809` for repository references in this research set.

## As built (verified in code)

IrowzScout currently has a deterministic-first resume parser, strict structured schema, shared LLM layer, grounding and content-hash cache behavior; see [resume pipeline](08-resume-ai-pipeline.md). Jobright's exact model, prompt and parse path remain unknown.

## Target design (not built yet)

The pipeline safeguards and evaluation practices below are recommendations; no parser, model, prompt, or provider was changed by this research.

## Publicly supported claims vs unknowns

Jobright advertises resume upload, resume analysis/refinement, and a job-targeted matcher that reports a match score and skill/experience/keyword gaps ([resume matcher](https://jobright.ai/tools/resume-job-matcher), [resume builder](https://jobright.ai/ai-resume-builder)). Its privacy policy lists OpenAI, Anthropic, Google Cloud AI, and AWS AI as AI providers and says personal information and AI inputs/outputs may be sent to them ([privacy](https://jobright.ai/legal/privacy)). It does not identify which model is used for resume parsing or matching, how documents are parsed, which prompts are used, or the ranking algorithm. Those remain unknown; do not attribute a specific model to Jobright.

## Recommended resume pipeline

1. Authenticate and authorize resume ownership. Upload privately to S3 through a short-lived key-prefix-scoped presigned URL; verify object metadata/checksum/size and idempotent completion server-side. Do not log file bytes, resume text, or signed URLs.
2. Extract text deterministically from supported PDF/DOCX formats with bounded input size. Keep scanned PDFs in an explicit unsupported/OCR-required state unless an approved OCR design exists. Track extraction quality and section boundaries, not document text, in operational telemetry.
3. Parse sections and dates deterministically first: contact, skills, experience, education, credentials. Preserve source spans/quotes and raw date uncertainty. Treat the document as untrusted data so embedded instructions cannot redirect system behavior.
4. Optionally call the existing shared LLM provider layer once on a cache miss, for typed fields that deterministic rules cannot reliably recover. Use a low-cost adequate model selected by the configured policy, strict JSON schema, short timeout, bounded input/output tokens, and versioned prompt. No arbitrary browsing/tools during extraction.
5. Ground every model fact in extracted source text; reject ungrounded values and keep rejection counts. Do not invent salary, authorization, dates, skills, or qualifications. Require user confirmation for inferred seniority/preferences.
6. Cache by file content hash + parser/prompt version + schema version, encrypted/private; expose consent, correction, export, and delete. Store provenance per fact so later matching can explain evidence.

These practices align with the existing backend `resumeParserService.ts`: deterministic role parsing precedes one shared-layer LLM extraction; output is Zod-strict and grounded; results are content-hash cached. Existing resume docs say content is encrypted at rest and user consent/data policy applies. Confirm current exact extraction branches against code before any future behavior change.

## Where conventional code is better

PDF/DOCX decoding, section segmentation, date normalization, skill dictionary matching, title normalization, country/currency validation, deterministic scoring, source authorization, quota enforcement, and schema checking should be conventional and testable. LLMs can help normalize ambiguous prose, group achievement bullets, or explain a precomputed score, but must not be the authority for hard eligibility or facts that are absent from the source.

## LLM and embedding architecture

Use the existing shared provider/routing layer, versioned model/pricing catalog, config-driven personal-data policy, usage ledger, kill switch, and quota path. Request and response DTOs are strict schemas. Record model/provider, prompt/schema version, token estimates/provider-reported usage, outcome, latency, retry count, and cost without storing prompts, resume text, or raw provider output in logs. Retry only classified transient 429/5xx/clear network errors; do not retry billable timeouts blindly. Production Redis/durable-store outage behavior remains fail-closed per the existing decision.

Embeddings are optional offline retrieval features, not a prerequisite for current deterministic job scoring. If enabled, embed a job once per content hash, batch under shared metering/kill-switch path, persist provider/model/dimension metadata, and skip expired records. Do not silently re-embed legacy vectors.

## Evaluation and hallucination safeguards

Maintain redacted synthetic and consented fixtures across reverse chronological histories, internships/freshers, non-IT professions, career breaks, two-column ordering, multilingual titles, sparse resumes, and prompt injection. Measure field-level precision/recall, groundedness/rejection rate, empty/partial parse rate, cost per upload, latency, and cache-hit rate. Match quality should be evaluated independently of extraction quality. Any generated suggestion must cite a saved fact or job requirement and be framed as optional/“only if true.”

## Cost assumptions

No model is called per job for matching. As an illustrative low-tier extraction estimate using the backend catalog's Gemini 3.1 Flash-Lite list rates ($0.25/M input and $1.50/M output), 10k input + 1.5k output tokens cost about **$0.00475 per uncached upload**; 1,000 uncached uploads/month ≈ **$4.75**. This is arithmetic on catalog rates, not an invoice estimate; provider tier, retries, taxes, tokenization, and current price changes can alter it. Gemini official pricing also distinguishes free-tier data-use terms; never send personal resumes to a free tier under production policy. [Official Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), accessed 2026-10-20.

## Verification

Inspected the shared backend resume parser and deterministic role parser, model catalog, and existing pipeline documentation. No resume content, database data, or provider was accessed. The token/cost figures above are transparent arithmetic assumptions; `npm run docs:check` validates local documentation structure.
