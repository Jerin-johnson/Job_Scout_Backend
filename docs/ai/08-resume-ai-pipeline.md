# 08 — Resume AI pipeline

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Browser receives a short-lived presigned upload URL scoped to the authenticated user key; completion verifies key ownership and is idempotent. Text is extracted from text-based PDF/DOCX, encrypted before database storage, parsed through shared LLM invocation, and cached by file hash/parser version. Parsed facts are grounded against source text. The parser retries strong tier only after zero grounded facts and returns an explicit no-facts error. No OCR path for scanned PDFs was found.

Resume extraction sends bounded source text to the configured model. Production personal-data policy blocks disallowed unpaid tiers when configured. Logs should use request IDs/error codes and must not include document text or presigned URLs. See src/services/resumeParserService.js and src/controllers/profileController.js.

## Target design (not built yet)

Make extraction lifecycle, deletion cascades, provider retention and consent presentation auditable. Add async extraction only if latency/scale justifies queue overhead. Add OCR only after privacy, cost and accuracy review.

**Unverified:** production bucket CORS/IAM, provider retention settings, and deployed deletion cascade. Check actual cloud configuration and deletion audit.
