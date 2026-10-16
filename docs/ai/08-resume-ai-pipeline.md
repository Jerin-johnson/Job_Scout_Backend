# 08 — Resume AI pipeline

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Browser receives a short-lived presigned upload URL scoped to the authenticated user key; completion verifies key ownership and is idempotent. Text is extracted from text-based PDF/DOCX, encrypted before database storage, parsed through shared LLM invocation, and cached by file hash/parser version. Parsed facts are grounded against source text. Resume AI processing requires versioned user consent (`resume-ai-processing-v1`). No OCR path for scanned PDFs was found.

Resume extraction runs deterministic experience parsing first, then makes at most one `small`-tier structured call on a content-hash cache miss. There is no stronger-tier fallback. Validated provider output, including empty results, is cached as facts-v4 so completion retries do not repeat a billable call. A strict schema is followed by grounding each extracted field against source text; unsupported facts are dropped and counted. The resume is JSON-serialized as untrusted data with delimiter characters escaped. If extraction returns an empty role list, previously grounded role history is retained. Logs contain only safe usage metadata and rejected-fact counts, not document text, file contents, or presigned URLs. See `src/services/resumeParserService.js`, `src/services/resumeRoleParser.js`, and `src/controllers/profileController.js`.

The code path behind the partial-upload symptom is the extraction and grounding gate: the old flow relied on the model for all roles, required title and company text to match the extracted source literally, and, when no facts survived, made a stronger second model call before returning `FACTS_NOT_EXTRACTED`. That 422 path prevented resume-record creation, leaving the S3 upload in the retryable partial state. The deterministic role parser now runs first (including reverse-chronological and date-column layouts), the shared small tier is called at most once on a cache miss, output is strictly validated and grounded, unsupported facts are counted and dropped, and there is no stronger-tier retry. No TDZ/cache-variable bug was present in the committed pre-change source; the earlier diagnosis claiming one was incorrect. The user-specific dated-experience layout remains unknown because the answer placeholder was not selected.

No stored resume was reprocessed for this change. A user-triggered re-read would reuse cached extraction when the content hash is unchanged; otherwise it incurs one configured small-tier extraction. At 25,000 input tokens and the 3,500 output-token cap, configured `openai/gpt-oss-20b` catalog rates ($0.075/M input and $0.30/M output) estimate at $0.002925 per uncached parse. This is a token-cap estimate, not a quote; actual provider, rates, and usage vary. Cache hits add no new model call. The user's specific dated-experience answer was not provided, so that user's individual resume layout remains unverified.

## Target design (not built yet)

Make extraction lifecycle, deletion cascades, provider retention and consent presentation auditable. Add async extraction only if latency/scale justifies queue overhead. Add OCR only after privacy, cost and accuracy review.

**Unverified:** production bucket CORS/IAM, provider retention settings, and deployed deletion cascade. Check actual cloud configuration and deletion audit.
