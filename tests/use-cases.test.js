import "reflect-metadata";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("Phase 4: Clean Architecture Application Layer Use Cases", () => {
  let RegisterUserUseCase;
  let LoginUserUseCase;
  let RefreshTokenUseCase;
  let GetApplicationsUseCase;
  let CreateApplicationUseCase;
  let UpdateApplicationStatusUseCase;
  let GetProfileUseCase;
  let UpsertProfileUseCase;
  let MongooseUserRepository;
  let MongooseApplicationRepository;
  let MongooseProfileRepository;
  let BcryptPasswordHasher;
  let JwtTokenService;

  beforeEach(async () => {
    const authModule = await import("../dist/src/application/useCases/auth/index.js");
    const appModule = await import("../dist/src/application/useCases/applications/index.js");
    const profModule = await import("../dist/src/application/useCases/profile/index.js");
    const repos =
      await import("../dist/src/infrastructure/database/mongoose/repositories/index.js");
    const hasherModule =
      await import("../dist/src/infrastructure/security/BcryptPasswordHasher.js");
    const tokenModule = await import("../dist/src/infrastructure/security/JwtTokenService.js");

    RegisterUserUseCase = authModule.RegisterUserUseCase;
    LoginUserUseCase = authModule.LoginUserUseCase;
    RefreshTokenUseCase = authModule.RefreshTokenUseCase;
    GetApplicationsUseCase = appModule.GetApplicationsUseCase;
    CreateApplicationUseCase = appModule.CreateApplicationUseCase;
    UpdateApplicationStatusUseCase = appModule.UpdateApplicationStatusUseCase;
    GetProfileUseCase = profModule.GetProfileUseCase;
    UpsertProfileUseCase = profModule.UpsertProfileUseCase;

    MongooseUserRepository = repos.MongooseUserRepository;
    MongooseApplicationRepository = repos.MongooseApplicationRepository;
    MongooseProfileRepository = repos.MongooseProfileRepository;
    BcryptPasswordHasher = hasherModule.BcryptPasswordHasher;
    JwtTokenService = tokenModule.JwtTokenService;
  });

  it("should register a new user, hash password, and issue tokens", async () => {
    const userRepo = new MongooseUserRepository();
    const hasher = new BcryptPasswordHasher();
    const tokens = new JwtTokenService();
    const registerUseCase = new RegisterUserUseCase(userRepo, hasher, tokens);

    const result = await registerUseCase.execute({
      email: "architect@jobscout.com",
      password: "StrongPassword123!",
      name: "Senior Architect",
    });

    assert.ok(result.user.id);
    assert.equal(result.user.email, "architect@jobscout.com");
    assert.ok(result.tokens.accessToken);
    assert.ok(result.tokens.refreshToken);

    // Verify stored password hash is actually bcrypt-hashed
    const stored = await userRepo.findByEmail("architect@jobscout.com");
    assert.ok(stored);
    assert.notEqual(stored.passwordHash, "StrongPassword123!");
    assert.ok(await hasher.compare("StrongPassword123!", stored.passwordHash));
  });

  it("should reject duplicate registration with ConflictError", async () => {
    const userRepo = new MongooseUserRepository();
    const hasher = new BcryptPasswordHasher();
    const tokens = new JwtTokenService();
    const registerUseCase = new RegisterUserUseCase(userRepo, hasher, tokens);

    await registerUseCase.execute({
      email: "duplicate@jobscout.com",
      password: "Password123!",
      name: "User One",
    });

    await assert.rejects(
      async () => {
        await registerUseCase.execute({
          email: "duplicate@jobscout.com",
          password: "Password123!",
          name: "User Two",
        });
      },
      (err) => {
        assert.equal(err.code, "CONFLICT");
        assert.equal(err.statusCode, 409);
        return true;
      },
    );
  });

  it("should log in an existing user with valid password and reject invalid password", async () => {
    const userRepo = new MongooseUserRepository();
    const hasher = new BcryptPasswordHasher();
    const tokens = new JwtTokenService();
    const registerUseCase = new RegisterUserUseCase(userRepo, hasher, tokens);
    const loginUseCase = new LoginUserUseCase(userRepo, hasher, tokens);

    const registered = await registerUseCase.execute({
      email: "login@jobscout.com",
      password: "SecretPassword1!",
      name: "Login Test",
    });
    await userRepo.update(registered.user.id, { isEmailVerified: true });

    const loginResult = await loginUseCase.execute({
      email: "login@jobscout.com",
      password: "SecretPassword1!",
    });

    assert.ok(loginResult.tokens.accessToken);

    await assert.rejects(
      async () => {
        await loginUseCase.execute({
          email: "login@jobscout.com",
          password: "WrongPassword999!",
        });
      },
      (err) => {
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, "UNAUTHORIZED");
        return true;
      },
    );
  });

  it("should rotate refresh tokens and detect reuse", async () => {
    const userRepo = new MongooseUserRepository();
    const hasher = new BcryptPasswordHasher();
    const tokens = new JwtTokenService();
    const registerUseCase = new RegisterUserUseCase(userRepo, hasher, tokens);
    const refreshUseCase = new RefreshTokenUseCase(userRepo, tokens);

    const reg = await registerUseCase.execute({
      email: "rotate@jobscout.com",
      password: "RotatePassword1!",
      name: "Token Rotator",
    });

    const rotated = await refreshUseCase.execute({
      refreshToken: reg.tokens.refreshToken,
    });

    assert.ok(rotated.accessToken);
    assert.ok(rotated.refreshToken);
    assert.notEqual(rotated.refreshToken, reg.tokens.refreshToken);

    // Old token replay should be rejected
    await assert.rejects(
      async () => {
        await refreshUseCase.execute({
          refreshToken: reg.tokens.refreshToken,
        });
      },
      (err) => {
        assert.equal(err.statusCode, 401);
        return true;
      },
    );
  });

  it("should create application, retrieve by user, and update status", async () => {
    const appRepo = new MongooseApplicationRepository();
    const createUseCase = new CreateApplicationUseCase(appRepo);
    const getUseCase = new GetApplicationsUseCase(appRepo);
    const updateUseCase = new UpdateApplicationStatusUseCase(appRepo);

    const created = await createUseCase.execute({
      userId: "usr_clean_arch_1",
      company: "Acme Corp",
      role: "Lead Platform Engineer",
      priority: "high",
    });

    assert.ok(created.id);
    assert.equal(created.companyName, "Acme Corp");
    assert.equal(created.status, "saved");

    const userApps = await getUseCase.execute({ userId: "usr_clean_arch_1" });
    assert.equal(userApps.length, 1);
    assert.equal(userApps[0].id, created.id);

    const updated = await updateUseCase.execute({
      id: created.id,
      userId: "usr_clean_arch_1",
      status: "interviewing",
      note: "Passed initial technical screening",
    });

    assert.equal(updated.status, "interviewing");
  });
  it("should reject duplicate application with ConflictError", async () => {
    const appRepo = new MongooseApplicationRepository();
    const createUseCase = new CreateApplicationUseCase(appRepo);

    await createUseCase.execute({
      userId: "usr_dup_test_1",
      jobId: "job_xyz_1",
      company: "Google",
      role: "Software Engineer",
      priority: "high",
    });

    // Duplicate by jobId
    await assert.rejects(
      async () => {
        await createUseCase.execute({
          userId: "usr_dup_test_1",
          jobId: "job_xyz_1",
          company: "Different Name",
          role: "Different Role",
        });
      },
      (err) => {
        assert.equal(err.name, "ConflictError");
        assert.equal(err.statusCode, 409);
        return true;
      },
    );

    // Duplicate by company and role (case-insensitive)
    await assert.rejects(
      async () => {
        await createUseCase.execute({
          userId: "usr_dup_test_1",
          company: "  google  ",
          role: "software engineer",
        });
      },
      (err) => {
        assert.equal(err.name, "ConflictError");
        assert.equal(err.statusCode, 409);
        return true;
      },
    );
  });

  it("should upsert and retrieve user profile", async () => {
    const profRepo = new MongooseProfileRepository();
    const upsertUseCase = new UpsertProfileUseCase(profRepo);
    const getUseCase = new GetProfileUseCase(profRepo);

    const upserted = await upsertUseCase.execute({
      userId: "usr_prof_clean_1",
      skills: ["TypeScript", "NestJS", "Clean Architecture"],
      preferences: { remotePreference: "remote" },
    });

    assert.ok(upserted.id);
    assert.deepEqual(upserted.skills, ["TypeScript", "NestJS", "Clean Architecture"]);

    const retrieved = await getUseCase.execute({ userId: "usr_prof_clean_1" });
    assert.equal(retrieved.userId, "usr_prof_clean_1");
    assert.equal(retrieved.skills.length, 3);
  });
});
