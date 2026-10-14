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
   * Upload encrypted file to S3 / Cloudflare R2
   */
  async uploadFile({ key, buffer, contentType }) {
    if (env.S3_ACCESS_KEY_ID === "dummy_s3_key") {
      logger.debug({ key }, "Mock storage mode active; bypassing remote S3 upload");
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
      logger.warn({ err: err.message, key }, "Failed to upload file to S3/R2");
      return `local://${key}`;
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
