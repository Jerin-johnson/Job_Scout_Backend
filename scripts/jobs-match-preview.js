import { readFile } from "node:fs/promises";
import { connectMongo, disconnectMongo, isMongoReady } from "../src/config/database.js";
import { Job } from "../src/models/Job.js";
import { classifyEligibility, profileApplicantCountries } from "../src/services/jobs/eligibility.js";
import { scoreJobMatch } from "../src/services/jobs/matching.js";
import { env } from "../src/config/env.js";

const file = process.argv.find((arg) => arg.startsWith("--file="))?.slice(7);
if (!file) throw new Error("Usage: npm run jobs:match:preview -- --file=scripts/fixtures/match-preview.json");
const loaded = JSON.parse(await readFile(file, "utf8"));
const fixtures = Array.isArray(loaded) ? loaded : [loaded];
const host = new URL(env.MONGODB_URI).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host) || env.NODE_ENV === "production") throw new Error("Read-only match preview is limited to the local development database.");
await connectMongo();
try {
  if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
  for (const fixture of fixtures) {
    const profile = fixture.profile;
    const applicantCountries = profileApplicantCountries(profile);
    const jobs = await Job.find({ status: "active", expiresAt: { $gt: new Date() } }).sort({ postedAt: -1, _id: 1 }).limit(400).select("-embedding -rawPayload").lean();
    const classified = jobs.map((job) => ({ job, eligibility: classifyEligibility(job, profile) }));
    const hidden = classified.filter((row) => row.eligibility.status === "not_open");
    const eligible = classified.filter((row) => row.eligibility.status === "eligible");
    const unknown = classified.filter((row) => row.eligibility.status === "unknown");
    const top20 = classified.filter((row) => row.eligibility.status !== "not_open").map(({ job, eligibility }) => ({
      job, eligibility: eligibility.status,
      match: scoreJobMatch(profile, job, { version: env.JOB_MATCH_SCORE_VERSION }),
    })).sort((a, b) => b.match.score - a.match.score || String(a.job._id).localeCompare(String(b.job._id))).slice(0, 20)
      .map(({ job, eligibility, match }) => ({ jobId: String(job._id), title: job.title, company: job.company, source: job.sourceBoard, location: job.location, score: match.score, band: match.band, eligibility }));
    console.log(JSON.stringify({ fixture: fixture.name || "profile", profileCountryCodes: applicantCountries, candidateLimit: jobs.length, hiddenAsIneligible: hidden.length, eligible: eligible.length, unknown: unknown.length, top20 }, null, 2));
  }
} finally { await disconnectMongo(); }
