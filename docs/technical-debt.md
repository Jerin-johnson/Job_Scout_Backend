# Technical Debt Registry & Deprecation Roadmap

Last updated: 2026-10-20  
Scope: `AiJob_search_backend`  
Status: 100% Resolved & Eliminated

---

## 1. Overview & Principles

Technical debt in `AiJob_search_backend` is cataloged, bounded, and tracked with measurable exit criteria. All legacy compatibility facades, forwarders, and redundant directories have been completely decommissioned and eliminated.

---

## 2. Retired Technical Debt Items

### TD-001: Model Re-export Facades (`src/models/*.ts`) — RETIRED

- **Status:** **RETIRED & ELIMINATED** (100% Complete)
- **Resolution Summary:**
  - All 32 legacy forwarder files in `src/models/*.ts` were deleted via `git rm -r src/models`.
  - All active consumers across `src/`, `tests/`, and `scripts/` (over 109 consumer files) were migrated to import directly from `src/infrastructure/database/mongoose/models/*Model.ts`.
  - The `src/models` directory no longer exists.
  - The automated architecture enforcement script (`scripts/check-architecture.mjs`) strictly rejects any reintroduction of `src/models`.

---

### TD-002: Legacy Repository Singletons (`src/repositories/`) — RETIRED

- **Status:** **RETIRED & ELIMINATED** (100% Complete)
- **Resolution Summary:**
  - `src/repositories/` was completely removed via `git rm -r src/repositories`.
  - Canonical repositories are located in `src/infrastructure/database/mongoose/repositories/` (`MongooseUserRepository.ts`, `MongooseProfileRepository.ts`, `MongooseApplicationRepository.ts`, `MongooseInterviewRepository.ts`).
  - Repository interfaces reside in `src/domain/repositories/` (`IUserRepository.ts`, `IProfileRepository.ts`, `IApplicationRepository.ts`).
  - All background workers (`src/main/worker.ts`), server bootstraps (`src/main/server.ts`), controllers, and tests were migrated to canonical infrastructure repositories.
  - Automated architecture checks reject any reintroduction of `src/repositories`.

---

### TD-003: Presentation Facades (`src/controllers/`, `src/middleware/`, `src/routes/`) — RETIRED

- **Status:** **RETIRED & ELIMINATED** (100% Complete)
- **Resolution Summary:**
  - `src/controllers/`, `src/middleware/`, and `src/routes/` have all been completely removed via `git rm -r`.
  - Canonical presentation components reside exclusively in:
    - `src/presentation/http/controllers/` (14 canonical controllers)
    - `src/presentation/http/middleware/` (canonical middleware)
    - `src/presentation/http/routes/` (canonical Express routes)
  - All routes, tests, and application modules import directly from `src/presentation/http/`.
  - Automated architecture checks reject any reintroduction of `src/controllers`, `src/middleware`, or `src/routes`.

---

## 3. Debt Retirement Checklist

| ID     | Component                                      | Previous Consumers                       | Target Milestone | Final Status          |
| ------ | ---------------------------------------------- | ---------------------------------------- | ---------------- | --------------------- |
| TD-001 | `src/models/*.ts` facades                      | 109 files (25 scripts, 16 tests, 68 src) | v1.0.0           | **RETIRED & DELETED** |
| TD-002 | `src/repositories/*.ts` singletons             | 14 files (worker & CLI scripts)          | v1.0.0           | **RETIRED & DELETED** |
| TD-003 | `src/controllers/` & `src/middleware/` facades | 8 files (legacy test helpers)            | v1.0.0           | **RETIRED & DELETED** |
| TD-004 | `src/routes/` legacy directory                 | Entire routing tree                      | v1.0.0           | **RETIRED & DELETED** |

---

## 4. Current Architecture Debt Summary

- **Obsolete Directories Remaining:** 0
- **Legacy Compatibility Facades Remaining:** 0
- **`.js` Files in `src/`:** 0
- **`any` Type Annotations in `src/`:** 0
- **Active Unit & Integration Tests Passing:** 271 / 271 (1 skipped)
