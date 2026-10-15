import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { logger } from "../shared/utils/logger.js";

let s3Client = null;

function getS3Client() {
  if (s3Client) return s3Client;

  s3Client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  return s3Client;
}

export const storageService = {
  /**
   * Upload original file to S3 / Cloudflare R2. Resume text is encrypted
   * separately before it is stored in the database.
   */
  async uploadFile({ key, buffer, contentType }) {
    const storageConfigured =
      env.S3_ACCESS_KEY_ID !== "dummy_s3_key" && env.S3_SECRET_ACCESS_KEY !== "dummy_s3_secret";
    if (!storageConfigured) {
      if (env.NODE_ENV === "production") {
        const error = new Error("Resume file storage is not configured.");
        error.statusCode = 503;
        error.code = "STORAGE_NOT_CONFIGURED";
        throw error;
      }
      logger.debug({ key }, "Mock storage mode active; no original file is persisted");
      return `s3://${env.S3_BUCKET}/${key}`;
    }

    try {
      const client = getS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      return `s3://${env.S3_BUCKET}/${key}`;
    } catch (err) {
      logger.error({ err: err.message, key }, "Failed to upload file to S3/R2");
      const error = new Error("Resume file storage is temporarily unavailable.");
      error.statusCode = 503;
      error.code = "STORAGE_UNAVAILABLE";
      throw error;
    }
  },

  /**
   * Download file from S3 / R2
   */
  async getFile({ key }) {
    if (env.S3_ACCESS_KEY_ID === "dummy_s3_key") {
      return Buffer.from("");
    }

    const client = getS3Client();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      }),
    );

    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
  },
};
