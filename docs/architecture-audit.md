# Architecture Baseline & Audit Report

**Date:** 2026-10-19  
**Repository:** `AiJob_search_backend` (`jobscout-api`)  
**Branch:** `refactor/clean-architecture`  
**Base Commit:** `7fd0053` (Tip of `main` / `development`)  
**Auditor:** Senior Backend Architect & TypeScript Engineer

---

## 1. Baseline Verification Results

All baseline commands were executed against the active repository on Windows (PowerShell/Node.js v22):

| Command / Script                           | Result   | Exit Code | Details / Metrics                                                       |
| :----------------------------------------- | :------- | :-------- | :---------------------------------------------------------------------- |
| `npm run typecheck` (`tsc --noEmit`)       | **PASS** | `0`       | Clean TypeScript compilation; 0 errors across 264 `.ts` files           |
| `npm run build` (`tsc`)                    | **PASS** | `0`       | Compilation output emitted to `dist/`                                   |
| `npm test`                                 | **PASS** | `0`       | **260 tests**: 259 passed, 1 skipped (`jobs-schedule-report`), 0 failed |
| `npm run lint` (`eslint .`)                | **PASS** | `0`       | 0 errors, 1 warning (console log statement in test)                     |
| `npm run format` (`prettier --check .`)    | **FAIL** | `1`       | Code style warnings across 485 files (repository-wide check)            |
| `npm run docs:check` (`check-ai-docs.mjs`) | **PASS** | `0`       | 0 JS files in src, 0 leaked env vars, 100 markdown pages                |
| `node scripts/scan-secrets.mjs working`    | **PASS** | `0`       | 518 files scanned; 0 secrets detected                                   |
| `node scripts/check-commits.mjs`           | **PASS** | `0`       | 26 outgoing commits conform to Conventional Commits format              |

---

## 2. Existing Architecture Overview

The backend operates on Node.js (>=22.0.0) with Express, MongoDB/Mongoose, Redis/ioredis, BullMQ, and LangChain/LangGraph.

### Directory Structure & Layout

- **`src/main/`**: Application entry points and composition root:
  - `container.ts`: TSyringe DI container registration (`TOKENS`, repositories, security, use cases).
  - `app.ts`: Express application setup (security headers, CORS, body parsers, error handler).
  - `server.ts`: HTTP server bootstrap, MongoDB connection, Redis init, super-admin seeding.
  - `worker.ts`: BullMQ background worker (job ingestion, match refresh, reminder queues).
- **`src/app.ts`, `src/server.ts`, `src/worker.ts`**: Re-export entry points delegating to `src/main/*`.
- **`src/domain/`**:
  - `entities/`: Domain entity definitions (`User.ts`, `Profile.ts`, `Application.ts`, etc.).
  - `errors/`: Domain errors (`DomainError`, `EntityNotFoundError`, `ConflictError`, etc.).
  - `repositories/`: Repository contracts (`IUserRepository`, `IProfileRepository`, etc.).
  - `security/`, `storage/`, `notifications/`: Infrastructure contracts.
- **`src/application/`**:
  - `useCases/`: Core application use cases for `auth`, `applications`, `profile`.
  - `dtos/`: Input/output DTOs and Zod schemas.
  - `errors/`: Application-level errors (`ApplicationError`, `UnauthorizedError`, etc.).
- **`src/infrastructure/`**:
  - `database/mongoose/models/`: Canonical Mongoose schemas and models (32 models).
  - `database/mongoose/repositories/`: TSyringe `@injectable()` repositories.
  - `security/`, `storage/`, `email/`: Infrastructure adapters (`BcryptPasswordHasher`, etc.).
- **`src/presentation/`**:
  - `http/controllers/`: Controllers for `AuthController`, `ApplicationController`, `ProfileController`.
  - `http/routes/`: Route modules mounted via `src/presentation/http/routes/index.ts`.
  - `http/middleware/`: HTTP middlewares (`authMiddleware`, `errorHandlerMiddleware`).
