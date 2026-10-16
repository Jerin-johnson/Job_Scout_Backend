import "../src/config/env.js";
import { connectMongo, disconnectMongo, isMongoReady } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { Job } from "../src/models/Job.js";

const hostname = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname)) throw new Error("Local-development only.");
await connectMongo();
if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
try {
  const jobs = await Job.find({ status: "active", expiresAt: { $gt: new Date() } }).sort({ _id: 1 }).select("title sourceBoard occupation occupationConfidence").lean();
  let seed = 20261016;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let index = jobs.length - 1; index > 0; index -= 1) { const swap = Math.floor(random() * (index + 1)); [jobs[index], jobs[swap]] = [jobs[swap], jobs[index]]; }
  const sample = jobs.slice(0, 100).map((job, index) => ({ index: index + 1, source: job.sourceBoard, title: job.title, predicted: job.occupation, confidence: job.occupationConfidence }));
  if (process.argv.includes("--compact")) console.log(sample.map((row) => `${row.index}\t${row.predicted}\t${row.title}`).join("\n"));
  else {
    const counts = (rows, key) => Object.fromEntries([...rows.reduce((map, row) => map.set(row[key] || "unknown", (map.get(row[key] || "unknown") || 0) + 1), new Map())].sort(([a], [b]) => a.localeCompare(b)));
    console.log(JSON.stringify({ sampleSize: sample.length, predictedFamilies: counts(sample, "predicted"), bySource: Object.fromEntries([...new Set(sample.map((row) => row.source))].sort().map((source) => [source, counts(sample.filter((row) => row.source === source), "predicted")])), sample }, null, 2));
  }
} finally { await disconnectMongo(); }
