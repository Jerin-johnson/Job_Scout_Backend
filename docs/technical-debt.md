# Technical Debt Registry & Deprecation Roadmap

Last updated: 2026-10-19  
Scope: `AiJob_search_backend`  
Status: Documented & Managed

---

## 1. Overview & Principles

Technical debt in `AiJob_search_backend` is cataloged, bounded, and tracked with measurable exit criteria. Temporary backward-compatibility facades must never hide structural defects or allow unauthorized architectural drift.

---

## 2. Active Technical Debt Items

### TD-001: Model Re-export Facades (`src/models/*.ts`)

- **Description:** 32 TypeScript files in `src/models/*.ts` serve as 1-line re-export forwarders to `src/infrastructure/database/mongoose/models/*Model.ts`.
- **Reason Retained:** 109 consumer files (25 operational CLI maintenance scripts, 16 test suites, and 68 internal services) historically imported from `src/models/`. Keeping facades prevented runtime breakage during the core Clean Architecture refactoring.
- **Impact Assessment:**
  - _Risk:_ Minimal. The facades contain only `export * from ...` or `export default ...` pointing to the single canonical model definitions.
  - _Runtime Overhead:_ Zero.
  - _Type Safety:_ Preserved completely; TypeScript resolves the canonical types directly.
- **Removal Roadmap:**
  1. _Phase 1 (Complete):_ All canonical models consolidated under `src/infrastructure/database/mongoose/models/`.
  2. _Phase 2 (Next Sprint):_ Refactor operational CLI scripts under `scripts/` to import directly from `src/infrastructure/database/mongoose/models/` or resolve via TSyringe DI.
  3. _Phase 3:_ Update remaining integration tests to reference canonical model paths.
  4. _Phase 4:_ Delete `src/models/` directory once consumer count reaches 0.

---

### TD-002: Legacy Repository Singletons (`src/repositories/`)

- **Description:** Several singleton repository instances (e.g., `userRepository`, `jobRepository`, `applicationRepository`) exist in `src/repositories/*.ts` wrapping Mongoose queries without constructor dependency injection.
- **Reason Retained:** Background worker jobs (`src/main/worker.ts`) and older operational scripts (`scripts/sync-company-master.js`, `scripts/ensure-indexes.js`) rely on static module exports rather than DI resolution.
- **Impact Assessment:**
  - _Risk:_ Low. New application use cases (`src/application/useCases/`) are strictly prohibited by `scripts/check-architecture.mjs` from importing concrete repositories.
  - _Clean Architecture Isolation:_ The DI container registers canonical implementations (`MongooseUserRepository`, etc.) implementing domain contracts (`IUserRepository`).
- **Removal Roadmap:**
  1. _Phase 1 (Complete):_ Clean Architecture use cases strictly depend on domain interfaces (`src/domain/repositories/`).
  2. _Phase 2:_ Update worker jobs to resolve repositories from the TSyringe container (`resolveToken()`).
  3. _Phase 3:_ Transition CLI scripts to use container-resolved repositories.
  4. _Phase 4:_ Safely delete legacy `src/repositories/`.

---

### TD-003: Presentation Facades (`src/controllers/`, `src/middleware/`)

- **Description:** Re-export forwarders in `src/controllers/` and `src/middleware/` pointing to `src/presentation/http/controllers/` and `src/presentation/http/middlewares/`.
- **Reason Retained:** Legacy tests and auxiliary tools still reference the flat paths.
- **Impact Assessment:**
  - _Risk:_ Zero. All canonical route definitions in `src/presentation/http/routes/` and `src/main/routes.ts` use the canonical presentation layer directly.
- **Removal Roadmap:**
  1. _Phase 1 (Complete):_ `src/routes/` completely eliminated. Canonical routes mount canonical controllers directly.
  2. _Phase 2:_ Refactor legacy tests to import directly from `src/presentation/http/`.
  3. _Phase 3:_ Remove facade directories.

---

## 3. Debt Retirement Checklist

| ID     | Component                                      | Current Consumers                        | Target Milestone | Status                |
| ------ | ---------------------------------------------- | ---------------------------------------- | ---------------- | --------------------- |
| TD-001 | `src/models/*.ts` facades                      | 109 files (25 scripts, 16 tests, 68 src) | v1.1.0           | Managed / Stable      |
| TD-002 | `src/repositories/*.ts` singletons             | 14 files (worker & CLI scripts)          | v1.1.0           | Bounded by Arch Check |
| TD-003 | `src/controllers/` & `src/middleware/` facades | 8 files (legacy test helpers)            | v1.1.0           | Managed / Stable      |
