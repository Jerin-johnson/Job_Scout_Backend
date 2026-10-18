import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../src/models/User.js";
import { Resume } from "../src/models/Resume.js";
import { Profile } from "../src/models/Profile.js";
import { Job } from "../src/models/Job.js";
import { JobMatchReport } from "../src/models/JobMatchReport.js";
import { Document } from "../src/models/Document.js";
import { Application } from "../src/models/Application.js";
import { encryptText, computeSha256 } from "../src/shared/utils/crypto.js";
import { resumeMatchController } from "../src/controllers/resumeMatchController.js";
import { privacyController } from "../src/controllers/privacyController.js";
import { profileController } from "../src/controllers/profileController.js";
import { storageService } from "../src/services/storageService.js";

function response() {
  return {
    statusCode: null, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
  };
}

async function startMongo(t, dbName) {
  // The OS temp directory may be permission-restricted in sandboxed Windows
  // runners. Keep this disposable Mongo data directory inside the repo and
  // always remove it when the test finishes.
  const testDir = await mkdtemp(path.join(process.cwd(), ".mongo-resume-match-"));
  const dbPath = path.join(testDir, "db");
  await mkdir(dbPath);
  const mongo = await MongoMemoryServer.create({ instance: { dbPath } });
  await mongoose.connect(mongo.getUri(), { dbName });
  t.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
    await rm(testDir, { recursive: true, force: true });
  });
  return mongo;
}

test("resume match reports are idempotent, owner-scoped, exportable, and cascaded on deletion", async (t) => {
  await startMongo(t, "resume-match-integration");
  await Promise.all([User.syncIndexes(), Resume.syncIndexes(), Profile.syncIndexes(), Job.syncIndexes(), JobMatchReport.syncIndexes(), Document.syncIndexes(), Application.syncIndexes()]);

  const owner = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  const consent = { acceptedAt: new Date(), version: "resume-ai-processing-v1" };
  await User.create([
    { _id: owner, email: "match-owner@example.test", resumeAiConsent: consent },
    { _id: other, email: "match-other@example.test", resumeAiConsent: consent },
  ]);
  await Profile.create({ userId: owner, roles: [{ factId: "role-1", title: "Backend Engineer", company: "Acme", startDate: "2021", endDate: "2025", achievements: [{ factId: "achievement-1", bullet: "Built Python APIs serving 20 customers" }] }], skills: [{ factId: "skill-1", name: "Python" }], education: [{ factId: "edu-1", degree: "Bachelor" }] });
  const rawText = "Jordan Smith jordan@example.com +1 415 555 0199 SUMMARY Backend Engineer EXPERIENCE Backend Engineer at Acme 2021 - 2025 Built Python APIs serving 20 customers EDUCATION Bachelor SKILLS Python";
  const resume = await Resume.create({ userId: owner, fileHash: computeSha256(rawText), originalFilename: "resume.pdf", mimeType: "application/pdf", s3Key: `resumes/${owner}/resume.pdf`, encryptedRawText: encryptText(rawText), factsSummary: { roles: 1, skills: 1, education: 1, totalFacts: 3 } });
  const job = await Job.create({ contentHash: "resume-match-test-job", title: "Backend Engineer", company: "Target Co", rawDescription: "Required: Python and SQL. Bachelor degree. 3 years experience.", requirements: ["Python", "SQL", "Bachelor degree", "3 years experience"], tags: ["Python", "SQL"], sourceBoard: "test", status: "active", expiresAt: new Date(Date.now() + 86400000) });

  const request = (userId, id) => ({ user: { _id: userId, id: userId.toString(), plan: "free" }, body: { resumeId: resume._id.toString(), job: { type: "catalog", jobId: job._id.toString() } }, params: { id }, id: "resume-match-test-request" });
  const first = response();
  await resumeMatchController.createOrFetch(request(owner), first, (error) => { throw error; });
  assert.equal(first.statusCode, 201);
  assert.ok(first.body.data.report.match.score >= 0);
  assert.equal(first.body.data.report.atsReadiness.checks.length, 15);

  const retry = response();
  await resumeMatchController.createOrFetch(request(owner), retry, (error) => { throw error; });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.data.cacheHit, true);
  assert.equal(await JobMatchReport.countDocuments({ userId: owner }), 1);
  assert.equal(await JobMatchReport.collection.indexes().then((indexes) => indexes.some((index) => index.name === "job_match_report_idempotency")), true);

  const foreignRead = response();
  await resumeMatchController.get(request(other, first.body.data.report.reportId), foreignRead, (error) => { throw error; });
  assert.equal(foreignRead.statusCode, 404);
  const foreignDelete = response();
  await resumeMatchController.remove(request(other, first.body.data.report.reportId), foreignDelete, (error) => { throw error; });
  assert.equal(foreignDelete.statusCode, 404);

  const ignored = response();
  await resumeMatchController.ignoreKeywords({ ...request(owner, first.body.data.report.reportId), body: { keyword: "Python", ignored: true } }, ignored, (error) => { throw error; });
  assert.equal(ignored.statusCode, 200);
  assert.ok(Object.values(ignored.body.data.report.match.groups).flat().some((item) => item.term.toLowerCase() === "python" && item.ignored));

  const exportResponse = response();
  await privacyController.exportData({ user: { _id: owner, id: owner.toString(), email: "match-owner@example.test" } }, exportResponse, (error) => { throw error; });
  assert.equal(exportResponse.statusCode, 200);
  assert.equal(exportResponse.body.data.resumes.length, 1);
  assert.equal(exportResponse.body.data.resumes[0].encryptedRawText, undefined);
  assert.equal(exportResponse.body.data.jobMatchReports.length, 1);

  const unignored = response();
  await resumeMatchController.ignoreKeywords({ ...request(owner, first.body.data.report.reportId), body: { keyword: "Python", ignored: false } }, unignored, (error) => { throw error; });
  assert.equal(unignored.statusCode, 200);
  assert.ok(Object.values(unignored.body.data.report.match.groups).flat().some((item) => item.term.toLowerCase() === "python" && !item.ignored));
  const reportDelete = response();
  await resumeMatchController.remove(request(owner, first.body.data.report.reportId), reportDelete, (error) => { throw error; });
  assert.equal(reportDelete.statusCode, 200);
  assert.equal(reportDelete.body.data.deleted, true);
  assert.equal(await JobMatchReport.countDocuments({ userId: owner }), 0);

  const originalDelete = storageService.deleteFile;
  const deletedKeys = [];
  storageService.deleteFile = async ({ key }) => { deletedKeys.push(key); };
  try {
    const deleteResponse = response();
    await privacyController.deleteAccount({ user: { _id: owner, id: owner.toString() } }, deleteResponse, (error) => { throw error; });
    assert.equal(deleteResponse.statusCode, 200);
    assert.deepEqual(deletedKeys, [resume.s3Key]);
    assert.equal(await Resume.countDocuments({ userId: owner }), 0);
    assert.equal(await JobMatchReport.countDocuments({ userId: owner }), 0);
    assert.equal(await Profile.countDocuments({ userId: owner }), 0);
    assert.equal(await Document.countDocuments({ userId: owner }), 0);
    assert.equal(await Application.countDocuments({ userId: owner }), 0);
  } finally { storageService.deleteFile = originalDelete; }
});

