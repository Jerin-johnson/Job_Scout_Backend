import test from "node:test";
import assert from "node:assert/strict";
import { createS3ClientOptions, isMockStorageEnabled } from "../src/services/storageService.js";

const baseConfig = {
  NODE_ENV: "development",
  AI_ALLOW_MOCKS: false,
  S3_REGION: "ap-south-1",
  S3_ENDPOINT: "",
  S3_ACCESS_KEY_ID: "dummy_s3_key",
  S3_SECRET_ACCESS_KEY: "dummy_s3_secret",
};

test("S3 client uses explicit credentials only when a complete real pair is configured", () => {
  const options = createS3ClientOptions({
    ...baseConfig,
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
  });

  assert.equal(options.region, "ap-south-1");
  assert.deepEqual(options.credentials, {
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
  });
});

test("S3 client leaves credentials to the AWS SDK default chain when keys are absent", () => {
  const options = createS3ClientOptions(baseConfig);
  assert.equal(options.region, "ap-south-1");
  assert.equal(Object.hasOwn(options, "credentials"), false);
});

test("incomplete explicit S3 credentials fail with a safe configuration error", () => {
  assert.throws(
    () => createS3ClientOptions({ ...baseConfig, S3_ACCESS_KEY_ID: "test-access-key" }),
    (error) => error.code === "STORAGE_CONFIGURATION_INVALID" && error.statusCode === 503,
  );
});

test("mock storage requires the explicit local mock flag and is impossible in production", () => {
  assert.equal(isMockStorageEnabled({ ...baseConfig, AI_ALLOW_MOCKS: true }), true);
  assert.equal(isMockStorageEnabled({ ...baseConfig, AI_ALLOW_MOCKS: false }), false);
  assert.equal(
    isMockStorageEnabled({ ...baseConfig, NODE_ENV: "production", AI_ALLOW_MOCKS: true }),
    false,
  );
});
