# ADR 01 — Lexical-first matching

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Candidate selection ranks lexical feature overlap before recent fallback candidates; deterministic score has version lexical-v3. Discovery makes no LLM calls. See src/services/jobs/jobIngestionService.js and src/services/jobs/matching.js.

## Target design (not built yet)

Keep a lexical/deterministic baseline as the acceptance floor. Change eligibility or weights only after representative evaluation, using a new score version and cache invalidation.
