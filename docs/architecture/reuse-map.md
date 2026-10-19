# Architecture Reuse Map

Every workstream (`feat/jobs-production`, `feat/chat-agent`, `feat/product-loop`) must extend the existing modules listed below rather than rebuilding parallel abstractions. All cross-module relationships were verified via Graphify (`graphify-out/graph.json` and `../graphify-out/merged-graph.json`) and direct source inspection.

## 1. Shared LLM Layer & Provider Adapters (`invokeLLM`)

- **Backend files**:
  - `src/ai/llm.js` (`invokeLLM`, `formatCachedPrompt`, circuit breaker, prompt cache ordering)
  - `src/ai/providers/index.js`, `src/ai/providers/gemini.js`, `src/ai/providers/groq.js`, `src/ai/providers/anthropic.js`
  - `src/ai/modelCatalog.js`, `src/ai/modelPricingCatalog.js`, `src/ai/providerErrors.js`
  - `src/services/embeddingService.js` (metered, kill-switch-aware embedding boundary)
- **Rule**: Every model call must go through `src/ai/llm.js` (or the shared provider boundary wired to quota/ledger/kill-switch). Direct provider SDK calls outside `src/ai/` are forbidden. Never add per-job LLM calls to ingestion or matching.

## 2. Usage Ledger, Quotas & Entitlements

- **Backend files**:
  - `src/services/quotaService.js` (daily/monthly token & USD budget enforcement, reserve-then-settle accounting)
  - `src/middleware/quotaGate.js` (HTTP quota gate middleware)
  - `src/models/UsageEvent.js` (immutable usage and cost ledger rows, including partial stream cancellation settlements)
  - `src/shared/constants/plans.js` (`PLANS`, `FREE`, `PRO`, `PREMIUM` feature limits and model tier entitlements)
  - `src/services/billingService.js`, `src/models/Subscription.js`, `src/models/Payment.js`
- **Rule**: All AI turns, tool loops, saved searches, and email alert limits must read plan entitlements from `src/shared/constants/plans.js` and record usage in `UsageEvent` via `quotaService.js`.

## 3. Candidate Context Card

- **Backend files**:
  - `src/ai/candidateContext.js` (builds untrusted-delimiter-wrapped candidate snapshot from `Profile`, `Resume`, `Application` counts, and latest `InterviewReport` score)
- **Rule**: Reuse `candidateContext.js` as the pinned candidate context block in chat and agent prompts after static system rules.

## 4. AI Router

- **Backend files**:
  - `src/ai/router.js` (`routeRequest` — Tier 0 deterministic rules/slash commands/exact cache -> Tier 1 small model -> Tier 2 strong model escalation)
  - `src/models/RoutingLog.js`, `src/models/SemanticCache.js`
- **Rule**: Extend `router.js` for chat intent classification and tool routing (rules first, small model only when ambiguous, plan-aware).

## 5. Chat Controller, SSE Streaming & Frontend Chat Client

- **Backend files**:
  - `src/controllers/aiController.js`, `src/routes/ai.js`
  - `src/ai/chatStream.js` (SSE event framing, heartbeat, client disconnect `AbortController` handling, partial usage ledger settlement)
  - `src/ai/checkpointer.js` (`@langchain/langgraph-checkpoint-mongodb` integration)
- **Frontend files**:
  - `src/app/app/chat/page.jsx`
  - `src/lib/chat-session.mjs` (bounded history window, retry state, stream assembly)
  - `src/components/chat/MarkdownMessage.mjs` (safe bounded Markdown rendering)
  - `src/lib/schema/chat.js`, `src/lib/api/operations.js`
- **Rule**: Reuse `chatStream.js` and `MarkdownMessage.mjs` when adding LangGraph tool status chips, source citations, session history, and action confirmation cards.

## 6. Memory Model & Service

- **Backend files**:
  - `src/models/Memory.js`
  - `src/ai/memory/shortTerm.js` (Redis sliding window)
  - `src/ai/memory/longTerm.js` (durable preference extraction, cosine deduplication, protected-attribute compliance filter)
  - `src/controllers/memoryController.js`, `src/routes/memory.js`
- **Rule**: Extend `Memory`, `longTerm.js`, and `memoryController.js` to enforce versioned memory consent, top-k retrieval, edit/delete/pause/forget-all, and profile-wins-over-memory precedence.

## 7. Matching, Eligibility & Classification Services

- **Backend files**:
  - `src/services/jobs/matching.js` (`lexical-v2` / `lexical-v3` scoring funnel)
  - `src/services/matchRefreshService.js`, `src/models/Match.js`, `src/models/MatchRefresh.js`
  - `src/services/jobs/eligibility.js`, `src/services/jobs/eligibilityRegions.js`
  - `src/services/jobs/occupationClassification.js`, `src/services/jobs/occupationEvaluation.js`, `src/services/jobs/roleNormalization.js`
  - `src/ai/graphs/discoveryGraph.js`
