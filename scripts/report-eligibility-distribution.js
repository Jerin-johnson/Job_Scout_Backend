import { connectMongo, disconnectMongo, isMongoReady } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { Job } from "../src/infrastructure/database/mongoose/models/JobModel.js";
import { classifyEligibility } from "../src/services/jobs/eligibility.js";
import { ELIGIBILITY_REGIONS } from "../src/services/jobs/eligibilityRegions.js";

const host = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(host))
  throw new Error("Eligibility distribution is read-only and limited to local MongoDB.");
await connectMongo();
try {
  if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
  const jobs = await Job.find({ status: "active", expiresAt: { $gt: new Date() } })
    .select(
      "title location locationRestrictions country rawDescription tags structuredLocation eligibility sourceBoard",
    )
    .lean();
  const scopes = {
    worldwide: 0,
    regionRestricted: 0,
    countryRestricted: 0,
    timezoneLimited: 0,
    unknown: 0,
    other: 0,
  };
  const perSource = {};
  for (const job of jobs) {
    const scope = job.eligibility?.remoteScope || "unknown";
    const group =
      scope === "worldwide"
        ? "worldwide"
        : Object.hasOwn(ELIGIBILITY_REGIONS, scope)
          ? "regionRestricted"
          : scope === "country"
            ? "countryRestricted"
            : scope === "timezone"
              ? "timezoneLimited"
              : scope === "unknown"
                ? "unknown"
                : "other";
    scopes[group] += 1;
    const key = job.sourceBoard || "unknown";
    perSource[key] ||= { total: 0, unknownScope: 0, lowConfidence: 0 };
    perSource[key].total += 1;
    if (scope === "unknown") perSource[key].unknownScope += 1;
    if (Number(job.eligibility?.confidence || 0) < 0.5) perSource[key].lowConfidence += 1;
  }
  const countries = ["IN", "AE", "GB"];
  const applicantEligibility = Object.fromEntries(
    countries.map((countryCode) => {
      const profile = { careerProfile: { homeLocation: { countryCode } } };
      const counts = { eligible: 0, ineligible: 0, unknown: 0 };
      for (const job of jobs) {
        const status = classifyEligibility(job, profile).status;
        counts[status === "not_open" ? "ineligible" : status] += 1;
      }
      return [
        countryCode,
        {
          ...counts,
          eligibleShare: jobs.length ? Number((counts.eligible / jobs.length).toFixed(4)) : 0,
          unknownShare: jobs.length ? Number((counts.unknown / jobs.length).toFixed(4)) : 0,
        },
      ];
    }),
  );
  console.log(
    JSON.stringify(
      { mode: "read-only", totalActive: jobs.length, scopes, applicantEligibility, perSource },
      null,
      2,
    ),
  );
} finally {
  await disconnectMongo();
}
