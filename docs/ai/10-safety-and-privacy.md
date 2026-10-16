# 10 — Safety and privacy

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

LLM feature calls use server-owned user records and shared quotas; resume and interview lookups are ownership scoped. Interview prompts delimit resume, JD, answer and transcript fields and treat them as untrusted. Chat marks candidate context/history untrusted. Resume facts are grounded to their source. The frontend assistant renderer has raw HTML disabled, suppresses remote images, filters URL schemes and restricts internal links.

Logs use request IDs, model/provider/status and error classes. Do not log raw prompts, answers, resume contents, object keys, presigned URLs, or provider responses. UsageEvent retention is 90 days. Interview consent stores acceptedAt and version. The production personal-data gate is config-driven by provider data-policy class; provider terms remain a legal-review flag, not a conclusion.

Memory routes are authenticated and scoped. **Code gap:** memoryPaused is toggled on the user, but the job-feedback write in jobController does not check it; chat does not retrieve memory. Do not claim pause is an end-to-end write gate until corrected and tested.

## Target design (not built yet)

Gate every memory capture/retrieval path with explicit consent and pause state; add injection fixtures for resumes, job descriptions, notes, answers and tool results; use strict tool schemas with user identity injected server-side; document deletion across S3, encrypted text, facts, cache and vectors. Have counsel review provider terms and residency.

**Unverified:** cloud policy, provider retention controls, backup deletion windows, logging retention beyond model TTL, and legal acceptability of configured unpaid tiers. Verify deployment/IAM/provider contracts and privacy policy before production personal-data traffic.
