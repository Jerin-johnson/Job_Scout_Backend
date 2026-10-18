# 14 — Roadmap and open decisions

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Shared invocation, metering, source registry, deterministic job scoring, chat streaming, resume extraction, interview sessions and a memory API exist as described in pages 01–13. Phase 2 eligibility and INR work is not part of this delivery.

The data-supply branch adds a local company-master backfill, review-only ATS candidate harvesting, occupation labeling-sheet scorer, opt-in interaction telemetry, and fixture-only licensed-feed/government-notice scaffolding. No vendor is connected or enabled. The JobStream live measurement is currently unverified due the source endpoint timing out/DNS failure in the available network.

Beta-readiness additions now include a Settings feedback form/API, consented coverage summary, cache invalidation version, health probes, worker/API shutdown cleanup, Sentry event redaction, and hosting/operations documentation. The feedback and redaction behavior has automated coverage; live deployment remains unverified. The Docker daemon was unavailable for compose backup/restore rehearsal.

## Target design (not built yet)

| Decision                                     | Prerequisite                                                             | Main risk                              | Cost note                                                 | Decision needed                                  |
| -------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Atomic cost reservations/monthly enforcement | Provider ledger reconciliation, idempotent settlement, shadow comparison | False blocks or overspend under races  | Extra Redis/Mongo writes; estimate requires traffic data  | Approve a separate design.                       |
| Read-only chat tools                         | Tool registry, typed args, authorization and ownership tests             | Prompt injection/unauthorized mutation | One or more model/tool round trips                        | Approve exact tools and permissions.             |
| Consented memory in chat                     | Pause/consent gate fixed at every path, retention/deletion tests         | Unwanted retention or stale facts      | Embedding calls and vector storage                        | Approve memory scope and consent copy.           |
| Action buttons                               | Validated payload and explicit user confirmation                         | Accidental state changes               | Mostly deterministic; model cost depends on feature       | Approve action list.                             |
| Cached LLM job enrichment                    | Source terms and quality review; content-hash cache                      | Stale/wrong attributes                 | Cost per changed job depends on token volume              | Approve only if rules are insufficient.          |
| Voice interviews                             | Separate consent, retention, safety and provider review                  | High privacy/latency/provider spend    | Provider audio pricing is deployment-specific             | No channel approval yet.                         |
| Vector storage/re-embedding                  | Quality test, dimension comparison, additive migration/rollback          | Lost semantic behavior/data            | Current average 20.4 KB/job; API cost needs token volumes | Approve report-only experiment before migration. |

No roadmap item is implemented by this documentation. No estimates beyond measured BSON and catalog token rates are asserted.

**Unverified:** roadmap priority, target scale and product decisions. Obtain explicit approval before starting any listed item.

**Owner decisions:** complete the stratified 300-title occupation review; re-run the official GeoNames/O*NET download from a stable network and approve an additive import/rollback review before use; select staging host only after measuring Kerala p95 and checking Redis `noeviction`/persistence; run the isolated Compose restore rehearsal; verify deployed Sentry settings.