- **`src/models/`**: 32 re-export forwarders pointing to `../infrastructure/database/mongoose/models/*Model.js`.
- **`src/controllers/`**: 14 active and legacy controllers for features not yet consolidated into `src/presentation/http/controllers/`.
- **`src/routes/`**: 15 route files for active features (`jobs.ts`, `ai.ts`, etc.) and orphaned duplicates (`auth.ts`, `applications.ts`, `profile.ts`).
- **`src/services/`**: Feature-specific domain services, application workflows, and integration adapters (`jobs/*`, `interview/*`, `resume*`, etc.).
- **`src/repositories/`**: 4 legacy singleton repository files (`userRepository.ts`, etc.).
- **`src/ai/`**: LangGraph state graphs, LLM router, tool loop, provider adapters, context assembly.
- **`src/shared/`**: Common utilities, constants, types, and schemas.
- **`src/config/`**: Configuration modules (`env.ts`, `database.ts`, `redis.ts`, `shutdown.ts`).

---

## 3. Identified Architectural Inconsistencies & Violations

1. **Dual Route & Presentation Layer**:
   - `src/presentation/http/routes/index.ts` is the active API router mounted at `/api/v1` in `src/main/app.ts`.
   - However, it delegates part of its routes to `src/routes/*.ts` which in turn call `src/controllers/*.ts`.
   - Meanwhile, `src/routes/auth.ts`, `src/routes/applications.ts`, and `src/routes/profile.ts` are completely orphaned duplicates that are never imported anywhere.
2. **Re-export Forwarder Directory `src/models/`**:
   - Every file in `src/models/` simply contains `export * from "../infrastructure/database/mongoose/models/<ModelName>Model.js"`.
   - Multiple consumers across `services/`, `controllers/`, and `tests/` still import from `src/models/*.js` instead of importing canonical models from `src/infrastructure/database/mongoose/models/`.
3. **Dual Repository Layer**:
   - `src/infrastructure/database/mongoose/repositories/` contains TSyringe `@injectable()` repositories implementing domain interfaces.
   - `src/repositories/` contains global singleton instances (`userRepository`, `profileRepository`, `applicationRepository`, `interviewRepository`) which are still directly imported in background workers, legacy controllers, and services.
4. **Git Hook & Lint-Staged Blind Spot**:
   - `lint-staged.config.mjs` is configured with `*.{js,mjs,cjs}` and `*.{json,md,yml,yaml}`.
   - It **does not include `*.{ts,mts,cts}`**! As a result, TypeScript files staged for commit completely bypass `lint-staged`.
5. **ESLint TypeScript Rules Gap**:
   - `eslint.config.js` only configures `@eslint/js` (`js.configs.recommended`) without `@typescript-eslint` plugin/parser integration.
   - While TypeScript compilation (`tsc --noEmit`) is strict, ESLint does not enforce TypeScript-specific lint rules.

---

## 4. Proposed Architectural Corrections

1. **Phase 1: Source Tree Audit**:
   - Generate complete inventory in `docs/architecture-file-inventory.md`.
2. **Phase 2 & 3: Clean Architecture Boundaries & Dependency Direction**:
   - Keep Presentation -> Application -> Domain -> Infrastructure dependency hierarchy intact.
   - Standardize DI token registrations in `src/main/container.ts`.
3. **Phase 4: Resolve `src/models/`**:
   - Confirm all 32 models in `src/infrastructure/database/mongoose/models/` are canonical.
   - Migrate consumers to import directly from `src/infrastructure/database/mongoose/models/` or narrow domain entities.
   - Maintain re-export forwarders where external scripts or legacy test fixtures require backward compatibility, or safely retire them once all consumers are updated.
4. **Phase 5: Consolidate Presentation & Repositories**:
   - Remove orphaned route duplicates (`src/routes/auth.ts`, `src/routes/applications.ts`, `src/routes/profile.ts`) that are never imported.
   - Integrate all active routes into `src/presentation/http/routes/` cleanly.
   - Wire repository consumers through the DI container or domain interfaces where applicable.
5. **Phase 9 & 10: Code Quality & Git Hooks**:
   - Update `lint-staged.config.mjs` to include `*.{ts,mts,cts}`.
   - Ensure ESLint checks all TypeScript files without suppressing errors.
   - Verify pre-commit hook runs lint-staged and secret scanner effectively.
6. **Phase 11: Architecture Boundary Enforcement**:
   - Add automated check script (e.g. `scripts/check-architecture.mjs`) to verify domain does not import mongoose/express/infrastructure.

