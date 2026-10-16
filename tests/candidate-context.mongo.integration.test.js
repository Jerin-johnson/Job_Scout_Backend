import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Application } from "../src/models/Application.js";
import { InterviewReport } from "../src/models/InterviewReport.js";
import { InterviewSession } from "../src/models/InterviewSession.js";
import { Profile } from "../src/models/Profile.js";
import { Resume } from "../src/models/Resume.js";
import { User } from "../src/models/User.js";
import { getCandidateContext, invalidateCandidateContext } from "../src/ai/candidateContext.js";

let mongo;
let mongoDataPath;

before(async () => {
  mongoDataPath = mkdtempSync(join(process.cwd(), ".mongo-chat-context-test-"));
  mongo = await MongoMemoryServer.create({
    instance: { storageEngine: "wiredTiger", dbPath: mongoDataPath },
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: "8.0.8" }
      : undefined,
  });
  await mongoose.connect(mongo.getUri(), { dbName: "chat-context-integration" });
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  if (mongoDataPath) rmSync(mongoDataPath, { recursive: true, force: true });
});

test("Mongo-backed candidate context joins the authenticated user's profile, counts, resume, and latest interview score", async () => {
  const [userA, userB] = await User.create([
    { email: `context-a-${Date.now()}@example.test`, name: "Account Name", preferredName: "Jerin", plan: "premium" },
    { email: `context-b-${Date.now()}@example.test`, name: "Other User", plan: "free" },
  ]);
  await Profile.create({
    userId: userA._id,
    roles: [{ factId: "role1", title: "Staff Engineer", company: "Acme", startDate: "2020-01", isCurrent: true }],
    skills: [{ factId: "skill1", name: "TypeScript", proficiencyYears: 5 }],
    preferences: { targetRoles: ["Principal Engineer"], preferredLocations: ["Remote"] },
  });
  await Resume.create({
    userId: userA._id,
    fileHash: `hash-${userA.id}`,
    originalFilename: "resume.pdf",
    mimeType: "application/pdf",
    s3Key: "private/resume",
    encryptedRawText: { cipherText: "cipher", iv: "iv", tag: "tag", keyVersion: "v1" },
  });
  await Application.create([
    { userId: userA._id, jobId: "a1", company: "Acme", role: "Engineer", status: "applied", nextFollowUpAt: new Date(Date.now() - 60_000) },
    { userId: userA._id, jobId: "a2", company: "Beta", role: "Engineer", status: "saved" },
    { userId: userB._id, jobId: "b1", company: "Other", role: "Engineer", status: "applied", nextFollowUpAt: new Date(Date.now() - 60_000) },
  ]);
  const interview = await InterviewSession.create({
    userId: userA._id,
    resumeId: (await Resume.findOne({ userId: userA._id }))._id,
    role: "Staff Engineer",
    level: "senior",
    mode: "technical",
    durationMinutes: 10,
    status: "completed",
    consent: { acceptedAt: new Date(), version: "test-v1" },
    tokenCap: 2000,
    completedAt: new Date(),
  });
  await InterviewReport.create({ interviewId: interview._id, userId: userA._id, report: { overallScore: 87 }, schemaVersion: "test-v1" });

  await invalidateCandidateContext(userA.id);
  const contextA = await getCandidateContext(userA);
  assert.equal(contextA.card.preferredName, "Jerin");
  assert.match(contextA.card.currentRole, /Staff Engineer at Acme/);
  assert.deepEqual(contextA.card.targetRoles, ["Principal Engineer"]);
  assert.deepEqual(contextA.card.skills, ["TypeScript"]);
  assert.equal(contextA.card.activeApplications, 2);
  assert.equal(contextA.card.followUpsDue, 1);
  assert.equal(contextA.card.hasResume, true);
  assert.equal(contextA.card.lastInterviewScore, 87);

  await invalidateCandidateContext(userB.id);
  const contextB = await getCandidateContext(userB);
  assert.equal(contextB.card.activeApplications, 1);
  assert.equal(contextB.card.followUpsDue, 1);
  assert.equal(contextB.card.preferredName, "Other User");
});
