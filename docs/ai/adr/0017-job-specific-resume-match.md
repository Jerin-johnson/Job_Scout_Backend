# ADR 0017: Deterministic job-specific resume match

Last verified against commit `857595d` plus working-tree changes on 2026-10-17.

## As built (verified in code)

Owner-scoped reports, selected-resume grounding, deterministic scoring, and isolated optional AI suggestions are implemented.

## Target design (not built yet)

Human calibration for the score and vendor-specific parser prediction are intentionally not implemented.

- Status: Accepted
- Date: 2026-10-17

## Decision

Provide an on-demand deterministic `resume-match-v1` report for one selected resume and a catalog job, owned application, or user-pasted job description. Do not fetch a job URL and do not use an LLM or embeddings in the scoring hot path. Present the result as a match estimate, never as an ATS pass probability.

Persist an owner-scoped report with a unique `(userId, resumeId, jobKey, scoreVersion)` key. Cache resume terms by owner, file content hash, and score version. Keep ignored terms and optional suggestions on the report. Use 15 deterministic ATS-readiness checks as actionable guidance, not as a prediction of a vendor ATS parser.

Optional AI wording suggestions require the current resume-AI consent, an approved personal-data provider policy, and the shared quota/metering layer. Send only bounded job requirements and compact facts grounded in the selected resume; validate schema, fact IDs, and wording before saving. Delete reports and term caches when their resume or user data is erased.

## Consequences

- Exact repeat requests reuse a report; changing the job content or scoring version creates a separate report.
- Profile facts are shared across resumes, so each fact is checked against the selected resume's source text before it is used as evidence or suggestion input.
- Score weights require an independently reviewed relevance sample before tuning. No external paid service or dependency is added.
