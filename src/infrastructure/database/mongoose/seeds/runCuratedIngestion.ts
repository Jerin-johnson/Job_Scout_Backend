import "reflect-metadata";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongo, disconnectMongo } from "../../database.js";
import { jobIngestionService } from "../../../external-services/jobs/ingestion/JobIngestionEngine.js";
import { Job } from "../models/JobModel.js";

async function run() {
  await connectMongo();
  console.log("Connected to MongoDB for curated ingestion.");

  const initialCount = await Job.countDocuments();
  console.log(`Initial job count in database: ${initialCount}`);

  for (const sourceKey of ["greenhouse", "ashby", "lever"]) {
    console.log(`\n--- Starting ingestion for source: ${sourceKey} ---`);
    try {
      const result = await jobIngestionService.ingestSource(sourceKey, { force: true });
      console.log(`Source [${sourceKey}] ingestion finished:`, JSON.stringify(result, null, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Source [${sourceKey}] error:`, msg);
    }
  }

  const finalCount = await Job.countDocuments();
  console.log(`\nFinal job count in database: ${finalCount} (Added: ${finalCount - initialCount})`);

  await disconnectMongo();
  console.log("Curated ingestion complete!");
}

run().catch((err) => {
  console.error("Runner error:", err);
  process.exit(1);
});
