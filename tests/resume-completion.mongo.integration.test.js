import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Profile } from "../src/models/Profile.js";
import { Resume } from "../src/models/Resume.js";
import { profileController } from "../src/controllers/profileController.js";
import { storageService } from "../src/services/storageService.js";
import { textExtractionService } from "../src/services/textExtractionService.js";
import { resumeParserService } from "../src/services/resumeParserService.js";
import { profileRepository } from "../src/repositories/profileRepository.js";

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("resume completion retry is idempotent and another user's upload ID returns 404 in MongoDB", async (t) => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: "resume-completion-integration" });
  t.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  await Promise.all([Resume.syncIndexes(), Profile.syncIndexes()]);
  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();
  const uploadId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  const foreignKey = `resumes/${userB}/${uploadId}.pdf`;
  const originalMetadata = storageService.getObjectMetadata;
  const originalGetFile = storageService.getFile;
  const originalExtractPdf = textExtractionService.extractPdf;
  const originalParseResume = resumeParserService.parseResume;
  const pdf = Buffer.from(`%PDF-1.4 ${"source text ".repeat(20)}`);
  let parseCalls = 0;
  storageService.getObjectMetadata = async ({ key }) => {
    if (key !== foreignKey) {
      const missing = new Error("missing object");
      missing.statusCode = 404;
      missing.code = "RESUME_UPLOAD_NOT_FOUND";
      throw missing;
    }
    return { contentLength: pdf.length, contentType: "application/pdf", etag: "test-etag" };
  };
  storageService.getFile = async () => pdf;
  textExtractionService.extractPdf = async () => "Grounded resume content with enough selectable text for processing.";
  resumeParserService.parseResume = async ({ userId: parsedUserId, storedS3Key }) => {
    parseCalls += 1;
    const factsSummary = { skills: 2, roles: 1, education: 0, totalFacts: 3 };
    const resume = await profileRepository.createResume({
      userId: parsedUserId,
      fileHash: "test-hash",
      originalFilename: "resume.pdf",
      mimeType: "application/pdf",
      s3Key: storedS3Key,
      encryptedRawText: { cipherText: "ciphertext", iv: "iv", tag: "tag", keyVersion: "test" },
      parsedFactsCount: factsSummary.totalFacts,
      factsSummary,
    });
    const profile = await profileRepository.upsertProfile(parsedUserId, {
      roles: [], skills: [], education: [],
    });
    return {
      profile,
      resume,
      factsSummary,
    };
  };
  t.after(() => {
    storageService.getObjectMetadata = originalMetadata;
    storageService.getFile = originalGetFile;
    textExtractionService.extractPdf = originalExtractPdf;
    resumeParserService.parseResume = originalParseResume;
  });

  const userBRequest = {
    user: { id: userB.toString(), plan: "free" },
    body: { uploadId, originalFilename: "resume.pdf", mimeType: "application/pdf" },
    id: "resume-retry-test",
    get: () => `resume-${uploadId}`,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = response();
    let error;
    await profileController.completeResumeUpload(userBRequest, res, (value) => { error = value; });
    assert.equal(error, undefined);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.message, attempt === 0 ? "Resume successfully parsed and encrypted" : "Resume upload was already processed");
    assert.equal(res.body.data.resume.factsSummary.totalFacts, 3);
  }
  assert.equal(parseCalls, 1, "a completed retry does not re-parse the resume");
  assert.equal(await Resume.countDocuments({ userId: userB }), 1, "retries keep one resume record");

  let requestedKey;
  storageService.getObjectMetadata = async ({ key }) => {
    requestedKey = key;
    const missing = new Error("missing object");
    missing.statusCode = 404;
    missing.code = "RESUME_UPLOAD_NOT_FOUND";
    throw missing;
  };
  try {
    const res = response();
    let error;
    await profileController.completeResumeUpload(
      { user: { id: userA.toString() }, body: userBRequest.body },
      res,
      (value) => { error = value; },
    );
    assert.equal(requestedKey, `resumes/${userA}/${uploadId}.pdf`);
    assert.equal(error?.statusCode, 404);
    assert.equal(error?.code, "RESUME_UPLOAD_NOT_FOUND");
    assert.equal(await Resume.countDocuments({ userId: userB }), 1);
  } finally {
    storageService.getObjectMetadata = originalMetadata;
  }
});
