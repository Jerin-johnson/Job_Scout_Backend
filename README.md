# JobScout Backend

Production-ready Node.js/Express API and BullMQ worker for the JobScout AI career workspace. The frontend is a sibling checkout at `../Ai_resume_frontend`.

---

## Architecture Overview

The backend is built strictly according to **Clean Architecture** and **SOLID principles**, enforcing dependency inversion across four discrete architectural rings with the composition root in `src/main/`:

```
src/
├── domain/                  # Enterprise business rules, entities, value objects, repository contracts
│   ├── entities/            # User, Profile, Job, Application, InterviewSession, Memory, ChatSession
│   ├── repositories/        # IUserRepository, IApplicationRepository, IProfileRepository, etc.
│   └── errors/              # DomainError, EntityNotFoundError, InvariantViolationError
├── application/             # Application business logic & single-purpose use cases
│   ├── useCases/            # CreateApplicationUseCase, LoginUserUseCase, UpsertProfileUseCase, etc.
│   ├── dto/                 # Input and output data transfer objects
│   ├── interfaces/          # Abstractions for security, storage, email, caching
│   └── errors/              # ApplicationError, ConflictError, UnauthorizedError, ValidationError
├── infrastructure/          # Technical implementations, frameworks, and database persistence
│   ├── database/mongoose/   # Mongoose schemas, models, and concrete repository implementations
│   ├── security/            # Bcrypt password hasher, JWT token services
│   ├── storage/             # AWS S3 file storage adapter & presigned URLs
│   ├── email/               # Resend email adapter
│   └── cache/               # Redis caching client & distributed locks
├── presentation/            # Driving delivery mechanism: HTTP controllers, routers, middleware
│   └── http/
│       ├── controllers/     # AuthController, ApplicationController, ProfileController, etc.
│       ├── routes/          # Canonical route hierarchy (mounted under /api/v1)
│       └── middlewares/     # Authentication, rate limiting, request validation, error handler
└── main/                    # Composition Root
    ├── di/                  # TSyringe dependency injection container & registration
    ├── app.ts               # Express application bootstrap
    ├── routes.ts            # Canonical API route composition
    ├── server.ts            # HTTP API server entry point
    └── worker.ts            # BullMQ background worker entry point
```

---

## Quick Start

1. Install Node.js 22, MongoDB, and Redis. Copy `.env.example` to `.env` and replace required local placeholders.
2. Run `npm ci` in this directory and `npm ci` in `../Ai_resume_frontend`.
3. Development mode (TypeScript via `tsx`):
   - API Server: `npm run dev` (starts `src/main/server.ts` on `http://localhost:4001`)
   - Worker Service: `npm run worker:dev` (starts `src/main/worker.ts`)
   - Full Stack: `npm run dev:stack` (starts API, worker, and frontend)
4. Production build:
   - Compile: `npm run build` (compiles to `./dist`)
   - Run API: `npm start` (runs `dist/src/main/server.js`)
   - Run Worker: `npm run worker` (runs `dist/src/main/worker.js`)

---

## Quality Gates & Verification Commands

All quality gates must pass cleanly before any code can be committed or pushed:

```bash
# Run strict TypeScript compiler verification
npm run typecheck

# Enforce Clean Architecture boundary rules and zero 'any' annotations
npm run check:architecture

# Run ESLint across the codebase
npm run lint

# Run all 270+ unit, integration, and architecture boundary tests
npm test

# Verify documentation consistency
npm run docs:check

# Scan working directory for accidental secret or credential leaks
npm run scan:secrets

# Run the complete end-to-end verification pipeline in a single command
npm run verify
```

---

## Architecture & Engineering Documentation

- [Clean Architecture Specification](docs/ARCHITECTURE.md)
- [Architectural Decision Records (ADRs)](docs/architecture-decisions.md)
- [Testing Strategy & Boundary Checks](docs/testing-strategy.md)
- [Technical Debt Registry & Deprecation Roadmap](docs/technical-debt.md)
- [Development Workflow & Git Hooks](docs/development-workflow.md)
- [Architecture Audit & Baselining](docs/architecture-audit.md)
- [Architecture File Inventory](docs/architecture-file-inventory.md)
- [AI System Documentation](docs/ai/README.md)
- [Engineering Standards](docs/engineering/standards.md)
- [Local Setup Guide](docs/operations/local-setup.md)
