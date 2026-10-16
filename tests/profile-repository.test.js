import test from "node:test";
import assert from "node:assert/strict";
import { profileRepository } from "../src/repositories/profileRepository.js";

test("an empty extractor role result does not erase previously source-grounded history", async () => {
  const userId = "profile-role-preserve-test";
  const firstRole = { factId: "role_existing", title: "Staff Nurse", company: "North Hospital", achievements: [] };
  await profileRepository.upsertProfile(userId, { roles: [firstRole], skills: [] });
  const profile = await profileRepository.upsertProfile(userId, { roles: [], skills: [{ factId: "skill_1", name: "BLS" }] });
  assert.equal(profile.roles.length, 1);
  assert.equal(profile.roles[0].factId, "role_existing");
});
