# Backend TypeScript Migration Plan

## 1. Executive Summary

This document defines the incremental, phase-by-phase migration of the `jobscout-api` backend from ECMAScript (ESM) JavaScript to strictly typed TypeScript under Clean Architecture and SOLID principles, utilizing TSyringe for dependency injection.

### Primary Objectives

- **Zero Behavioral Regressions:** Preserve 100% of existing business rules, database queries, collection names, indexes, API contracts, response models, and security logic.
- **Clean Architecture & SOLID:** Enforce the dependency inversion rule:
  `Presentation -> Application -> Domain <- Infrastructure`, with the composition root in `Main`.
- **Dependency Injection via TSyringe:** Decouple use cases from concrete database and infrastructure adapters using constructor injection and centralized token registration.
- **Incremental Verification & Git Strategy:** Execute migration across distinct, testable phases. Verify each phase via type checking, linting, unit/integration tests, and commit cleanly before proceeding.

---

## 2. Source-to-Target File Mapping

| Existing JavaScript File (`src/...`)    | Target Clean Architecture Path (`src/...`)                                                                                         | Architectural Layer | Responsibility / Notes                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------- |
| `config/env.js`                         | `config/env.ts`                                                                                                                    | Config              | Zod-validated environment schema & typed configuration                     |
| `config/database.js`                    | `infrastructure/database/connection.ts` & `config/database.ts`                                                                     | Config / Infra      | Mongoose connection lifecycle, readiness checks, loopback guard            |
| `config/redis.js`                       | `infrastructure/cache/redis.ts`                                                                                                    | Infrastructure      | Redis connection client & event handlers                                   |
| `config/sentry.js`                      | `infrastructure/logging/sentry.ts`                                                                                                 | Infrastructure      | Error tracking initialization                                              |
| `config/shutdown.js`                    | `main/shutdown.ts`                                                                                                                 | Main                | Graceful signal handling & resource teardown                               |
| `shared/utils/logger.js`                | `infrastructure/logging/logger.ts`                                                                                                 | Infrastructure      | Pino logger instance & HTTP request logging middleware                     |
| `shared/utils/crypto.js`                | `shared/utils/crypto.ts`                                                                                                           | Shared              | Nonce and hashing utilities                                                |
| `shared/utils/webOrigin.js`             | `shared/utils/webOrigin.ts`                                                                                                        | Shared              | Origin verification for CORS                                               |
| `shared/utils/fileValidation.js`        | `shared/utils/fileValidation.ts`                                                                                                   | Shared              | Magic-number MIME validation for uploads                                   |
| `shared/cache.js`                       | `infrastructure/cache/cacheService.ts`                                                                                             | Infrastructure      | Cache get/set/del wrapper & TTL definitions                                |
| `shared/constants/plans.js`             | `shared/constants/plans.ts`                                                                                                        | Shared              | Subscription plans, limits, and roles                                      |
| `shared/constants/interviews.js`        | `shared/constants/interviews.ts`                                                                                                   | Shared              | Interview modes, durations, and criteria                                   |
| `models/User.js`                        | `domain/entities/User.ts` & `infrastructure/database/mongoose/models/UserModel.ts`                                                 | Domain / Infra      | User entity invariants + Mongoose UserModel schema                         |
| `models/Profile.js`                     | `domain/entities/Profile.ts` & `infrastructure/database/mongoose/models/ProfileModel.ts`                                           | Domain / Infra      | Profile entity + ProfileModel schema                                       |
| `models/Resume.js`                      | `domain/entities/Resume.ts` & `infrastructure/database/mongoose/models/ResumeModel.ts`                                             | Domain / Infra      | Resume metadata & encrypted content schema                                 |
| `models/Job.js`                         | `domain/entities/Job.ts` & `infrastructure/database/mongoose/models/JobModel.ts`                                                   | Domain / Infra      | Job hot catalog entity + JobModel schema                                   |
| `models/JobDetail.js`                   | `infrastructure/database/mongoose/models/JobDetailModel.ts`                                                                        | Infrastructure      | Split storage cold document details                                        |
| `models/JobVector.js`                   | `infrastructure/database/mongoose/models/JobVectorModel.ts`                                                                        | Infrastructure      | Split storage embeddings                                                   |
| `models/JobSource.js`                   | `infrastructure/database/mongoose/models/JobSourceModel.ts`                                                                        | Infrastructure      | Feed source registry and run tracking                                      |
| `models/Application.js`                 | `domain/entities/Application.ts` & `infrastructure/database/mongoose/models/ApplicationModel.ts`                                   | Domain / Infra      | Kanban application entity + schema                                         |
| `models/InterviewSession.js`            | `domain/entities/InterviewSession.ts` & `infrastructure/database/mongoose/models/InterviewSessionModel.ts`                         | Domain / Infra      | Mock interview session entity + schema                                     |
| `models/InterviewReport.js`             | `domain/entities/InterviewReport.ts` & `infrastructure/database/mongoose/models/InterviewReportModel.ts`                           | Domain / Infra      | Interview evaluation report schema                                         |
| `models/Memory.js`                      | `domain/entities/Memory.ts` & `infrastructure/database/mongoose/models/MemoryModel.ts`                                             | Domain / Infra      | Consent-gated memory entity + schema                                       |
| `models/ChatSession.js`                 | `domain/entities/ChatSession.ts` & `infrastructure/database/mongoose/models/ChatSessionModel.ts`                                   | Domain / Infra      | Chat thread & session entity + schema                                      |
| `models/AuditLog.js`                    | `infrastructure/database/mongoose/models/AuditLogModel.ts`                                                                         | Infrastructure      | Audit trail schema                                                         |
| `repositories/userRepository.js`        | `domain/repositories/IUserRepository.ts` & `infrastructure/database/mongoose/repositories/MongooseUserRepository.ts`               | Domain / Infra      | User repository contract & Mongoose implementation with in-memory fallback |
| `repositories/profileRepository.js`     | `domain/repositories/IProfileRepository.ts` & `infrastructure/database/mongoose/repositories/MongooseProfileRepository.ts`         | Domain / Infra      | Profile & resume persistence                                               |
| `repositories/applicationRepository.js` | `domain/repositories/IApplicationRepository.ts` & `infrastructure/database/mongoose/repositories/MongooseApplicationRepository.ts` | Domain / Infra      | Application tracker persistence & Kanban stats                             |
| `repositories/interviewRepository.js`   | `domain/repositories/IInterviewRepository.ts` & `infrastructure/database/mongoose/repositories/MongooseInterviewRepository.ts`     | Domain / Infra      | Interview session & report queries                                         |
| `services/authService.js`               | `application/use-cases/auth/*` & `infrastructure/security/*`                                                                       | Application / Infra | RegisterUser, LoginUser, RotateToken use cases + BcryptHasher, JwtService  |
| `services/storageService.js`            | `infrastructure/storage/S3StorageService.ts` & `application/interfaces/IStorageService.ts`                                         | Infra / Application | S3 presigned URL generation and bucket integration                         |
| `services/emailDigestService.js`        | `infrastructure/email/ResendEmailService.ts` & `application/interfaces/IEmailService.ts`                                           | Infra / Application | Alert digests via Resend API                                               |
| `services/jobs/*`                       | `application/use-cases/jobs/*` & `infrastructure/jobs/*`                                                                           | Application / Infra | JobSearchUseCase, MatchingService, IngestionService                        |
| `services/applicationLifecycle.js`      | `application/use-cases/applications/*`                                                                                             | Application         | Application status transitions & follow-up rules                           |
| `services/interview/sessionService.js`  | `application/use-cases/interview/*`                                                                                                | Application         | CreateSession, ProcessMessage, CompleteInterview use cases                 |
| `controllers/authController.js`         | `presentation/http/controllers/AuthController.ts`                                                                                  | Presentation        | Thin HTTP controller invoking Auth use cases                               |
| `controllers/profileController.js`      | `presentation/http/controllers/ProfileController.ts`                                                                               | Presentation        | Thin HTTP controller for profile & resume endpoints                        |
| `controllers/jobController.js`          | `presentation/http/controllers/JobController.ts`                                                                                   | Presentation        | Thin HTTP controller for job search & alerts                               |
| `controllers/applicationController.js`  | `presentation/http/controllers/ApplicationController.ts`                                                                           | Presentation        | Thin HTTP controller for Kanban board                                      |
| `controllers/interviewController.js`    | `presentation/http/controllers/InterviewController.ts`                                                                             | Presentation        | Thin HTTP controller for mock interviews                                   |
| `controllers/aiController.js`           | `presentation/http/controllers/AiController.ts`                                                                                    | Presentation        | Thin HTTP controller for SSE chat streaming                                |
| `controllers/memoryController.js`       | `presentation/http/controllers/MemoryController.ts`                                                                                | Presentation        | Thin HTTP controller for candidate memory management                       |
| `controllers/adminController.js`        | `presentation/http/controllers/AdminController.ts`                                                                                 | Presentation        | Admin dashboard & feed management controller                               |
| `controllers/privacyController.js`      | `presentation/http/controllers/PrivacyController.ts`                                                                               | Presentation        | GDPR/DPDP export and right-to-be-forgotten                                 |
| `controllers/resumeMatchController.js`  | `presentation/http/controllers/ResumeMatchController.ts`                                                                           | Presentation        | Resume match reports & suggestions                                         |
| `middleware/auth.js`                    | `presentation/http/middleware/authentication.ts`                                                                                   | Presentation        | JWT verification & user context attachment                                 |
| `middleware/errorHandler.js`            | `presentation/http/middleware/errorHandler.ts`                                                                                     | Presentation        | Centralized error handler translating to common response format            |
| `app.js`                                | `main/app.ts`                                                                                                                      | Main                | Express app factory & middleware wiring                                    |
| `server.js`                             | `main/server.ts`                                                                                                                   | Main                | Process entry point & HTTP listener                                        |
| `worker.js`                             | `main/worker.ts`                                                                                                                   | Main                | BullMQ queue worker entry point                                            |

