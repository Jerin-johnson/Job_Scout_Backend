import { connectMongo, disconnectMongo } from "../src/config/database.js";
import { Profile } from "../src/infrastructure/database/mongoose/models/ProfileModel.js";

try {
  await connectMongo();
  const profiles = await Profile.find({})
    .select("roles skills education preferences careerProfile")
    .lean();
  const report = {
    mode: "read-only",
    profileCount: profiles.length,
    legacyTargetRoleCount: profiles.reduce(
      (sum, profile) => sum + (profile.preferences?.targetRoles?.length || 0),
      0,
    ),
    roleFactCount: profiles.reduce((sum, profile) => sum + (profile.roles?.length || 0), 0),
    skillFactCount: profiles.reduce((sum, profile) => sum + (profile.skills?.length || 0), 0),
    educationFactCount: profiles.reduce(
      (sum, profile) => sum + (profile.education?.length || 0),
      0,
    ),
    preferredLocationCount: profiles.reduce(
      (sum, profile) => sum + (profile.preferences?.preferredLocations?.length || 0),
      0,
    ),
    preferredCountryCodeCount: profiles.reduce(
      (sum, profile) => sum + (profile.preferences?.preferredCountryCodes?.length || 0),
      0,
    ),
    profilesWithPositiveLegacyUsdSalary: profiles.filter(
      (profile) => Number(profile.preferences?.minimumSalaryUsd) > 0,
    ).length,
    profilesAlreadyWithCareerProfile: profiles.filter((profile) => Boolean(profile.careerProfile))
      .length,
    proposedWrites: 0,
  };
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error(
    "Could not create the read-only career-profile migration report. Check local MongoDB availability.",
  );
  process.exitCode = 1;
} finally {
  await disconnectMongo().catch(() => {});
}
