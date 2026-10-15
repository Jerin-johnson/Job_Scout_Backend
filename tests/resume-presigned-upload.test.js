import test from "node:test";
import assert from "node:assert/strict";
import { profileController } from "../src/controllers/profileController.js";
import { profileRepository } from "../src/repositories/profileRepository.js";
import { storageService } from "../src/services/storageService.js";

function mockResponse() {
  return {
    statusCode: null,
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

test("presign creates a short-lived user-scoped key and signs only the validated content type", async () => {
  const original = storageService.createPresignedUpload;
  let signedInput;
  storageService.createPresignedUpload = async (input) => {
    signedInput = input;
    return {
      uploadUrl: "https://s3.example.test/presigned",
      requiredHeaders: { "Content-Type": input.contentType },
    };
  };
  try {
    const req = {
      user: { _id: { toString: () => "user-123" } },
      body: {
        originalFilename: "resume.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
      },
    };
    const res = mockResponse();
    let nextError;
    await profileController.createResumeUploadUrl(req, res, (error) => (nextError = error));

    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 200);
    assert.match(signedInput.key, /^resumes\/user-123\/[0-9a-f-]+\.pdf$/i);
    assert.equal(signedInput.contentType, "application/pdf");
    assert.equal(signedInput.expiresInSeconds, 300);
    assert.equal(res.body.data.uploadId.length, 36);
  } finally {
    storageService.createPresignedUpload = original;
  }
});

test("presign rejects oversized files before requesting an S3 URL", async () => {
  const original = storageService.createPresignedUpload;
  storageService.createPresignedUpload = async () => {
    throw new Error("must not sign invalid uploads");
  };
  try {
    const req = {
      user: { id: "user-123" },
      body: {
        originalFilename: "resume.pdf",
        mimeType: "application/pdf",
        fileSize: 5 * 1024 * 1024 + 1,
      },
    };
    let nextError;
    await profileController.createResumeUploadUrl(req, mockResponse(), (error) => (nextError = error));
    assert.equal(nextError?.name, "ZodError");
  } finally {
    storageService.createPresignedUpload = original;
  }
});

test("completing a previously processed upload is idempotent and scoped to the authenticated user", async () => {
  const findExistingOriginal = profileRepository.findResumeByS3KeyAndUserId;
  const findProfileOriginal = profileRepository.findByUserId;
  const metadataOriginal = storageService.getObjectMetadata;
  let queried;
  profileRepository.findResumeByS3KeyAndUserId = async (key, userId) => {
    queried = { key, userId };
    return { parsedFactsCount: 4 };
  };
  profileRepository.findByUserId = async () => ({ roles: [], skills: [], education: [] });
  storageService.getObjectMetadata = async () => {
    throw new Error("completed upload should not be processed twice");
  };
  try {
    const uploadId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const req = {
      user: { id: "user-123" },
      body: { uploadId, originalFilename: "resume.pdf", mimeType: "application/pdf" },
    };
    const res = mockResponse();
    let nextError;
    await profileController.completeResumeUpload(req, res, (error) => (nextError = error));

    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(queried, {
      key: `resumes/user-123/${uploadId}.pdf`,
      userId: "user-123",
    });
    assert.equal(res.body.data.message, "Resume upload was already processed");
  } finally {
    profileRepository.findResumeByS3KeyAndUserId = findExistingOriginal;
    profileRepository.findByUserId = findProfileOriginal;
    storageService.getObjectMetadata = metadataOriginal;
  }
});
