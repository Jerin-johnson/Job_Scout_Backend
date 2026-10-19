# Architectural Decision Records (ADRs)

Last updated: 2026-10-19  
Scope: `AiJob_search_backend`  
Status: Accepted & Enforced

---

## ADR-001: Isolation of Persistence Models in Infrastructure

### Context

In earlier iterations of the backend, Mongoose models were imported directly across application services, controllers, and utility scripts. This tightly coupled business workflows to MongoDB-specific schema definitions, BSON types, and Mongoose query semantics.

### Decision

All Mongoose schemas, interfaces, and model factories are strictly contained within `src/infrastructure/database/mongoose/models/`.

- Domain entities in `src/domain/entities/` are pure TypeScript classes or interfaces representing business rules and state, completely decoupled from MongoDB or Mongoose.
- Data access is mediated through repository interfaces in `src/domain/repositories/` and concrete Mongoose implementations in `src/infrastructure/database/mongoose/repositories/`.
- Mapping between Mongoose documents and Domain entities occurs within the repository implementation boundary (`BaseMongooseRepository` and concrete subclasses).

### Consequences

- **Positive:** Domain logic can be tested in-memory without a running database or complex Mongoose mocks. MongoDB can be tuned, indexed, or swapped without altering domain invariants.
- **Negative:** Requires explicit mapping between database documents and domain entities.
- **Enforcement:** Enforced via `scripts/check-architecture.mjs`, which prohibits `src/domain/` and `src/application/useCases/` from importing `mongoose` or `src/infrastructure/database/mongoose/models/`.

---

## ADR-002: Separation of Repository Contracts from Concrete Implementations

### Context

Direct dependencies between application use cases and concrete database repositories violate the Dependency Inversion Principle (DIP). Inverting this dependency allows use cases to depend only on abstractions.

### Decision

1. **Contracts (Interfaces):** Reside exclusively in `src/domain/repositories/` (e.g., `IUserRepository`, `IApplicationRepository`, `IProfileRepository`, `IJobRepository`, `IInterviewRepository`).
2. **Implementations:** Reside exclusively in `src/infrastructure/database/mongoose/repositories/` (e.g., `MongooseUserRepository`, `MongooseApplicationRepository`, `MongooseProfileRepository`).
3. **Dependency Injection:** Use cases declare dependencies via constructor injection using TSyringe `@inject(TOKENS.IUserRepository)`. The Composition Root (`src/main/di/container.ts`) registers concrete implementations into the TSyringe container.

### Consequences

- **Positive:** Application use cases are 100% unit-testable with lightweight mock repositories. No MongoDB connection is required for use case testing.
- **Negative:** Requires managing DI tokens and registration bindings in `src/shared/di/tokens.ts` and `src/main/di/container.ts`.
- **Enforcement:** Enforced via `scripts/check-architecture.mjs` and verified by `tests/architecture-boundaries.test.js`.

---

## ADR-003: Canonical Presentation Route Hierarchy and Elimination of `src/routes/`

### Context

Prior to refactoring, HTTP routes were split across two competing directories: legacy `src/routes/` and clean architecture `src/presentation/http/routes/`. This introduced duplication, ambiguous routing entry points, and inconsistent middleware application.

### Decision

1. All route definitions are consolidated into `src/presentation/http/routes/`.
2. A single canonical router module (`src/presentation/http/routes/index.ts`) mounts all functional sub-routers under `/api/v1`.
3. The composition root exports `createAppRoutes()` via `src/main/routes.ts` and is mounted in `src/main/app.ts`.
4. The legacy `src/routes/` directory was completely removed.

### Consequences

- **Positive:** Single, authoritative source of truth for all HTTP API endpoints. Consistent authentication, rate limiting, and validation middleware.
- **Negative:** Requires all consumers, tests, and documentation to refer to `src/presentation/http/routes/`.
- **Enforcement:** `scripts/check-architecture.mjs` strictly checks that `src/routes/` does not exist and throws an immediate violation if reintroduced.

---

## ADR-004: Managed Compatibility Facades and Sunset Policy

### Context

The repository includes 25 operational CLI maintenance scripts, 16 test suites, and internal modules that historically imported models via `src/models/*.ts` and singleton repositories via `src/repositories/*.ts`. Deleting all facade forwarders in a single pass would break operational CLI scripts used for catalog indexing, migrations, and evaluation benchmarks.

### Decision

1. Retain thin 1-line re-export forwarders in `src/models/*.ts` pointing directly to canonical models in `src/infrastructure/database/mongoose/models/*Model.ts`.
2. Retain legacy `src/repositories/*.ts` singleton wrappers for CLI scripts while registering new clean architecture repositories in the TSyringe DI container.
3. New feature development, controllers, and application use cases must NEVER import legacy paths; they must use DI tokens or canonical paths.

### Sunset & Removal Criteria

1. **Inventory Tracking:** The file inventory in `docs/architecture-file-inventory.md` tracks all 32 facade files and consumer counts.
2. **Phase 1 (Complete):** Core application, server, and router completely decoupled from `src/routes/` and legacy paths.
3. **Phase 2 (In Progress):** Migrate remaining operational CLI scripts in `scripts/` to resolve repositories from the TSyringe container (`resolveToken()`).
4. **Phase 3:** When consumer references drop to 0, delete `src/models/` and legacy `src/repositories/`.

---

## ADR-005: Automated Architectural Boundary Verification

### Context

Manual code review is insufficient to prevent architectural drift, layer leaks (e.g., domain importing Mongoose or use cases importing Express), or the introduction of untyped `any` annotations.

### Decision

An automated architectural checker (`scripts/check-architecture.mjs`) is integrated into the pre-commit workflow and CI quality gates:

1. **Rule 0:** Forbidden reintroduction of obsolete directories (`src/routes`).
2. **Rule 1:** Domain layer isolation (no imports of Mongoose, Express, Redis, BullMQ, AI SDKs, or outer layers).
3. **Rule 2:** Application use case isolation (no direct imports of concrete infrastructure repositories, Mongoose models, or Express Request/Response).
4. **Rule 3:** Infrastructure layer isolation (no imports of HTTP presentation controllers).
5. **Rule 4:** Zero explicit `any` type annotations across all `src/` TypeScript files.

Negative and positive behavior is validated in `tests/architecture-boundaries.test.js`.
