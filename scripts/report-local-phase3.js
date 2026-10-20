import "../src/config/env.js";
import {
  connectMongo,
  disconnectMongo,
  isMongoReady,
} from "../src/infrastructure/database/database.js";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { Profile } from "../src/infrastructure/database/mongoose/models/ProfileModel.js";
import { jobIngestionService } from "../src/infrastructure/database/mongoose/services/jobIngestionService.js";
import { scoreJobMatch } from "../src/domain/services/jobs/matching.js";
import {
  classifyEligibility,
  profileApplicantCountries,
} from "../src/domain/services/jobs/eligibility.js";

const hostname = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname))
  throw new Error("Refusing to read profile data: this report is local-development only.");
await connectMongo();
if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
try {
  const profiles = await Profile.find({}).lean();
  const profileSignal = (item) =>
    (item.skills || []).length +
    (item.roles || []).length +
    2 * (item.careerProfile?.targetRoles || []).length +
    2 * (item.preferences?.targetRoles || []).length;
  const profile = profiles.sort((a, b) => profileSignal(b) - profileSignal(a))[0] || null;
  if (!profile) {
    console.log(JSON.stringify({ profile: null, note: "No local profile is saved." }));
    process.exitCode = 0;
  } else {
    const countries = profileApplicantCountries(profile);
    const targets = [
      ...new Set(
        [profile.careerProfile?.homeLocation, ...(profile.careerProfile?.targetLocations || [])]
          .filter(Boolean)
          .map((place) => place.cityCode || place.countryCode || place.scope)
          .filter(Boolean),
      ),
    ];
    const candidates = await jobIngestionService.getCandidateJobs({ profile, limit: 500 });
    const matches = candidates
      .map((job) => ({
        job,
        eligibility: classifyEligibility(job, profile),
        match: scoreJobMatch(profile, job, { version: "lexical-v2" }),
      }))
      .filter(({ eligibility }) => eligibility.status !== "not_open")
      .sort((a, b) => b.match.score - a.match.score);
    const scores = matches.map(({ match }) => match.score);
    const distribution = {
      under50: scores.filter((score) => score < 50).length,
      from50To64: scores.filter((score) => score >= 50 && score < 65).length,
      from65To79: scores.filter((score) => score >= 65 && score < 80).length,
      from80: scores.filter((score) => score >= 80).length,
    };
    console.log(
      JSON.stringify(
        {
          localProfilesSeen: profiles.length,
          selectedProfileFieldCounts: {
            skillFacts: (profile.skills || []).length,
            roleFacts: (profile.roles || []).length,
            targetRoles:
              (profile.careerProfile?.targetRoles || []).length +
              (profile.preferences?.targetRoles || []).length,
          },
          profile: { homeCountry: countries[0] || null, countries, targetLocations: targets },
          candidates: candidates.length,
          afterEligibility: matches.length,
          distribution,
          top20: matches.slice(0, 20).map(({ job, match, eligibility }) => ({
            title: job.title,
            company: job.company,
            source: job.sourceBoard,
            location: job.location,
            score: match.score,
            eligibility: eligibility.status,
          })),
        },
        null,
        2,
      ),
    );
  }
} finally {
  await disconnectMongo();
  await mongoose.disconnect().catch(() => {});
}