---

## 5. Files to Consolidate or Relocate

- **Orphaned Route Files to Retire (after zero-reference verification)**:
  - `src/routes/auth.ts`
  - `src/routes/applications.ts`
  - `src/routes/profile.ts`
- **Re-export Forwarders to Investigate**:
  - `src/models/*.ts` (32 forwarders)
- **Config & Tooling Files to Update**:
  - `lint-staged.config.mjs` (Add `*.{ts,mts,cts}`)
  - `package.json` (Verify scripts and hooks)

---

## 6. Files That Must NOT Be Removed Without Further Evidence

- `src/repositories/interviewRepository.ts`: Actively used by mock interview expiry sweep in `src/main/server.ts` and `src/services/interview/sessionService.ts`.
- `src/repositories/userRepository.ts`: Actively used in worker heartbeat, admin boostrapping in `server.ts`, and legacy controllers.
- `src/models/*`: Must retain safe forwarders until all tests and background worker imports are redirected.
- `src/app.ts`, `src/server.ts`, `src/worker.ts`: Canonical root entry points expected by external runners and legacy tooling.

---

## 7. Risks & Verification Strategy

- **Risk:** Breaking MongoDB model registration or schema hooks when redirecting imports.
  - **Mitigation:** Run `npm test` after each incremental change.
- **Risk:** Breaking BullMQ job payloads or background workers.
  - **Mitigation:** Run worker unit/integration tests and repeat schedule reconciliation tests.
- **Risk:** Pre-commit hook failures on Windows.
  - **Mitigation:** Test `npx lint-staged` directly using cross-platform syntax.

---

## 8. Audit & Refactoring Execution Outcomes

1. **Presentation Route Consolidation & src/routes/ Elimination:**
   - Consolidated and migrated ALL active routes into `src/presentation/http/routes/`:
     - `adminRoutes.ts`, `aiRoutes.ts`, `applicationRoutes.ts`, `authRoutes.ts`, `billingRoutes.ts`, `feedbackRoutes.ts`, `healthRoutes.ts`, `interviewRoutes.ts`, `jobRoutes.ts`, `memoryRoutes.ts`, `privacyRoutes.ts`, `profileRoutes.ts`, `resumeMatchRoutes.ts`, `tailorRoutes.ts`.
   - Updated `src/presentation/http/routes/index.ts` to mount all routes canonically under `/api/v1`.
   - Updated `src/main/routes.ts` as the composition root router factory and `src/main/app.ts` to consume it.
   - Completely eliminated the legacy `src/routes/` directory (all 15 route files removed).
2. **`src/models/` Verification & Disposition:**
   - Verified that all 32 canonical Mongoose models reside in `src/infrastructure/database/mongoose/models/*Model.ts`.
   - Audited 109 consumer files across the repository (68 src, 16 tests, 25 operational scripts).
   - Preserved `src/models/*.ts` as clean 1-line forwarder facades to prevent breaking operational scripts (`compact-job-hot-documents.js`, `ensure-indexes.js`, etc.) and background workers.
3. **Husky & Lint-Staged Configuration:**
   - Updated `lint-staged.config.mjs` to format `*.{ts,tsx}` with Prettier.
   - Enhanced `.husky/pre-commit` to execute `lint-staged`, `npm run typecheck`, `node scripts/check-architecture.mjs`, and secret scanning.
4. **Automated Architecture Boundaries & Tests:**
   - Created `scripts/check-architecture.mjs` to programmatically enforce domain independence, use case abstraction, forbidden reintroduction of `src/routes/`, and zero `any` annotations.
   - Created `tests/architecture-boundaries.test.js` containing 11 boundary enforcement tests (both negative violation injection tests and positive production conformance checks).
   - Test suite expanded from 260 to 271 tests: **270 passed, 1 skipped, 0 failed**.
5. **Architectural Documentation:**
   - Created `docs/architecture-decisions.md` (ADRs 001 - 005).
   - Created `docs/testing-strategy.md` (Testing levels, mocking, database setup, quality gates).
   - Created `docs/technical-debt.md` (Facade registry, impact, and sunset milestones).
   - Updated `README.md` and `docs/development-workflow.md`.
