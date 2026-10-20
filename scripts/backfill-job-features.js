import "../src/config/env.js";
import { connectMongo, disconnectMongo } from "../src/config/database.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import { extractJobFeatures } from "../src/services/jobs/matching.js";

const apply = process.argv.includes("--apply");
const batchSize = 250;
await connectMongo();
try {
  const cursor = Job.find({
    $or: [{ featuresVersion: { $ne: 1 } }, { features: { $exists: false } }],
  })
    .select(
      "_id title rawDescription requirements tags remoteType compensation salaryRange employmentType",
    )
    .lean()
    .cursor();
  let scanned = 0;
  let updated = 0;
  let operations = [];
  for await (const job of cursor) {
    scanned += 1;
    const features = extractJobFeatures(job);
    operations.push({
      updateOne: {
        filter: { _id: job._id, featuresVersion: { $ne: 1 } },
        update: { $set: { features, featuresVersion: 1 } },
      },
    });
    if (operations.length >= batchSize) {
      if (apply) updated += (await Job.bulkWrite(operations, { ordered: false })).modifiedCount;
      operations = [];
    }
  }
  if (operations.length && apply)
    updated += (await Job.bulkWrite(operations, { ordered: false })).modifiedCount;
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned, updated }));
} finally {
  await disconnectMongo();
}
