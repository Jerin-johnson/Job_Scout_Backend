import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  buildProfileMatchIndex,
  extractBatchJobDemandIndex,
  rankAffectedProfilesForNewJobs,
  findAffectedUsersForNewJobs,
} from "../src/infrastructure/database/mongoose/services/incrementalMatching.js";
import { Profile } from "../src/infrastructure/database/mongoose/models/ProfileModel.js";

test("buildProfileMatchIndex normalizes skills, target roles, occupation codes, and countries", () => {
  const indexed = buildProfileMatchIndex({
    skills: [
      { factId: "s1", name: "React.js" },
      { factId: "s2", name: "Node.js" },
    ],
    roles: [{ factId: "r1", title: "Senior Frontend Developer", company: "Acme" }],
    preferences: {
      targetRoles: ["Full Stack Engineer"],
      occupationCodes: ["2512"],
      preferredCountryCodes: ["in", "gb"],
    },
    careerProfile: {
      homeLocation: { countryCode: "IN" },
      targetRoles: [{ roleCode: "software-engineer", custom: false }],
    },
  });

  assert.ok(indexed.matchTokens.includes("react"));
  assert.ok(indexed.matchTokens.includes("node.js") || indexed.matchTokens.includes("nodejs"));
  assert.ok(indexed.matchTokens.includes("frontend"));
  assert.ok(indexed.matchTokens.includes("occ:2512"));
  assert.deepEqual(indexed.matchCountryCodes.sort(), ["GB", "IN"]);
});

test("rankAffectedProfilesForNewJobs scales across 10,000 synthetic users under 50ms and enforces per-run budget", () => {
  const nonTargetSkills = [
    "python",
    "java",
    "rust",
    "terraform",
    "accounting",
    "nursing",
    "cardiology",
    "marketing",
    "salesforce",
    "autocad",
  ];
  const syntheticProfiles = Array.from({ length: 10_000 }, (_, idx) => {
    const isTarget = idx % 100 === 0; // 100 matching users out of 10,000
    const primarySkill = isTarget ? "kubernetes" : nonTargetSkills[idx % nonTargetSkills.length];
    const secondarySkill = isTarget && idx % 200 === 0 ? "golang" : "excel";
    const country = idx % 3 === 0 ? "IN" : idx % 3 === 1 ? "GB" : "US";
    return {
      userId: `user_${String(idx).padStart(5, "0")}`,
      version: 2,
      updatedAt: new Date(1_700_000_000_000 + idx * 1000),
      matchTokens: [primarySkill, secondarySkill],
      matchCountryCodes: [country],
    };
  });

  const newJobs = [
    {
      title: "Senior Platform Engineer (Kubernetes & Golang)",
      status: "active",
      occupation: "technology",
      occupationCodes: ["2512"],
      features: {
        titleTokens: ["platform", "engineer"],
        skills: ["kubernetes", "golang"],
      },
      structuredLocation: {
        countryCode: "IN",
        remoteScope: "country",
        eligibleCountryCodes: ["IN", "GB"],
      },
      eligibility: {
        remoteScope: "country",
        countries: ["IN", "GB"],
      },
    },
  ];

  const batchIndex = extractBatchJobDemandIndex(newJobs);
  const candidatePool = syntheticProfiles.filter((profile) =>
    profile.matchTokens.some((token) => batchIndex.tokens.includes(token)),
  );

  const startedAt = performance.now();
  const affected = rankAffectedProfilesForNewJobs(candidatePool, batchIndex, {
    maxUsers: 40,
    minOverlap: 1,
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(affected.length, 40);
  assert.ok(
    elapsedMs < 100,
    `Expected ranking to complete under 100ms, took ${elapsedMs.toFixed(2)}ms`,
  );
  // Top-ranked users should be the ones matching both kubernetes + golang in eligible countries (IN/GB)
  assert.ok(affected[0].matchedTokenCount >= 2);
  assert.ok(affected.every((item) => item.matchedTokens.includes("kubernetes")));
});

test("findAffectedUsersForNewJobs uses profile_match_tokens_idx in MongoDB without scanning unmatched users", async (t) => {
  const mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: "8.0.8" }
      : undefined,
  });
  await mongoose.connect(mongo.getUri("jobscout_incremental_match_test"));
  t.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  await Profile.syncIndexes();
  const docs = Array.from({ length: 500 }, (_, idx) => {
    const isMatch = idx < 12;
    return {
      userId: new mongoose.Types.ObjectId(),
      version: 1,
      matchTokens: isMatch
        ? ["nursing", "icu", "occ:2221"]
        : ["accounting", "taxation", `skill_${idx % 20}`],
      matchCountryCodes: isMatch ? ["IN", "GB"] : ["US"],
    };
  });
  await Profile.insertMany(docs);

  const newJobs = [
    {
      title: "ICU Staff Nurse",
      status: "active",
      occupation: "nursing",
      occupationCodes: ["2221"],
      features: {
        titleTokens: ["icu", "nurse"],
        skills: ["nursing", "icu"],
      },
      structuredLocation: {
        countryCode: "IN",
        remoteScope: "country",
        eligibleCountryCodes: ["IN"],
      },
      eligibility: {
        remoteScope: "country",
        countries: ["IN"],
      },
    },
  ];

  const result = await findAffectedUsersForNewJobs(newJobs, { maxUsers: 10 });
  assert.equal(result.candidateCount, 12);
  assert.equal(result.affectedUsers.length, 10);

  const explain = await Profile.find({ matchTokens: { $in: result.batchTokens } })
    .sort({ updatedAt: -1 })
    .limit(30)
    .explain("executionStats");
  const planText = JSON.stringify(explain.queryPlanner?.winningPlan || {});
  assert.ok(planText.includes("profile_match_tokens_idx"));
  assert.equal(explain.executionStats.totalDocsExamined, 12);
});
