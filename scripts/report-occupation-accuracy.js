import "../src/config/env.js";
import { readFile } from "node:fs/promises";
import {
  connectMongo,
  disconnectMongo,
  isMongoReady,
} from "../src/infrastructure/database/database.js";
import { env } from "../src/config/env.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import { summarizeOccupationLabels } from "../src/domain/services/jobs/occupationEvaluation.js";

const hostname = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname))
  throw new Error("Occupation accuracy report is local-development only.");
const goldLabels = JSON.parse(
  await readFile(new URL("./fixtures/occupation-gold-100.json", import.meta.url), "utf8"),
);
const labelsByTitle = new Map(goldLabels);
if (goldLabels.length !== 100)
  throw new Error("Occupation gold fixture must contain 100 hand-labeled sample rows.");
await connectMongo();
try {
  if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
  const allActive = await Job.find({ status: "active", expiresAt: { $gt: new Date() } })
    .select("title sourceBoard occupation")
    .sort({ _id: 1 })
    .lean();
  let seed = 20261016;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const sample = allActive.slice();
  for (let index = sample.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [sample[index], sample[swap]] = [sample[swap], sample[index]];
  }
  const reviewed = sample.slice(0, 100);
  const missing = reviewed.filter((job) => !labelsByTitle.has(job.title));
  if (reviewed.length !== 100 || missing.length)
    throw new Error(
      `The deterministic 100-job sample differs from the hand-labeled fixture (${missing.length} missing labels).`,
    );
  const unclassifiedBySource = {};
  for (const job of allActive) {
    const source = job.sourceBoard || "unknown";
    unclassifiedBySource[source] ||= { total: 0, unclassified: 0 };
    unclassifiedBySource[source].total += 1;
    if (!job.occupation || job.occupation === "unclassified")
      unclassifiedBySource[source].unclassified += 1;
  }
  for (const value of Object.values(unclassifiedBySource))
    value.share = Number((value.unclassified / value.total).toFixed(4));
  const labeledMetrics = summarizeOccupationLabels(
    reviewed.map((job) => ({ predicted: job.occupation, gold: labelsByTitle.get(job.title) })),
  );
  console.log(
    JSON.stringify(
      {
        mode: "local-read-only",
        method:
          "deterministic seeded 100-title sample, manually labeled by title; precision is per predicted family",
        ...labeledMetrics,
        unclassifiedBySource,
      },
      null,
      2,
    ),
  );
} finally {
  await disconnectMongo();
}
