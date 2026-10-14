# Git Commit & Branching Conventions

This repository strictly adheres to **Conventional Commits v1.0.0** with milestone tags for deterministic traceability and automated changelog generation.

---

## 1. Commit Message Structure

```
<type>(<scope>): <subject>

[optional body: non-obvious rationale, architectural impact]

[optional footer: closes #123, BREAKING CHANGE: description]
```

### Commit Types

| Type       | Description                                            | Example                                                    |
| :--------- | :----------------------------------------------------- | :--------------------------------------------------------- |
| `feat`     | A new user-facing feature or backend milestone         | `feat(b2): shared cache helper with single-flight locking` |
| `fix`      | A bug fix or error mitigation                          | `fix(auth): handle expired token family gracefully`        |
| `perf`     | Code change improving execution time or memory         | `perf(router): execute tier 0 and tier 1 in parallel`      |
| `docs`     | Documentation updates only                             | `docs(arch): add architecture and decision records`        |
| `refactor` | Code restructuring without altering external contracts | `refactor(quota): extract budget calculation into service` |
| `chore`    | Maintenance tasks, dependencies, tooling configs       | `chore(deps): update mongoose and bullmq dependencies`     |

---

## 2. Milestone Commit Formation

When delivering project milestones (B1 through B11), commits must explicitly declare the milestone scope:

- `feat(b1): scaffold + infra (env validation, pino logger, health, docker, smoke skeleton)`
- `feat(b2): shared cache helper (typed key builders, single-flight locking, compression, fail-open)`
- `feat(b3): auth, users, quotas, and rate limits (bcrypt 12, token rotation, redis quotas)`
- `feat(b4): profile + resume parsing (fact extraction with factIds, aes-256-gcm)`
- `feat(b5): central llm wrapper (prompt caching, circuit breaker, usage telemetry)`
- `feat(b6): 3-tier ai router (parallel race, confidence escalation, sse streaming)`
- `feat(b7): memory system (short-term redis, long-term vector embeddings, pii defense)`
- `feat(b8): discovery pipeline (job adapters, deduplication, atlas vector matching)`
- `feat(b9): resume tailoring (truthfulness check, ats keyword analysis, interrupt approval)`
- `feat(b10): application tracker, interview prep, and follow-up automation`
- `feat(b11): billing, admin metrics, openapi contract, and final verification`

---

## 3. Formatting Rules

1. **Imperative Mood**: Use imperative present tense in the subject ("add feature", "fix leak", "refactor controller") rather than past tense ("added", "fixed").
2. **Character Limit**: Keep the subject line under 72 characters.
3. **No Trailing Periods**: Never end the subject line with a period (`.`).
4. **Lower Case Subject**: Start the subject with a lowercase letter.
5. **No Secrets**: Never commit `.env`, private keys, or API tokens. Git hooks and CI will reject commits with high-entropy secrets.

---

## 4. Branching & Release Strategy

- **`main`**: Production-ready branch. Deployed automatically to production upon passing CI release gates.
- **`staging`**: Pre-production integration branch. Runs `npm run smoke` against staging infrastructure.
- **Feature Branches**: `feat/<milestone-or-feature>` (e.g., `feat/b3-auth-quotas`).
- **Bugfix Branches**: `fix/<issue-name>` (e.g., `fix/token-rotation-leak`).
