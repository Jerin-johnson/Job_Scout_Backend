import mongoose from "mongoose";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { env } from "../src/config/env.js";
import { createS3ClientOptions } from "../src/services/storageService.js";
import { Resume } from "../src/infrastructure/database/mongoose/models/ResumeModel.js";

const cutoff = new Date(Date.now() - env.ORPHAN_RESUME_CLEANUP_AFTER_HOURS * 60 * 60 * 1000);
const s3 = new S3Client(createS3ClientOptions());
let continuationToken;
let scanned = 0;
let candidates = 0;

try {
  await mongoose.connect(env.MONGODB_URI);
  console.log(
    `Report only: no S3 objects will be deleted. Age threshold: ${env.ORPHAN_RESUME_CLEANUP_AFTER_HOURS} hours.`,
  );
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: "resumes/",
        ContinuationToken: continuationToken,
      }),
    );
    const oldObjects = (page.Contents ?? []).filter(
      (item) => item.Key && item.LastModified && item.LastModified < cutoff,
    );
    scanned += (page.Contents ?? []).length;
    if (oldObjects.length) {
      const keys = oldObjects.map((item) => item.Key);
      const recorded = await Resume.find({ s3Key: { $in: keys } })
        .select("s3Key")
        .lean();
      const recordedKeys = new Set(recorded.map((item) => item.s3Key));
      for (const item of oldObjects) {
        if (recordedKeys.has(item.Key)) continue;
        candidates += 1;
        console.log(
          JSON.stringify({
            orphanCandidate: item.Key,
            sizeBytes: item.Size,
            lastModified: item.LastModified.toISOString(),
          }),
        );
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  console.log(
    JSON.stringify({
      scannedObjects: scanned,
      orphanCandidates: candidates,
      deletionEnabled: false,
    }),
  );
} catch (error) {
  console.error("Orphan resume report failed", {
    errorName: error?.name,
    errorCode: error?.Code || error?.code,
  });
  process.exitCode = 1;
} finally {
  s3.destroy();
  await mongoose.disconnect();
}
