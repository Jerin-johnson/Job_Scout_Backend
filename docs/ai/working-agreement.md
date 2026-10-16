# AI coding working agreement

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Repository guidance is in root AGENTS.md. This documentation task creates a dependency-free inventory/link/environment check. CI runs lint, formatting, unit/integration tests, and the docs check after the workflow update.

## Target design (not built yet)

- Diagnose the current code and reproduce the issue before editing.
- Break large requests into approved phases and pause at review gates.
- No new dependency, paid service, infrastructure, destructive migration, or external write without approval.
- Keep each change small and reviewable; state assumptions and mark missing evidence Unverified.
- Do not log secrets, personal data, prompts, resume text, answers, or presigned URLs.
- Run relevant tests and AI evals; document the same commit's behavior.
- UI changes include screenshots at 375/768/1280px in both themes and accessibility checks.
- Report files changed, tests, behavior, known gaps and next decision.

Use the PR template at ../../.github/pull_request_template.md. These are repository rules, not an automated approval service.