---

## 3. Migration Sequence & Phases

### Phase 0: Audit & Architecture Specification (Current)

- Complete codebase inspection, dependency inventory, and Graphify mapping.
- Author `docs/architecture.md`, `docs/migration-plan.md`, `docs/api-contracts.md`.
- No changes to existing application runtime code.
- **Commit:** `docs(docs): document backend migration plan and architecture`

### Phase 1: TypeScript Foundation & TSyringe Tooling

- Install development dependencies: `typescript`, `@types/node`, `@types/express`, `@types/cors`, `@types/compression`, `@types/cookie-parser`, `@types/bcryptjs`, `@types/jsonwebtoken`, `@types/multer`, `tsyringe`, `reflect-metadata`, `tsx`.
- Configure `tsconfig.json` with strict mode, ESM module resolution (`NodeNext`), decorator metadata support (`experimentalDecorators`, `emitDecoratorMetadata`).
- Add build (`tsc`), dev (`tsx watch src/main/server.ts`), and typecheck scripts.
- Verify compilation and startup compatibility without touching existing application logic.
- **Commit:** `chore(infra): configure typescript and dependency injection tooling`

### Phase 2: Shared Foundations, Error Hierarchy & DI Tokens

- Define centralized injection tokens in `src/shared/constants/injectionTokens.ts`.
- Establish typed error hierarchy (`DomainError`, `ApplicationError`, `NotFoundError`, `UnauthorizedError`, `ConflictError`, `ValidationError`).
- Create typed common response interfaces matching existing `{ data: ... }` and `{ error: { code, message, details, requestId } }`.
- Verify runtime environment validation schema in `src/config/env.ts`.
- **Commit:** `refactor(infra): establish shared backend foundations and error models`

