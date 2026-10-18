# ADR 07 — Do not scrape restricted job portals

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Ingestion is adapter/registry based. Remote OK is visible by default; Jobicy is approved but disabled by default and only locally enabled via `ENABLE_JOBICY_INGESTION=true`; Remotive stays disabled until written redistribution permission is recorded. Other source names/configuration do not by themselves enable ingestion.

## Target design (not built yet)

Do not scrape portals without verified license/terms, attribution, retention, quota and explicit approval. Use official APIs or permitted employer feeds only.
