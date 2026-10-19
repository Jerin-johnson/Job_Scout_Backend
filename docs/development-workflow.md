# Local Development & Quality Workflow

This document details the quality standards, automated checks, Git hooks, and development workflows for `AiJob_search_backend` (`jobscout-api`).

---

## 1. Setup & Environment

### Prerequisites

- Node.js `>= 22.0.0`
- MongoDB `8.x` running on `127.0.0.1:27017` (or local MongoDB-memory-server for tests)
- Redis running on `127.0.0.1:6379`

### Installing Dependencies & Preparing Git Hooks

On Windows (PowerShell), use `npm.cmd` or `node`:

```bash
npm install
npm run prepare # Initializes Husky Git hooks
```

---

## 2. Verification Commands

| Command                      | Purpose                                                                      | When to Run                          |
| :--------------------------- | :--------------------------------------------------------------------------- | :----------------------------------- |
| `npm run typecheck`          | Compiles TypeScript (`tsc --noEmit`) in strict mode                          | Prior to commit; runs in pre-commit  |
| `npm run check:architecture` | Verifies layer boundaries and zero `any` annotations                         | Prior to commit; runs in pre-commit  |
| `npm run lint`               | Runs ESLint 9 across JavaScript/config/test files                            | Before commit; runs in CI            |
| `npm run lint:fix`           | Automatically fixes ESLint rule violations                                   | When lint issues occur               |
| `npm test`                   | Runs 265 unit & integration tests (`node --test`)                            | Before pushing or opening PRs        |
| `npm run format`             | Checks Prettier formatting across the repository                             | In CI                                |
| `npm run format:fix`         | Automatically applies Prettier formatting                                    | To resolve formatting differences    |
| `npm run docs:check`         | Verifies AI documentation integrity                                          | In pre-push and release verification |
| `npm run scan:secrets`       | Scans working tree for uncommitted secrets or API keys                       | In pre-commit and pre-push           |
| `npm run verify`             | Full verification pipeline (`lint + check:architecture + test + docs:check`) | Mandatory pre-merge gate             |

---

## 3. Git Hooks & Lint-Staged

Husky manages automated Git hooks under `.husky/`:

### Pre-Commit Hook (`.husky/pre-commit`)

Executes automatically on every `git commit`:

1. **`lint-staged`**:
   - `*.{js,mjs,cjs}`: Runs `eslint --fix` and `prettier --write` on staged files.
   - `*.{ts,tsx}`: Runs `prettier --write` on staged files.
   - `*.{json,md,yml,yaml}`: Runs `prettier --write` on staged files.
2. **`npm run typecheck`**: Validates strict TypeScript compilation.
3. **`node scripts/check-architecture.mjs`**: Validates layer boundaries:
   - Domain layer cannot import Mongoose, Express, Redis, BullMQ, AWS, or AI SDKs.
   - Application use cases cannot import concrete infrastructure adapters.
   - Infrastructure cannot import presentation controllers.
   - Strictly 0 explicit `any` type annotations across all `src/` source files.
4. **`node scripts/scan-secrets.mjs staged`**: Blocks accidental commit of `.env` files or API credentials.

### Commit-Msg Hook (`.husky/commit-msg`)

Enforces Conventional Commits:

- Format: `type(scope): subject`
- Maximum length: 72 characters
- Allowed types: `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`
- Allowed scopes: `jobs|resume|applications|interviews|chat|profile|ai|infra|docs|deps|release`

---

## 4. Investigating Hook Failures

- **If typecheck fails:** Run `npm run typecheck` locally to see TypeScript compiler errors with line numbers.
- **If architecture check fails:** Run `node scripts/check-architecture.mjs` to view the specific file and layer violation.
- **If secret scan fails:** Inspect staged files for accidentally included credentials or tokens.
- **If commit-msg fails:** Ensure your commit subject follows `type(scope): subject` and is $\le 72$ characters.
