# AI system documentation

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Pages below summarize the backend at this commit. Each page separates executable behavior from not-yet-built decisions. Source references use repository-relative paths and line numbers. Phase 3 is documented in [job quality and supply](17-phase3-job-quality.md) and ADRs 0008–0011; its local-only report/measurement commands are `npm run jobs:eligibility:report`, `npm run jobs:eligibility:apply`, `npm run eval:jobs-phase3`, `npm run jobs:local-profile-report`, and `npm run jobs:local-measure`.

## Target design (not built yet)

Target sections are proposals only; they are not enabled by this documentation commit.

## Reading order

1. [Overview](00-overview.md), [inventory](01-ai-inventory.md), [LLM and routing](02-llm-layer-and-routing.md), [cost and limits](03-cost-quota-and-limits.md), [prompt registry](04-prompt-registry.md).
2. Feature pages: [chat](05-chat-assistant.md), [matching](06-job-matching-engine.md), [interviews](07-interview-engine.md), [resume](08-resume-ai-pipeline.md), [embeddings](09-embeddings-and-vectors.md).
3. Operations: [safety](10-safety-and-privacy.md), [evaluation](11-evaluation.md), [observability](12-observability.md), [failure runbooks](13-failure-modes-and-runbooks.md), [roadmap](14-roadmap-and-open-decisions.md).
4. [Coverage and occupation classification](15-classification-and-catalog-coverage.md), [data inventory](16-data-inventory.md), [Phase 3 job quality and supply](17-phase3-job-quality.md), [job source policy](18-job-source-policy.md), [working agreement](working-agreement.md), [ADRs](adr/), [Mermaid diagrams](diagrams/), and [brief template](prompts-and-briefs/brief-template.md).

## Glossary

- **Tier:** configured small/strong model selection; it does not guarantee different model IDs.
- **Route:** the server-selected feature/provider/model path for one request.
- **Prompt version:** version value saved with a mock interview session; most other prompts are not yet centrally versioned.
- **Score version:** matching implementation identifier used in caches and persisted match records (lexical-v2 is active; lexical-v3 remains parked).
- **Funnel:** counts from active catalog through eligibility, candidate cap, location, and score threshold.
- **Ledger:** UsageEvent records for provider/model, estimated or reported tokens, outcome, cost and retry metadata.

## Known claim limits

- Provider terms and free-tier data policies require legal review; configuration is not legal advice.
- Runtime Redis/worker health is deployment state and is not inferred from code.
- Exact costs depend on provider usage, account billing tier, caches, and retries.
- Claims with missing evidence are labelled **Unverified** on the relevant page.
