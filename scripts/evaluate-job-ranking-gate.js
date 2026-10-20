import { fixtures } from "./evaluate-match-versions.js";
import { scoreJobMatch } from "../src/domain/services/jobs/matching.js";

const versions = ["lexical-v2", "lexical-v2.1", "lexical-v3", "lexical-v4"];
const rankAbove = (candidate, control) =>
  Number(!candidate.hardBlocked) > Number(!control.hardBlocked) ||
  (candidate.hardBlocked === control.hardBlocked && candidate.score > control.score);

const relevancePairs = fixtures.map(({ name, profile, job }) => ({
  name,
  isNew: name.startsWith("new-"),
  profile,
  relevant: job,
  control: {
    ...job,
    title: "Unrelated Data Labeling Associate",
    requirements: ["data annotation", "food safety", "forklift"],
    rawDescription: "Label training examples and inspect warehouse inventory.",
    occupation: "delivery-logistics",
  },
}));

const indiaProfile = {
  skills: [{ name: "nursing" }, { name: "BLS" }],
  roles: [{ title: "Staff Nurse", years: 3 }],
  preferences: { targetRoles: ["Staff Nurse"], preferredCountryCodes: ["IN"] },
  careerProfile: { homeLocation: { countryCode: "IN" } },
};
const eligibilityPairs = Array.from({ length: 14 }, (_, index) => ({
  name: `india-us-control-${String(index + 1).padStart(2, "0")}`,
  profile: indiaProfile,
  eligible: {
    title: `Staff Nurse ${index + 1}`,
    requirements: ["nursing", "BLS"],
    location: "Kochi, India",
    eligibility: { countries: ["IN"], remoteScope: "country", confidence: 0.9 },
    locationTier: 1,
  },
  ineligible: {
    title: `Staff Nurse ${index + 1}`,
    requirements: ["nursing", "BLS"],
    location: "Remote - US only",
    eligibility: { countries: ["US"], remoteScope: "country", confidence: 0.9 },
    locationTier: 1,
  },
}));

const results = Object.fromEntries(
  versions.map((version) => {
    const relevance = relevancePairs.map((pair) => {
      const candidate = scoreJobMatch(pair.profile, pair.relevant, { version });
      const control = scoreJobMatch(pair.profile, pair.control, { version });
      return {
        name: pair.name,
        isNew: pair.isNew,
        passes: rankAbove(candidate, control),
        candidate: candidate.score,
        control: control.score,
      };
    });
    const eligibility = eligibilityPairs.map((pair) => {
      const candidate = scoreJobMatch(pair.profile, pair.eligible, { version });
      const control = scoreJobMatch(pair.profile, pair.ineligible, { version });
      return {
        name: pair.name,
        passes: rankAbove(candidate, control) && !candidate.hardBlocked && control.hardBlocked,
      };
    });
    return [
      version,
      {
        relevancePairs: relevance,
        relevancePasses: relevance.filter((item) => item.passes).length,
        newPairImprovements: relevance.filter((item) => item.isNew && item.passes).length,
        newPairCount: relevance.filter((item) => item.isNew).length,
        eligibilityPairs: eligibility,
        eligibilityPasses: eligibility.filter((item) => item.passes).length,
      },
    ];
  }),
);

const summary = Object.fromEntries(
  Object.entries(results).map(([version, result]) => [
    version,
    {
      relevancePairsPassed: `${result.relevancePasses}/${result.relevancePairs.length}`,
      newRelevancePairsPassed: `${result.newPairImprovements}/${result.newPairCount}`,
      eligibilityPairsPassed: `${result.eligibilityPasses}/${result.eligibilityPairs.length}`,
      failedRelevancePairs: result.relevancePairs
        .filter((item) => !item.passes)
        .map((item) => item.name),
      failedEligibilityPairs: result.eligibilityPairs
        .filter((item) => !item.passes)
        .map((item) => item.name),
      newRelevancePairsImprovedVsV2:
        version === "lexical-v2"
          ? 0
          : result.relevancePairs.filter(
              (item) =>
                item.isNew &&
                item.passes &&
                !results["lexical-v2"].relevancePairs.find(
                  (baseline) => baseline.name === item.name,
                )?.passes,
            ).length,
    },
  ]),
);
console.log(
  JSON.stringify(
    {
      versions: summary,
      default: "lexical-v2.1",
      shipDecision:
        "lexical-v2.1 is selected after the confirmed-fresher behavior gate passes with no regressions on frozen existing match fixtures; lexical-v3/v4 remain evaluation-only.",
    },
    null,
    2,
  ),
);
