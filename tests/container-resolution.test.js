import "reflect-metadata";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Phase 5: TSyringe Container & Infrastructure Adapters", () => {
  it("should resolve all repositories, services, and use cases from the DI container", async () => {
    const { appContainer, TOKENS } = await import("../dist/src/main/container.js");

    // Verify Repositories
    const userRepo = appContainer.resolve(TOKENS.UserRepository);
    const profileRepo = appContainer.resolve(TOKENS.ProfileRepository);
    const appRepo = appContainer.resolve(TOKENS.ApplicationRepository);

    assert.ok(userRepo, "UserRepository must resolve");
    assert.ok(profileRepo, "ProfileRepository must resolve");
    assert.ok(appRepo, "ApplicationRepository must resolve");

    // Verify Security & Infrastructure Adapters
    const hasher = appContainer.resolve(TOKENS.PasswordHasher);
    const tokenService = appContainer.resolve(TOKENS.TokenService);
    const storageService = appContainer.resolve(TOKENS.StorageService);
    const emailService = appContainer.resolve(TOKENS.EmailService);

    assert.ok(hasher, "PasswordHasher must resolve");
    assert.ok(tokenService, "TokenService must resolve");
    assert.ok(storageService, "StorageService must resolve");
    assert.ok(emailService, "EmailService must resolve");

    // Verify Use Cases with injected dependencies
    const registerUseCase = appContainer.resolve(TOKENS.RegisterUserUseCase);
    const loginUseCase = appContainer.resolve(TOKENS.LoginUserUseCase);
    const refreshUseCase = appContainer.resolve(TOKENS.RefreshTokenUseCase);
    const getAppsUseCase = appContainer.resolve(TOKENS.GetApplicationsUseCase);
    const createAppsUseCase = appContainer.resolve(TOKENS.CreateApplicationUseCase);
    const updateAppStatusUseCase = appContainer.resolve(TOKENS.UpdateApplicationStatusUseCase);
    const getProfileUseCase = appContainer.resolve(TOKENS.GetProfileUseCase);
    const upsertProfileUseCase = appContainer.resolve(TOKENS.UpsertProfileUseCase);

    assert.ok(registerUseCase, "RegisterUserUseCase must resolve");
    assert.ok(loginUseCase, "LoginUserUseCase must resolve");
    assert.ok(refreshUseCase, "RefreshTokenUseCase must resolve");
    assert.ok(getAppsUseCase, "GetApplicationsUseCase must resolve");
    assert.ok(createAppsUseCase, "CreateApplicationUseCase must resolve");
    assert.ok(updateAppStatusUseCase, "UpdateApplicationStatusUseCase must resolve");
    assert.ok(getProfileUseCase, "GetProfileUseCase must resolve");
    assert.ok(upsertProfileUseCase, "UpsertProfileUseCase must resolve");
  });

  it("should execute an end-to-end user registration and profile creation via resolved use cases", async () => {
    const { appContainer, TOKENS } = await import("../dist/src/main/container.js");

    const registerUseCase = appContainer.resolve(TOKENS.RegisterUserUseCase);
    const upsertProfileUseCase = appContainer.resolve(TOKENS.UpsertProfileUseCase);
    const getProfileUseCase = appContainer.resolve(TOKENS.GetProfileUseCase);

    const regResult = await registerUseCase.execute({
      email: "di_container_test@jobscout.com",
      password: "TestPassword123!",
      name: "DI Container User",
    });

    assert.ok(regResult.user.id);
    assert.equal(regResult.user.email, "di_container_test@jobscout.com");

    const profileResult = await upsertProfileUseCase.execute({
      userId: regResult.user.id,
      skills: ["TypeScript", "TSyringe", "Express"],
      preferences: { remotePreference: "remote" },
    });

    assert.ok(profileResult.id);
    assert.equal(profileResult.userId, regResult.user.id);

    const retrieved = await getProfileUseCase.execute({
      userId: regResult.user.id,
    });
    assert.equal(retrieved.userId, regResult.user.id);
    assert.deepEqual(retrieved.skills, ["TypeScript", "TSyringe", "Express"]);
  });
});
