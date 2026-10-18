# ADR 0015: Bounded ingestion and keyset catalog reads

Last verified against commit `f4b536709b1154acf5d88a0e7ce9c58ec19be1b7` plus working-tree changes on 2026-10-17.

## As built (verified in code)

Ingestion batches, catalog cursor, and bounded candidate retrieval are implemented.

## Target design (not built yet)

All source-specific delta/mark-and-sweep paths still require implementation and tests.

Status: accepted.

## Decision

Use the existing worker, registry quotas, resumable cursors, bounded retries and unordered batches. Discovery reads indexed Mongo data only. Catalog pagination uses a stable posted-date plus `_id` cursor; candidate retrieval is capped and list projections omit long descriptions and vectors. No per-job LLM or embedding calls are made in discovery.

## Limits

Per-source run leases/metrics, full-feed delta semantics, and `lastSeen` mark-and-sweep are not complete for every adapter. Full-sync benchmarks at 100k/500k/1M are Unverified. Do not enable a source until the source-specific adapter, retention and failure behavior are fixture/integration tested.