### Phase 3: Database Layer & Base Repository Pattern

- Define typed Mongoose documents and schemas for all models in `src/infrastructure/database/mongoose/models/`.
- Introduce generic type-safe `BaseMongooseRepository<TDocument, TEntity, TId>` in `src/infrastructure/database/mongoose/repositories/BaseMongooseRepository.ts`.
- Define repository interfaces in `src/domain/repositories/` (`IUserRepository`, `IProfileRepository`, `IApplicationRepository`, `IInterviewRepository`, `IJobRepository`).
- Implement concrete repositories extending `BaseMongooseRepository` with preserved in-memory offline fallbacks.
- Implement domain entity mappers (`UserMapper`, `ProfileMapper`, `ApplicationMapper`).
- **Commit:** `refactor(infra): migrate database models and repositories to typescript`

### Phase 4: Application Layer & Use Cases

- Define generic `IUseCase<TInput, TOutput>` interface.
- Implement isolated, testable use cases with constructor injection:
  - Auth: `RegisterUserUseCase`, `LoginUserUseCase`, `GoogleLoginUseCase`, `RefreshTokenUseCase`.
  - Applications: `GetApplicationsUseCase`, `CreateApplicationUseCase`, `UpdateApplicationUseCase`, `UpdateApplicationStatusUseCase`, `ScheduleFollowUpUseCase`.
  - Profile & Resume: `GetProfileUseCase`, `UpsertProfileUseCase`, `PresignResumeUploadUseCase`, `CompleteResumeUploadUseCase`.
  - Jobs: `SearchJobsUseCase`, `GetRecommendedJobsUseCase`, `SaveJobUseCase`, `ManageSavedSearchesUseCase`.
  - Interviews: `CreateInterviewSessionUseCase`, `SendInterviewMessageUseCase`, `CompleteInterviewUseCase`.
  - Memory: `RetrieveMemoriesUseCase`, `ManageMemoryConsentUseCase`.
