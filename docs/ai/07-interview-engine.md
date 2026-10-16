# 07 — Mock interview engine

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

src/services/interview/sessionService.js creates sessions for a user-owned resume, records consent timestamp/version, prompt/schema versions, enforces token cap/report reserve, and creates a question plan with deterministic fallback. Answers use idempotency, sequence numbers, a status state machine, and server-side time enforcement. Evaluation uses a bounded transcript and strict Zod schema with fallback. Completion is idempotent, validates the report schema with retry, and stores one report per session. Session retention defaults to 90 days.

Modes/tier config live in src/shared/constants/interviews.js. Premium default is 3 starts/day, free trial disabled, token cap 12,000, retention 90 days; question/evaluation tiers default small and report strong. Provider calls use invokeLLM and record UsageEvent.

## Target design (not built yet)

Expand evaluation fixtures by role/seniority and compare generated reviews against human-rated examples. Calibrate rubrics and track provider drift. Audio is a separately approved channel; current path is text-based.

**Unverified:** production cleanup schedule and retention compliance beyond schema configuration. Inspect worker schedule and retention audit.
