# ADR 07 — Do not scrape restricted job portals

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Ingestion is adapter/registry based; the enabled approved source set is Remote OK, Remotive, Jobicy. Other source names/configuration do not by themselves enable ingestion.

## Target design (not built yet)

Do not scrape portals without verified license/terms, attribution, retention, quota and explicit approval. Use official APIs or permitted employer feeds only.