test("resume deletion endpoint returns 404 for another user's resume and deletes only owned records", async (t) => {
  await startMongo(t, "resume-delete-owner-integration");
  await Promise.all([Resume.syncIndexes(), Profile.syncIndexes(), JobMatchReport.syncIndexes(), User.syncIndexes()]);
  const owner = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  await User.create([{ _id: owner, email: "resume-delete-owner@example.test" }, { _id: other, email: "resume-delete-other@example.test" }]);
  const resume = await Resume.create({ userId: owner, fileHash: "resume-delete-hash", originalFilename: "resume.pdf", mimeType: "application/pdf", s3Key: `resumes/${owner}/resume.pdf`, encryptedRawText: encryptText("Private resume text"), parsedFactsCount: 0 });
  await JobMatchReport.create({ userId: owner, resumeId: resume._id, resumeHash: resume.fileHash, jobKey: "pasted:test", scoreVersion: "resume-match-v1", job: { type: "pasted", title: "Engineer", contentHash: "hash" }, deterministicResult: { match: { score: 0 } } });
  const originalDelete = storageService.deleteFile;
  storageService.deleteFile = async () => {};
  try {
    const foreign = response();
    await profileController.deleteResume({ user: { _id: other, id: other.toString() }, params: { id: resume._id.toString() } }, foreign, (error) => { throw error; });
    assert.equal(foreign.statusCode, 404);
    assert.equal(await Resume.countDocuments({ _id: resume._id }), 1);
    const owned = response();
    await profileController.deleteResume({ user: { _id: owner, id: owner.toString() }, params: { id: resume._id.toString() } }, owned, (error) => { throw error; });
    assert.equal(owned.statusCode, 204);
    assert.equal(await Resume.countDocuments({ _id: resume._id }), 0);
    assert.equal(await JobMatchReport.countDocuments({ userId: owner, resumeId: resume._id }), 0);
  } finally { storageService.deleteFile = originalDelete; }
});
