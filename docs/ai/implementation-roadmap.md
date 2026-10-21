# Independent implementation roadmap

This is a proposal for review, not authorization to begin the next feature phase. It reuses the existing backend and frontend boundaries, MongoDB, Redis/BullMQ, S3 and shared AI layer. No new dependencies or services are assumed.

Last verified against commit `19a9e22951fe449e40690b88248c5db499eda809` for the repository references in this roadmap.

## As built (verified in code)

This repository already includes source policy gates, scheduled ingestion, catalog-only search, deterministic matching, a shared LLM boundary, and a deterministic-first resume pipeline, as documented in the linked AI and architecture pages. The roadmap does not imply these are Jobright internals.

## Target design (not built yet)

Every phase below is future work pending review and explicit task scope.

## Phase 0 — Evidence and baseline

**Goal:** freeze a verifiable starting point. Record active/disabled source counts from local admin reports, API contracts, index explain plans, current match evaluation, extraction fixtures, and frontend job/resume routes. Confirm all source license/terms records and user consent requirements. Do not query hosted production services from local tools.

**Acceptance:** docs match code; catalog coverage statement names only enabled sources; no unsupported claims; baseline metrics include freshness, duplicate ratio, zero results, query p95, candidate count, parse grounding and cost.

## Phase 1 — Data quality and grounded profile facts

**Goal:** make source provenance and candidate facts dependable before increasing recommendation sophistication.

- Extend deterministic normalization/section parsing only where fixture evidence finds errors.
- Keep LLM extraction behind consent, shared routing, policy class, quota and strict validation; add redacted fixtures and error/rejection metrics.
- Validate source-specific posted/expiry/eligibility fields, canonical identity, duplicate behavior, closures and deletion retention.
- Preserve existing fields/API contracts additively with migration reports and rollback when schema changes are justified.

**Acceptance:** per-field precision/recall and groundedness pass agreed gates; source terms are approved; no personal text in logs; tests cover retries, duplicate input and user isolation.

## Phase 2 — Retrieval and match quality

**Goal:** improve measured relevance, not model complexity.

- Review candidate filters and `explain("executionStats")`; bound query result and response size.
- Build independent employer/source/occupation-stratified labeled jobs and candidate profiles.
- Compare current v2 with a versioned candidate scorer using NDCG@10, Precision@10, Recall@50, coverage, unknown eligibility, freshness and latency.
- Add user feedback as an explicit, auditable signal only after privacy and bias review; never silently learn sensitive traits.

**Acceptance:** no regression on frozen fixtures; improvements on held-out cohorts; no increase in known ineligible exposure; score explanations reproduce actual signals; costs remain predictable.

## Phase 3 — Approved source coverage

**Goal:** add only sources with explicit rights and operational limits. Prioritize employer-curated ATS feeds where permitted. Keep adapters disabled by default until terms, attribution, retention, quota, verification and approval are complete. Maintain source kill switches and per-source metrics.

**Acceptance:** fixtures from each source, quota/cursor restart tests, source deletion/expiry tests, accurate attribution and legal review for any unclear redistribution.

## Phase 4 — Optional semantic retrieval and explanation

Only proceed if labeled evaluation shows a gap deterministic retrieval cannot solve. Compare a small embedding candidate set against lexical-only retrieval and cost/latency; model-based explanations consume only already-grounded score evidence. Keep inference out of per-job ingestion and hot matching path. Define budget, quota, kill-switch, cache and data-policy tests first.

## Phase 5 — Product hardening

Measure end-to-end p95, accessibility, saved-search delivery reliability, privacy export/deletion, queue age and provider-failure recovery. Add operational dashboards or infrastructure only after the existing metrics show a need and user approval is obtained.

## Risks / gates

- **Rights and retention:** publicly reachable does not equal licensed to store/display. Stop source activation if terms are unclear or forbid intended use.
- **Geographic coverage:** current catalog can be thin in India-specific, healthcare and government roles. State coverage gaps; partner feeds may be needed.
- **LLM hallucination and leakage:** grounded schemas, consent, policy classes, encryption, token budgets and no raw text logs are non-negotiable.
- **Evaluation bias:** prevent employer/source leakage between train/evaluation data; stratify by geography and occupation; publish unclassified/unknown rate.
- **Operational cost:** first use bounded queries, source deltas, content hashes, cache, short retention and existing services. No datastore/search cluster expansion without a capacity report.
- **Unverified commercial costs:** hosting costs in [hosting decision](../decisions/hosting.md) are planning figures; validate current provider region/price and usage before purchase. LLM examples in [resume/LLM analysis](resume-and-llm-analysis.md) are scenario calculations, not budget commitments.

## Review questions before implementation

1. Which user segments are the first measurable target (for example India fresher software, Kerala nursing, or global remote)?
2. What are acceptable source-specific retention and display rules, and who approves them?
3. What relevance and latency SLOs should gate scoring rollout?
4. Which consented/redacted sample can be labeled, and who reviews labels?
5. What monthly inference and hosting ceiling should the product enforce?

## Verification

Roadmap constraints were cross-checked against current source-policy, matching, resume, catalog-scaling and hosting documentation on 2026-10-20. This is a proposed sequence, not an implementation approval. `npm run docs:check` validates local documentation structure.
