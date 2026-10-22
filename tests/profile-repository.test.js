import test from "node:test";
import assert from "node:assert/strict";
import { profileRepository } from "../src/infrastructure/database/mongoose/repositories/MongooseProfileRepository.js";

test("an empty extractor role result does not erase previously source-grounded history", async () => {
  const userId = "profile-role-preserve-test";
  const firstRole = {
    factId: "role_existing",
    title: "Staff Nurse",
    company: "North Hospital",
    achievements: [],
  };
  await profileRepository.upsertProfile(userId, { roles: [firstRole], skills: [] });
  const profile = await profileRepository.upsertProfile(userId, {
    roles: [],
    skills: [{ factId: "skill_1", name: "BLS" }],
  });
  assert.equal(profile.roles.length, 1);
  assert.equal(profile.roles[0].factId, "role_existing");
});

test("setActiveResume marks only the targeted resume active and returns active resume", async () => {
  const userId = "profile-active-resume-test";
  const r1 = await profileRepository.createResume({
    userId,
    s3Key: `resumes/${userId}/r1.pdf`,
    fileHash: "hash1",
    originalFilename: "resume1.pdf",
    isActive: true,
  });
  const r2 = await profileRepository.createResume({
    userId,
    s3Key: `resumes/${userId}/r2.pdf`,
    fileHash: "hash2",
    originalFilename: "resume2.pdf",
    isActive: false,
  });

  const activeBefore = await profileRepository.findActiveResumeByUserId(userId);
  assert.equal(activeBefore?.originalFilename, r1.originalFilename);

  await profileRepository.setActiveResume(r2._id || r2.id, userId);

  const activeAfter = await profileRepository.findActiveResumeByUserId(userId);
  assert.equal(activeAfter?.originalFilename, r2.originalFilename);
});