- **Frontend files**:
  - `src/lib/jobs/salaryDisplay.mjs`, `src/lib/jobs/roleFactsPrompt.mjs`
- **Rule**: Keep `lexical-v2` as default unless the ranking gate passes; extend `matching.js` and `matchRefreshService.js` for inverted-index incremental recompute.

## 8. Resume Match & Profile Services

- **Backend files**:
  - `src/services/resumeMatchService.js`, `src/models/JobMatchReport.js`, `src/controllers/resumeMatchController.js`, `src/routes/resumeMatch.js`
  - `src/services/resumeParserService.js`, `src/services/resumeRoleParser.js`, `src/services/resumeDataLifecycle.js`
  - `src/models/Profile.js`, `src/models/Resume.js`, `src/repositories/profileRepository.js`
- **Frontend files**:
  - `src/components/resume-match/ResumeMatchPanel.jsx`, `src/app/app/resume-match/page.jsx`, `src/lib/schema/resume-match.js`
- **Rule**: The chat tool `run_resume_match` and `get_resume_facts` must call `resumeMatchService.js` and `profileRepository.js` directly without duplicating scoring or parsing logic.

## 9. Job Ingestion, Source Registry & Storage Split

- **Backend files**:
  - `src/services/jobs/jobIngestionService.js`, `src/services/jobs/sourcePolicies.js`
  - `src/services/jobs/adapters/*` (`baseAdapter.js`, `remoteOkAdapter.js`, `jobicyAdapter.js`, `adzunaAdapter.js`, `publicAtsAdapter.js`, `remotiveAdapter.js`, etc.)
  - `src/services/jobs/jobStorage.js`, `src/services/jobs/jobIndexes.js`, `src/services/jobs/catalogVersion.js`, `src/services/jobs/jobRisk.js`
  - `src/models/Job.js` (hot collection), `src/models/JobDetail.js` (cold descriptions/provenance), `src/models/JobVector.js` (embeddings), `src/models/JobSource.js`, `src/models/Company.js`, `src/models/TrackedCompany.js`, `src/models/HiddenJob.js`, `src/models/JobReport.js`
- **Frontend files**:
  - `src/app/app/jobs/page.jsx`, `src/app/app/jobs/[id]/page.jsx`, `src/app/app/admin/page.jsx`, `src/lib/schema/jobs.js`
- **Rule**: Preserve the hot/cold/vector storage split (`Job`, `JobDetail`, `JobVector`), `JobCatalogVersion` cache invalidation, and `sourcePolicies.js` governance gates.

## 10. Queues, Workers & Email Digest

- **Backend files**:
  - `src/worker.js`, `src/config/redis.js`, `src/config/shutdown.js`
  - `src/services/jobs/repeatSchedule.js`, `src/services/jobs/scheduleReport.js`
  - `src/services/applicationReminderQueue.js`
  - `src/services/emailDigestService.js` (Resend integration)
- **Rule**: Saved search alerts and digests must run through BullMQ in `src/worker.js` and `src/services/emailDigestService.js`.

## 11. Application & Interview Services

- **Backend files**:
  - `src/repositories/applicationRepository.js`, `src/services/applicationLifecycle.js`, `src/models/Application.js`, `src/controllers/applicationController.js`, `src/ai/graphs/applicationGraph.js`
  - `src/services/interview/sessionService.js`, `src/repositories/interviewRepository.js`, `src/models/InterviewSession.js`, `src/models/InterviewMessage.js`, `src/models/InterviewReport.js`, `src/controllers/interviewController.js`, `src/ai/graphs/interviewGraph.js`
- **Frontend files**:
  - `src/app/app/applications/page.jsx`, `src/components/applications/*`, `src/lib/jobs/trackJobApplication.mjs`, `src/app/app/interviews/page.jsx`
- **Rule**: Chat read tools and propose-and-confirm actions must invoke `applicationRepository.js`, `applicationLifecycle.js`, and `interview/sessionService.js` with strict `userId` ownership scoping.

## 12. Consent Records, Privacy Export & Account Deletion

- **Backend files**:
  - `src/services/resumeAiConsent.js` (resume AI processing consent version/timestamp)
  - `src/services/jobs/interactionEvents.js`, `src/models/InteractionEvent.js` (opt-in pseudonymous job interaction analytics consent)
  - `src/services/exportService.js`, `src/controllers/privacyController.js`, `src/routes/privacy.js`
  - `src/models/AuditLog.js`, `src/models/UserFeedback.js`
- **Frontend files**:
  - `src/app/app/settings/page.jsx`, `src/lib/schema/profile.js`, `src/lib/schema/feedback.js`
- **Rule**: New features that store user data (saved searches, alert preferences, chat sessions, memories, action audit logs) must register with `exportService.js` and the GDPR/DPDP account deletion cascade in `privacyController.js`.
