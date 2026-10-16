# 09 — Embeddings and vectors

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

src/services/embeddingService.js supports OpenAI text-embedding-3-small and configured Voyage models. It checks global kill switch/quota, validates vectors, retries classified transient errors, records a usage event and returns provider/model/dimension metadata. Job ingestion batches vectors for new/changed jobs; cache key includes content hash/provider/model/dimension. Legacy vectors without metadata remain unknown. Long-term memory uses the same service.

Measured dev storage: embedding BSON averages 20,415 bytes/job at dimension 1,536 versus 28,807 bytes total. See [storage options](../JOB_MATCHING.md). Deterministic matching does not need job vectors today. Do not delete or silently re-embed existing vectors.

## Target design (not built yet)

Choose whether to stop creating new job vectors while preserving old vectors, separate vectors into a collection, or adopt smaller dimensions. Compare retrieval quality before dimension changes. Re-embedding requires approved report-only estimate, additive version, staged backfill, quality comparison and rollback. No migration was run.

**Unverified:** vector consumers outside the callsites found in the inventory and full re-embedding cost. Inspect consumers and token counts before estimating.
