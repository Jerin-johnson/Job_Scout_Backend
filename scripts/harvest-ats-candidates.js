import "../src/config/env.js";
import { writeFile } from "node:fs/promises";
import { connectMongo, disconnectMongo, isMongoReady } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { Job } from "../src/models/Job.js";
import { detectAtsCareersUrl } from "../src/services/jobs/trackedCompanyService.js";

const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) || "docs/ai/ats-board-candidates.csv";
const limit = Math.min(10000, Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) || 1000)));
const host = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("ATS discovery is local-development only.");
const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

await connectMongo();
if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
try {
  const candidates = new Map();
  const cursor = Job.find({ status: "active", expiresAt: { $gt: new Date() } })
    .select("company sourceUrl canonicalUrl provenance").lean().cursor({ batchSize: 500 });
  for await (const job of cursor) {
    const urls = [job.sourceUrl, job.canonicalUrl, ...(job.provenance || []).map((row) => row.canonicalUrl)];
    for (const url of urls) {
      const board = detectAtsCareersUrl(url);
      if (!board) continue;
      const key = `${board.platform}:${board.slug}`;
      if (!candidates.has(key)) candidates.set(key, { name: String(job.company || board.slug).trim(), ats: board.platform, slug: board.slug, careersUrl: board.careersUrl });
    }
    if (candidates.size >= limit) break;
  }
  const rows = [...candidates.values()];
  const csv = ["name,ats,slug,careersUrl", ...rows.map((row) => [row.name, row.ats, row.slug, row.careersUrl].map(cell).join(","))].join("\n") + "\n";
  await writeFile(output, csv, "utf8");
  console.log(JSON.stringify({ localOnly: true, discoveryMethod: "known active catalog URLs only; no website crawling", discoveredBoards: rows.length, validatedBoards: 0, pendingReview: rows.length, output }));
} finally { await disconnectMongo(); }
