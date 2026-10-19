import test from "node:test";
import assert from "node:assert/strict";
import { profileController } from "../src/presentation/http/controllers/ProfileController.js";
import { userRepository } from "../src/infrastructure/database/mongoose/repositories/MongooseUserRepository.js";

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("resume AI consent is versioned and required before requesting an upload", async () => {
  const oldFind = userRepository.findById;
  const oldUpdate = userRepository.update;
  let record = { _id: "user-1", resumeAiConsent: null };
  userRepository.findById = async () => record;
  userRepository.update = async (_id, fields) => {
    record = { ...record, ...fields };
    return record;
  };
  try {
    const blocked = response();
    let error;
    await profileController.createResumeUploadUrl(
      {
        body: { originalFilename: "resume.pdf", mimeType: "application/pdf", fileSize: 100 },
        user: { id: "user-1" },
      },
      blocked,
      (nextError) => {
        error = nextError;
      },
    );
    assert.equal(error.code, "RESUME_AI_CONSENT_REQUIRED");

    const consent = response();
    await profileController.acceptResumeAiConsent(
      { body: { accepted: true, version: "resume-ai-processing-v1" }, user: { id: "user-1" } },
      consent,
      (nextError) => {
        throw nextError;
      },
    );
    assert.equal(consent.body.data.accepted, true);
    assert.equal(record.resumeAiConsent.version, "resume-ai-processing-v1");
    assert.ok(record.resumeAiConsent.acceptedAt instanceof Date);
  } finally {
    userRepository.findById = oldFind;
    userRepository.update = oldUpdate;
  }
});
