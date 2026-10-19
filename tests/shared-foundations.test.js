import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Phase 2: Shared Foundations & Error Hierarchy", () => {
  it("should export unique DI tokens for repositories, use cases, and services", async () => {
    const { TOKENS } = await import("../dist/src/shared/constants/injectionTokens.js");

    assert.ok(TOKENS.UserRepository);
    assert.ok(TOKENS.RegisterUserUseCase);
    assert.ok(TOKENS.PasswordHasher);

    const tokenValues = Object.values(TOKENS);
    const tokenSet = new Set(tokenValues);
    assert.equal(tokenSet.size, tokenValues.length, "All DI tokens must be unique symbols");
  });

  it("should provide typed DomainError hierarchy with correct status codes", async () => {
    const {
      EntityNotFoundError,
      EntityConflictError,
      DomainValidationError,
      InvalidStateTransitionError,
    } = await import("../dist/src/domain/errors/index.js");

    const notFound = new EntityNotFoundError("User", "usr_123");
    assert.equal(notFound.statusCode, 404);
    assert.equal(notFound.code, "NOT_FOUND");
    assert.match(notFound.message, /usr_123/);

    const conflict = new EntityConflictError("Email already in use");
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.code, "CONFLICT");

    const validation = new DomainValidationError("Invalid email format");
    assert.equal(validation.statusCode, 400);
    assert.equal(validation.code, "VALIDATION_ERROR");

    const invalidState = new InvalidStateTransitionError("Cannot reject hired application");
    assert.equal(invalidState.statusCode, 400);
    assert.equal(invalidState.code, "INVALID_STATE_TRANSITION");
  });

  it("should provide typed ApplicationError hierarchy matching existing HTTP responses", async () => {
    const {
      NotFoundError,
      UnauthorizedError,
      ForbiddenError,
      ConflictError,
      ValidationError,
      BadRequestError,
      QuotaExceededError,
      InternalServerError,
    } = await import("../dist/src/application/errors/index.js");

    const errors = [
      { err: new NotFoundError("Not found"), status: 404, code: "NOT_FOUND" },
      { err: new UnauthorizedError("Auth required"), status: 401, code: "UNAUTHORIZED" },
      { err: new ForbiddenError("Denied"), status: 403, code: "FORBIDDEN" },
      { err: new ConflictError("Exists"), status: 409, code: "CONFLICT" },
      { err: new ValidationError("Bad payload"), status: 400, code: "VALIDATION_ERROR" },
      { err: new BadRequestError("Malformed"), status: 400, code: "BAD_REQUEST" },
      { err: new QuotaExceededError("Rate limit"), status: 429, code: "QUOTA_EXCEEDED" },
      { err: new InternalServerError("Crash"), status: 500, code: "INTERNAL_SERVER_ERROR" },
    ];

    for (const { err, status, code } of errors) {
      assert.equal(err.statusCode, status);
      assert.equal(err.code, code);
      assert.ok(err instanceof Error);
      const json = err.toJSON();
      assert.equal(json.statusCode, status);
      assert.equal(json.code, code);
    }
  });

  it("should validate and export typed env configuration", async () => {
    const { env, envSchema } = await import("../dist/src/config/env.js");

    assert.ok(env);
    assert.ok(env.NODE_ENV);
    assert.ok(env.PORT);
    assert.ok(envSchema);
  });
});