- Define strictly typed input/output DTOs with Zod schemas.
- **Commit:** `refactor(infra): migrate application use cases with clean architecture`

### Phase 5: Infrastructure Adapters & TSyringe Container

- Implement security services: `BcryptPasswordHasher` (implementing `IPasswordHasher`) and `JwtTokenService` (implementing `ITokenService`).
- Implement storage adapter: `S3StorageService` (implementing `IStorageService`).
- Implement email adapter: `ResendEmailService` (implementing `IEmailService`).
- Implement centralized TSyringe dependency registration in `src/main/container.ts`.
- Verify container startup, resolving dependencies via symbols/tokens.
- **Commit:** `refactor(infra): configure infrastructure dependency injection container`

### Phase 6: Presentation Layer (Controllers, Routes & Middleware)

- Implement thin, typed HTTP controllers in `src/presentation/http/controllers/` resolving use cases via TSyringe.
- Migrate Express middleware (`authentication`, `errorHandler`, `quotaGate`, `rateLimiter`).
- Migrate Express routers in `src/presentation/http/routes/` and centralize in `src/main/routes.ts`.
- Assemble `src/main/app.ts` Express factory and `src/main/server.ts` HTTP server.
- Ensure all HTTP status codes, headers, cookies, and responses match the existing API contracts.
- **Commit:** `refactor(infra): migrate http presentation layer and controllers`

### Phase 7: Testing, Regression Verification & Build

- Migrate test suites to run against TypeScript implementation.
- Verify unit tests, repository integration tests with local MongoDB, and behavior tests.
- Execute full linting (`eslint .`), docs verification (`npm run docs:check`), and production build (`npm run build`).
- **Commit:** `test(infra): verify typescript migration and api compatibility`

### Phase 8: Final Documentation, Graphify Update & Cleanup

- Update `README.md`, `docs/architecture.md`, and integration logs.
- Remove deprecated JavaScript source files after verifying 100% replacement.
- Re-run `graphify update .` to index the clean TypeScript graph.
- Final gate verification.
- **Commit:** `docs(docs): finalize typescript clean architecture documentation`

---

## 4. Key Compatibility & Safety Guardrails

1. **Strict ESM Configuration:** Maintain Node.js ESM (`"type": "module"`), using NodeNext module resolution. All relative imports must retain explicit extensions (`.js` or `.ts` depending on loader / compiler output).
2. **MongoDB Database Compatibility:** Preserve all existing collection names (`users`, `profiles`, `resumes`, `jobs`, `applications`, `interviewsessions`, etc.), field names, compound indexes, and lean projection behavior.
3. **Security Invariants:** Retain bcrypt cost factor 12, token rotation with cryptographic family revocation, cookie security settings (Lax, HTTPOnly, secure in production), and rate limiting.
4. **Local Isolation:** Ensure all test bootstrap guards refusing non-loopback MongoDB and Redis remain strictly intact.
