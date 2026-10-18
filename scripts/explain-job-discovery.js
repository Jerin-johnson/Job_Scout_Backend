import "../src/config/env.js";
import { connectMongo, disconnectMongo, isMongoReady } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { Job } from "../src/models/Job.js";

const hostname = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname)) throw new Error("Discovery explain is read-only and limited to local MongoDB.");
await connectMongo();
try {
  if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
  const explain = await Job.find({ status: "active", expiresAt: { $gt: new Date() }, sourceBoard: { $in: ["remoteok", "remotive", "jobicy"] } })
    .sort({ postedAt: -1, _id: 1 }).limit(400).hint("job_candidate_recent_feed").explain("executionStats");
  const winning = explain.queryPlanner.winningPlan;
  const stages = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.stage || node.indexName) stages.push({ stage: node.stage, indexName: node.indexName, direction: node.direction });
    for (const value of Object.values(node)) if (value && typeof value === "object") Array.isArray(value) ? value.forEach(visit) : visit(value);
  };
  visit(winning);
  console.log(JSON.stringify({ mode: "local-read-only", query: "active, unexpired, approved indexed sources; postedAt desc; cap 400", stages, executionStats: { nReturned: explain.executionStats.nReturned, totalKeysExamined: explain.executionStats.totalKeysExamined, totalDocsExamined: explain.executionStats.totalDocsExamined, executionTimeMillis: explain.executionStats.executionTimeMillis } }, null, 2));
} finally { await disconnectMongo(); }
