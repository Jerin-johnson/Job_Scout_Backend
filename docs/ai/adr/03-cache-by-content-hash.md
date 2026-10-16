# ADR 03 — Cache by content hash

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Resume extraction uses file hash plus parser-version key. Embedding cache includes job content hash, provider, model and dimension. Match response cache includes profile and score versions.

## Target design (not built yet)

Keep cache namespaces versioned and provider/model-specific. Never use a cache hit across embedding spaces or after changing extraction/scoring versions. Document cache TTL and invalidation with each feature.
