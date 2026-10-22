# 01 — AI call-site inventory

Last verified against commit `1dcc456` plus Phase 3 working-tree changes on 2026-10-17.

## As built (verified in code)

| Feature / call site                                 | Shared boundary         | Tier / prompt ID                         | Inputs → output                                                       | Stream / cache                              | Timeout / retry / fallback                                    | Quota / telemetry                                |
| --------------------------------------------------- | ----------------------- | ---------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| Shared model gateway src/ai/llm.js:115,309          | implementation boundary | provider/model resolved by catalog       | normalized messages → model response/chunks                           | nonstream/SSE generator                     | breaker on nonstream; bounded transient retries               | common quota, ledger and usage metadata          |
| Chat assistant agent src/ai/graphs/chatGraph.js:643 | invokeLLM yes           | resolved by tier; chat-agent-v2          | state.messages, candidate context, tool schemas → assistant message   | streamed SSE / checkpointer                 | 4 iterations max; 4000ms tool timeout; deterministic fallback | quotaService, UsageEvent ledger                  |
| Chat src/controllers/aiController.js:128            | streamLLM yes           | selected chat model; prompt unregistered | user prompt, up to 6 history turns, candidate context → streamed text | SSE true; context cache, not response cache | request 30s abort; transient retry; permitted dev/test mock   | chat quota, stream ledger and completion metrics |

| Router classifier src/ai/router.js:124 | invokeLLM yes | small; unregistered | query → Zod intent/complexity/tool flags | nonstream; exact cache before classifier | shared breaker/retry; deterministic Tier 0 fallback | router quota/usage; routing log |
| Resume extraction src/services/resumeParserService.js:164,181 | invokeLLM yes | small, one call per uncached upload; unregistered | decrypted resume → extractedFactsSchema, grounded to source | nonstream; cache by file hash + facts version | deterministic role parse first; strict schema + grounding | resume_parse quota/ledger |
| JD requirements src/ai/graphs/tailoringGraph.js:62 | invokeLLM yes | small; unregistered | bounded JD → RequirementsSchema | nonstream; no response cache shown | shared layer | extract quota/ledger |
| Tailored bullets src/ai/graphs/tailoringGraph.js:138 | invokeLLM yes | strong; unregistered | profile facts + requirements → BulletsResponseSchema | nonstream | shared layer; fact-ID validation follows | tailor_resume quota/ledger |
| Application email draft src/ai/graphs/applicationGraph.js:117 | invokeLLM yes | small; unregistered | application/company/status/notes → email draft schema | nonstream | shared layer | feature currently labelled chat; ledger through shared layer |
| Interview prep src/ai/graphs/interviewGraph.js:155 | invokeLLM yes | strong; unregistered | job/company/JD/profile facts → InterviewPrepSchema | nonstream | deterministic mock pack in dev/test | interview_prep quota/ledger |
| Legacy mock turn src/ai/graphs/interviewGraph.js:258 | invokeLLM yes | strong; unregistered | question/answer → MockTurnEvaluationSchema | nonstream | graph fallback | interview_prep quota/ledger |
| Session question plan src/services/interview/sessionService.js:219 | invokeLLM yes | configured question tier; session prompt version | resume/JD/role/mode → strict question plan | nonstream | token cap; deterministic fallback questions | mock-interview quota, usage ledger |
| Session answer evaluation src/services/interview/sessionService.js:638 | invokeLLM yes | configured evaluation tier; same stored version | answer + question/transcript state → strict evaluation | nonstream | fallback evaluation; answer claim/idempotency | mock-interview quota/ledger |
| Session report src/services/interview/sessionService.js:733 | invokeLLM yes | configured report tier; same stored version | transcript/scores → report schema | nonstream; one report/session | schema validation/retry/fallback | quota/ledger |
| Rapid stack quiz `src/infrastructure/interview/stackQuizService.ts` | invokeLLM yes | small; `stack-quiz-v1` | bounded profile skills/roles + stack → 3–5 validated questions | one model call per pack; user-scoped 30m cache; curated fallback | strict Zod; answer key hidden until scoring | `interview_prep` quota and shared usage ledger |
| Changed-job batch vectors src/services/jobs/jobIngestionService.js:582 | embeddingService yes | configured embedding provider/model | bounded title/company/requirements/description → vectors | batch; cache by content hash/provider/model/dimension | transient retries | embedding quota, kill switch, UsageEvent |
| Memory vector write/query src/ai/memory/longTerm.js:49,166 | embeddingService yes | configured embedding provider/model | memory content/query → similarity results | no local content-hash cache shown | embedding-boundary retry | chat quota and UsageEvent |
| Provider embedding calls src/services/embeddingService.js:115,218 | Direct vendor call inside shared embeddingService; not invokeLLM | configured OpenAI/Voyage model | text → numeric vectors | provider call | bounded transient retry | metering and kill switch in enclosing service |

No direct provider LLM calls were found outside provider adapters and src/ai/llm.js. Embedding SDK calls do not use invokeLLM because it is a chat-model boundary; the dedicated embeddingService applies shared quota/metering. src/ai/router.js is used in chat but does not execute real tools. Matching is deterministic and LLM-free.

## Job-specific resume match (2026-10-17)

`src/controllers/resumeMatchController.js` calls shared `invokeLLM` only for optional `RESUME_MATCH_PROMPT_VERSION` (`resume-match-suggestions-v1`) suggestions. `resume-match-v1` adds a deterministic on-demand match report for a selected resume and a catalog job, owned application, or explicitly pasted description. It does not fetch arbitrary URLs or call an LLM for scoring. Resume term indexes cache by owner, file content hash, and score version; report identity includes the normalized job hash. Optional AI wording suggestions are separately consent/quota/model-policy guarded, and receive only bounded requirements plus facts grounded in the selected resume.

The catalog emits bounded job interaction events only after separate user opt-in. Events are aggregated for the admin coverage endpoint; analytics collection is off by default per user.

Local-only Phase 3 utilities include `jobs:match:preview` (read-only top-20 profile match), `jobs:eligibility:distribution` (read-only country/scope counts), `jobs:bson:measure` (read-only BSON size sampling), and `jobs:ats:validate`/`jobs:ats:import` (bounded public-board verification and pending-only local import). The first three require a loopback Mongo URI; no personal resume text or model prompts are emitted.

## Target design (not built yet)

Give each prompt a stable code-owned ID/version; enforce inventory freshness in CI; describe data class, supported tier, token limits, schema, retry and cost policy as metadata. Keep vectors behind the metered embedding interface.

**Unverified:** provider usage metadata completeness by model/account. Verify with sanitized ledger aggregates and provider billing reports.
