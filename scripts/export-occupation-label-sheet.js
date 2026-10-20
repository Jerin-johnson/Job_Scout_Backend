import "../src/config/env.js";
import { writeFile } from "node:fs/promises";
import {
  connectMongo,
  disconnectMongo,
  isMongoReady,
} from "../src/infrastructure/database/database.js";
import { env } from "../src/config/env.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";

const output =
  process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ||
  "docs/ai/occupation-labels-2026-10-18.csv";
const sampleSize = Math.min(
  300,
  Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--size="))?.slice(7) || 300)),
);
const hostname = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname))
  throw new Error("Label sampling is local-development only.");
const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

await connectMongo();
if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
try {
  const jobs = await Job.find({ status: "active", expiresAt: { $gt: new Date() } })
    .select("_id title company sourceBoard occupation occupationConfidence")
    .sort({ _id: 1 })
    .lean();
  const strata = new Map();
  for (const job of jobs) {
    const key = `${job.sourceBoard || "unknown"}\u0000${job.occupation || "unclassified"}`;
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(job);
  }
  let seed = 20261018;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const rows of strata.values())
    for (let i = rows.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
  const selected = [];
  while (selected.length < sampleSize) {
    let progressed = false;
    for (const rows of strata.values()) {
      if (rows.length && selected.length < sampleSize) {
        selected.push(rows.pop());
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  const rows = selected.map((job) => [
    job._id,
    job.title,
    job.company,
    job.sourceBoard,
    job.occupation || "unclassified",
    "",
    "",
  ]);
  const csv =
    [["id", "title", "company", "source", "predicted family", "correct family", "notes"], ...rows]
      .map((row) => row.map(quote).join(","))
      .join("\n") + "\n";
  await writeFile(output, csv, { flag: "wx" });
  const bySourceFamily = {};
  for (const job of selected) {
    const key = `${job.sourceBoard || "unknown"}/${job.occupation || "unclassified"}`;
    bySourceFamily[key] = (bySourceFamily[key] || 0) + 1;
  }
  console.log(
    JSON.stringify({
      localOnly: true,
      activeJobs: jobs.length,
      sampleSize: selected.length,
      strataCount: strata.size,
      bySourceFamily,
      output,
    }),
  );
} finally {
  await disconnectMongo();
}
