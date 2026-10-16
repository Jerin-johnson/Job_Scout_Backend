# ADR 0011: Embeddings remain off for new catalog jobs by default

Last verified against commit `Phase 3 working tree` on 2026-10-16.

## As built (verified in code)

`JOB_EMBEDDINGS_ENABLED` defaults to false. Existing vectors are not deleted or re-embedded. When enabled, changed/new jobs use the existing shared embedding boundary, content hash cache, metadata and kill switch. The lexical matching hot path remains LLM- and embedding-free.

## Decision

Avoid variable embedding spend and vector storage while lexical v2 is the production default. Keep the existing vector path available for an explicitly configured future evaluation.

## Target design (not built yet)

Compare lower-dimensional or quantized vectors on labeled retrieval quality and storage before any migration.
