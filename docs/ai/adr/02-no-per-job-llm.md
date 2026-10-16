# ADR 02 — No per-job LLM calls

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Job features use deterministic parsing and discovery is provider-free. Ingestion currently creates embeddings in batches for new/changed jobs, which is a separate metered path.

## Target design (not built yet)

Do not call a generative model per job in ingest, list, or discovery. Any cached enrichment requires source-term review, explicit demand, content-hash dedupe, measured cost, and approval.
