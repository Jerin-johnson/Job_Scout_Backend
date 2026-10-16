# 00 — AI overview

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

The system uses deterministic rules for job feature extraction and ranking, shared model invocation for chat, resume parsing, tailoring, application drafts and interview workflows, and metered embeddings for changed catalog jobs and the memory service. The API and worker are separate processes. See [inventory](01-ai-inventory.md) and [flow diagrams](diagrams/).

| Area       | As built                                                                                                                                                              | Target design (not built yet)                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Matching   | Indexed Mongo retrieval, at most 400 candidates, deterministic lexical-v2 default, top 20 persisted. Rules-only occupation classification is additive. No LLM in discovery hot path. | Broader structured eligibility and occupation data, evaluated retrieval quality and adaptive candidate budget. |
| Chat       | Client-supplied bounded history + server-built profile context; model selected from server allowlist; SSE stream. Router is called for classification/tier selection. | Read-only tools, session persistence, consented memory retrieval, routing by measured outcomes.                |
| Resume     | S3 presigned upload, encrypted resume text in Mongo, cached schema extraction and fact grounding.                                                                     | Explicit lifecycle review and async extraction only if scale justifies it.                                     |
| Interview  | Consent timestamp/version, per-session limits, idempotent answer flow, evaluation and validated report.                                                               | Evaluation corpus by role family and calibrated quality gates.                                                 |
| Embeddings | OpenAI or Voyage adapter, quota/kill-switch, metadata, cache by content hash/provider/model/dimension.                                                                | Measured decision whether job vectors justify their storage/provider cost; no re-embedding before approval.    |
| Cost       | Daily user/global limits, usage events, monthly allowance shadow logging.                                                                                             | Atomic reservation/settlement and plan-aware enforcement (separate approval required).                         |

Design principles evidenced by current code: deterministic-first matching (src/services/jobs/matching.js:126), shared model layer (src/ai/llm.js:115), content-hash resume cache (src/services/resumeParserService.js:145), and plan feature checks in src/services/quotaService.js.

## Target design (not built yet)

Keep the model layer behind the shared gateway; use tools only with server-owned identity/authorization; keep per-item matching LLM-free; require evals for prompt/score changes; make cost reservation atomic before provider spend; and store only data required by approved sources and retention rules. No target item is enabled by this page.

**Unverified:** deployed environment topology, production account provider terms, and observed monthly AI spend. Check deployment manifests, provider billing export, and UsageEvent aggregates.
