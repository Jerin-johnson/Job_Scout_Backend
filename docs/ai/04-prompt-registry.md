# 04 — Prompt registry

## Resume fact extraction v4

- **Version:** `facts-v4` cache namespace; resume extraction prompt behavior is covered by `resume-structured-output.test.js`.
- **Path:** `src/services/resumeParserService.js` through shared `invokeLLM`.
- **Order:** deterministic experience parsing first; at most one structured `small`-tier call on a content-hash cache miss.
- **Inputs:** up to 100,000 characters serialized as a JSON string with `<` and `>` escaped and labeled untrusted data.
- **Output:** strict Zod schema for roles, skills, education, and achievements; cache is keyed by file hash and parser version, including empty results.
- **Grounding:** unsupported title/company/date, skill, degree, achievement, or metric is dropped and counted. Deterministic role facts are copied from source text.
- **Consent:** requires `resume-ai-processing-v1` before upload URL creation or processing.
- **Privacy:** logs contain usage metadata, cache-hit state, and rejected-fact counts only; no resume text, file contents, or presigned URLs.

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Only mock interviews have a prompt-version constant stored with the session (INTERVIEW_PROMPT_VERSION). The names below are documentation labels, not code-owned IDs; other prompts are inline source strings.

| Prompt (code status)                          | File / purpose                                     | Tier                                     | Inputs → output                                           | Delimiting, validation and test coverage                                                  |
| --------------------------------------------- | -------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| CHAT_CONTEXT (unregistered)                   | src/controllers/aiController.js:29; career copilot | selected chat model                      | bounded context/history + user prompt → stream            | history max 6 × 2,000 chars; context labelled untrusted; frontend markdown security tests |
| ROUTER_CLASSIFIER (unregistered)              | src/ai/router.js:124; routing                      | small, possible escalation               | prompt → router Zod schema                                | deterministic route tests                                                                 |
| JD_REQUIREMENTS (unregistered)                | src/ai/graphs/tailoringGraph.js:62                 | small                                    | JD ≤4,000 chars → RequirementsSchema                      | Zod; injection eval coverage **Unverified**                                               |
| TAILORED_BULLETS (unregistered)               | src/ai/graphs/tailoringGraph.js:138                | strong                                   | profile facts + requirements → bullets/summary            | fact IDs validated against profile                                                        |
| APPLICATION_EMAIL_DRAFT (unregistered)        | src/ai/graphs/applicationGraph.js:117              | small                                    | application/status/notes → draft schema                   | Zod; note injection fixture **Unverified**                                                |
| INTERVIEW_PREP (unregistered)                 | src/ai/graphs/interviewGraph.js:155                | strong                                   | role/company/JD/facts → InterviewPrepSchema               | Zod, dev/test mock, interview eval fixtures                                               |
| INTERVIEW_LEGACY_TURN (unregistered)          | src/ai/graphs/interviewGraph.js:258                | strong                                   | question/answer → MockTurnEvaluationSchema                | Zod and graph fallback                                                                    |
| MOCK_INTERVIEW_QUESTION_PLAN (version stored) | src/services/interview/sessionService.js:204–245   | configurable small/strong                | role/level/mode, resume ≤6k chars, JD ≤4k → question plan | resume/JD delimiters and safety rule; Zod; version 2026-10-15-v2                          |
| MOCK_INTERVIEW_EVALUATION (version stored)    | src/services/interview/sessionService.js:620–674   | configurable small/strong                | question + answer ≤4k → evaluation                        | answer delimiter, strict score schema, fallback                                           |
| MOCK_INTERVIEW_REPORT (version stored)        | src/services/interview/sessionService.js:700–800   | configurable small/strong                | bounded transcript/scores → report                        | transcript delimiter; exact evidence rule; schema retry; one report/session; schema v2    |
| RESUME_EXTRACTION (unregistered)              | src/services/resumeParserService.js:104,164        | small, at most once per content hash | resume text → strict facts schema                                | deterministic-first; output grounded against source; consent and resume-parser tests                                       |

Max output tokens and retry details are recorded at each callsite and in feature pages. There is no shared registry or automatic prompt history.

## Target design (not built yet)

Assign stable IDs/immutable versions to all prompts and record them per usage event. Maintain variables, untrusted input sources, schemas, token budgets, defenses, eval links, owner and change history. Use the [new brief template](prompts-and-briefs/brief-template.md).

**Unverified:** prompt history before current Git commits and provider prompt-cache behavior. Check Git history and provider telemetry before defining migration.
# Job-specific resume-match suggestions

- **Version:** `resume-match-suggestions-v1`.
- **Code identifier:** `RESUME_MATCH_PROMPT_VERSION`.
- **Path:** `src/controllers/resumeMatchController.js` through shared `invokeLLM`.
- **Inputs:** bounded normalized requirements and at most 25 compact candidate facts verified against the selected resume text; no raw resume or complete job description.
- **Output:** strict schema with requirement, placement, wording, fact ID, and `onlyIfTrue: true`.
- **Safety and cost:** explicit resume-AI consent, shared quota/metering, paid personal-data-policy model only, untrusted-data delimiters, grounded fact/requirement filtering, and per-report caching. Deterministic matching itself has no LLM call.
