import "reflect-metadata";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("Phase 3: Database Models, Mappers & Repositories", () => {
  let MongooseUserRepository;
  let MongooseProfileRepository;
  let MongooseApplicationRepository;
  let UserMapper;
  let ProfileMapper;
  let ApplicationMapper;

  beforeEach(async () => {
    const userRepoModule =
      await import("../dist/src/infrastructure/database/mongoose/repositories/MongooseUserRepository.js");
    const profileRepoModule =
      await import("../dist/src/infrastructure/database/mongoose/repositories/MongooseProfileRepository.js");
    const appRepoModule =
      await import("../dist/src/infrastructure/database/mongoose/repositories/MongooseApplicationRepository.js");
    const userMapperModule =
      await import("../dist/src/infrastructure/database/mongoose/mappers/UserMapper.js");
    const profileMapperModule =
      await import("../dist/src/infrastructure/database/mongoose/mappers/ProfileMapper.js");
    const appMapperModule =
      await import("../dist/src/infrastructure/database/mongoose/mappers/ApplicationMapper.js");

    MongooseUserRepository = userRepoModule.MongooseUserRepository;
    MongooseProfileRepository = profileRepoModule.MongooseProfileRepository;
    MongooseApplicationRepository = appRepoModule.MongooseApplicationRepository;
    UserMapper = userMapperModule.UserMapper;
    ProfileMapper = profileMapperModule.ProfileMapper;
    ApplicationMapper = appMapperModule.ApplicationMapper;
  });

  it("should map User document to domain entity and persistence accurately", () => {
    const raw = {
      _id: "usr_mock_1",
      email: "engineer@test.com",
      name: "Test Engineer",
      plan: "pro",
      role: "user",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const entity = UserMapper.toEntity(raw);
    assert.equal(entity.id, "usr_mock_1");
    assert.equal(entity.email, "engineer@test.com");
    assert.equal(entity.plan, "pro");

    const persistence = UserMapper.toPersistence(entity);
    assert.equal(persistence._id, "usr_mock_1");
    assert.equal(persistence.id, undefined);
  });

  it("should map Profile and Application documents accurately", () => {
    const rawProfile = {
      _id: "prof_1",
      userId: "usr_1",
      skills: [{ name: "TypeScript" }, "Node.js"],
      roles: [{ title: "Backend Engineer", company: "JobScout" }],
      preferences: { remoteOnly: true },
    };
    const profileEntity = ProfileMapper.toEntity(rawProfile);
    assert.equal(profileEntity.userId, "usr_1");
    assert.deepEqual(profileEntity.skills, ["TypeScript", "Node.js"]);
    assert.equal(profileEntity.roles[0].title, "Backend Engineer");

    const rawApp = {
      _id: "app_1",
      userId: "usr_1",
      company: "Stripe",
      role: "Staff Engineer",
      status: "applied",
    };
    const appEntity = ApplicationMapper.toEntity(rawApp);
    assert.equal(appEntity.companyName, "Stripe");
    assert.equal(appEntity.jobTitle, "Staff Engineer");
    assert.equal(appEntity.status, "applied");
  });

  it("should create, find, and update users in MongooseUserRepository with fallback", async () => {
    const repo = new MongooseUserRepository();

    const created = await repo.create({
      email: "dev@domain.com",
      name: "Developer",
      plan: "free",
    });

    assert.ok(created.id);
    assert.equal(created.email, "dev@domain.com");

    const foundByEmail = await repo.findByEmail("dev@domain.com");
    assert.ok(foundByEmail);
    assert.equal(foundByEmail.id, created.id);

    const foundById = await repo.findById(created.id);
    assert.ok(foundById);
    assert.equal(foundById.email, "dev@domain.com");

    const updated = await repo.update(created.id, { name: "Updated Dev" });
    assert.ok(updated);
    assert.equal(updated.name, "Updated Dev");

    await repo.recordFailedLogin(created.id, 0);
    const locked = await repo.findById(created.id);
    assert.equal(locked.failedLoginAttempts, 1);

    await repo.resetFailedLogins(created.id);
    const reset = await repo.findById(created.id);
    assert.equal(reset.failedLoginAttempts, 0);

    const deleted = await repo.delete(created.id);
    assert.equal(deleted, true);
    const afterDelete = await repo.findById(created.id);
    assert.equal(afterDelete, null);
  });

  it("should upsert and find profile in MongooseProfileRepository", async () => {
    const repo = new MongooseProfileRepository();
    const userId = "usr_prof_test_1";

    const profile = await repo.upsertProfile(userId, {
      skills: ["Go", "Kubernetes"],
      preferences: { remoteOnly: true },
    });

    assert.ok(profile);
    assert.equal(profile.userId, userId);

    const found = await repo.findByUserId(userId);
    assert.ok(found);
    assert.equal(found.userId, userId);
  });

  it("should create, find owned, and filter applications in MongooseApplicationRepository", async () => {
    const repo = new MongooseApplicationRepository();
    const userId = "usr_app_test_1";

    const created = await repo.create({
      userId,
      companyName: "Google",
      jobTitle: "Software Engineer",
      status: "applied",
      priority: "high",
    });

    assert.ok(created.id);
    assert.equal(created.companyName, "Google");

    const owned = await repo.findOwnedById(created.id, userId);
    assert.ok(owned);
    assert.equal(owned.companyName, "Google");

    const notOwned = await repo.findOwnedById(created.id, "wrong_user");
    assert.equal(notOwned, null);

    const list = await repo.findByUserId(userId, { priority: "high" });
    assert.equal(list.length, 1);
  });
});
