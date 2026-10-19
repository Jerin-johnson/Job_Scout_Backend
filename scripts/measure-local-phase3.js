import "../src/config/env.js";
import { connectMongo, disconnectMongo, isMongoReady } from "../src/config/database.js";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import { Profile } from "../src/infrastructure/database/mongoose/models/ProfileModel.js";
import { jobIngestionService } from "../src/services/jobs/jobIngestionService.js";
import { scoreJobMatch } from "../src/services/jobs/matching.js";
import { profileApplicantCountries } from "../src/services/jobs/eligibility.js";

const hostname = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname))
  throw new Error("Refusing local benchmark on a non-local database.");
await connectMongo();
if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
const percentile = (values, p) =>
  values.slice().sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
  ] || 0;
async function measure(fn, count = 30) {
  await fn();
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    await fn();
    values.push(performance.now() - start);
  }
  return {
    samples: count,
    p50Ms: Number(percentile(values, 0.5).toFixed(2)),
    p95Ms: Number(percentile(values, 0.95).toFixed(2)),
  };
}
try {
  const profiles = await Profile.find({}).lean();
  const profileSignal = (item) =>
    (item.skills || []).length +
    (item.roles || []).length +
    2 * (item.careerProfile?.targetRoles || []).length +
    2 * (item.preferences?.targetRoles || []).length;
  const profile = profiles.sort((a, b) => profileSignal(b) - profileSignal(a))[0] || null;
  const [activeJobs, sample] = await Promise.all([
    Job.countDocuments({ status: "active", expiresAt: { $gt: new Date() } }),
    Job.find({ status: "active", expiresAt: { $gt: new Date() } })
      .select(
        "title company location sourceBoard eligibility structuredLocation compensation salaryRange requirements tags features occupation postedAt postedDateKnown expiresAt",
      )
      .limit(100)
      .lean(),
  ]);
  const coverage = await jobIngestionService.coverageReport(profile);
  const candidates = profile
    ? await jobIngestionService.getCandidateJobs({ profile, limit: 500 })
    : [];
  const timings = {
    catalogList: await measure(() => jobIngestionService.searchJobs({ page: 1, limit: 20 }), 30),
    recommendedRefresh: profile
      ? await measure(async () => {
          const rows = await jobIngestionService.getCandidateJobs({ profile, limit: 500 });
          rows.map((job) => scoreJobMatch(profile, job, { version: "lexical-v2" }));
        }, 15)
      : null,
    detailLookup: sample[0]
      ? await measure(
          () =>
            Job.findById(sample[0]._id)
              .select(
                "title company location sourceBoard sourceUrl eligibility compensation salaryRange structuredLocation postedAt rawDescription",
              )
              .lean(),
          30,
        )
      : null,
  };
  const averageBytes = sample.length
    ? Math.round(
        sample.reduce((sum, job) => sum + Buffer.byteLength(JSON.stringify(job)), 0) /
          sample.length,
      )
    : 0;
  console.log(
    JSON.stringify(
      {
        localOnly: true,
        activeJobs,
        sampleDocs: sample.length,
        averageJsonBytesPerJob: averageBytes,
        estimatedCatalogJsonMB: Object.fromEntries(
          [10000, 100000, 1000000].map((count) => [
            count,
            Number(((count * averageBytes) / 1_000_000).toFixed(2)),
          ]),
        ),
        estimatedEmbeddingBytesAt768Float32: Object.fromEntries(
          [10000, 100000, 1000000].map((count) => [count, count * 768 * 4]),
        ),
        candidates: candidates.length,
        profileCountries: profileApplicantCountries(profile || {}),
        coverage: {
          byOccupation: coverage.byOccupation,
          byCountry: coverage.byCountry,
          byRemoteScope: coverage.byRemoteScope,
          bySource: coverage.bySource,
          unclassifiedBySource: coverage.unclassifiedBySource,
          unknownEligibilityCount: coverage.unknownEligibilityCount,
          unclassifiedCount:
            coverage.byOccupation.find((item) => item._id === "unclassified")?.count || 0,
          targetLocations: coverage.targetLocations,
        },
        timings,
        rssMB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
      },
      null,
      2,
    ),
  );
} finally {
  await disconnectMongo();
  await mongoose.disconnect().catch(() => {});
}
