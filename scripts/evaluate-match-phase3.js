import {
  LEXICAL_V4_WEIGHTS,
  MATCH_SCORE_WEIGHTS,
  scoreJobMatch,
} from "../src/domain/services/jobs/matching.js";
import { fixtures as existing } from "./evaluate-match-versions.js";

const realisticProfiles = [
  ["kerala-nurse", "Registered Nurse", ["nursing", "patient care", "BLS"], false, ["IN"]],
  ["kerala-engineer", "Software Engineer", ["javascript", "react", "node.js"], false, ["IN"]],
  ["fresher", "Graduate Nurse", ["nursing", "clinical rotations"], true, ["IN"]],
  [
    "gulf-bound",
    "Registered Nurse",
    ["nursing", "DHA", "patient care"],
    false,
    ["IN", "AE", "SA", "QA"],
  ],
  ["remote-engineer", "Backend Engineer", ["node.js", "mongodb", "api design"], false, ["IN"]],
  ["career-returner", "Accountant", ["accounting", "excel", "payroll"], false, ["IN"]],
  ["no-role-facts", "Data Analyst", ["SQL", "Excel"], false, ["IN"]],
];
const comparisons = realisticProfiles.flatMap(([name, role, skills, fresher, countries]) => {
  const profile = {
    skills: skills.map((skill) => ({ name: skill })),
    roles: name === "no-role-facts" ? [] : [{ title: role, years: fresher ? 0 : 3 }],
    preferences: { targetRoles: [role], preferredCountryCodes: countries },
    careerProfile: {
      homeLocation: { countryCode: countries[0] },
      targetLocations: countries.slice(1).map((countryCode) => ({ countryCode, scope: "country" })),
      experience: { isFresher: fresher, confirmedYears: fresher ? 0 : 3 },
    },
  };
  const count = 2;
  return Array.from({ length: count }, (_, index) => {
    const us = {
      title: `${role} ${index + 1}`,
      requirements: skills,
      location: "Remote - US only",
      rawDescription: "Must be authorized to work in the US. Visa sponsorship not available.",
      remoteType: "remote",
      occupation: name.includes("nurse") ? "nursing" : "unclassified",
      locationTier: 1,
    };
    const local = {
      ...us,
      location: countries[0] === "IN" ? "Kochi, India" : "India or Gulf",
      rawDescription: "Applicants based in India or Gulf welcome.",
      eligibility: { countries, remoteScope: "country", confidence: 0.9 },
      locationTier: 1,
    };
    return { name: `${name}-us-only-${index + 1}`, profile, us, local };
  });
});
const indiaPersonas = [
  ["india-hr", "HR Manager", ["recruiting", "employee relations"], false],
  ["india-designer", "Graphic Designer", ["Figma", "visual design"], false],
  ["india-marketing", "Marketing Manager", ["marketing", "campaigns"], false],
  ["india-nurse", "Staff Nurse", ["nursing", "patient care", "BLS"], false],
  ["india-delivery", "Delivery Associate", ["route planning", "customer service"], false],
  ["india-kerala-engineer", "Software Engineer", ["JavaScript", "React", "Node.js"], false],
  ["india-fresher", "Graduate Trainee", ["Excel", "communication"], true],
  ["india-remote-only", "Backend Engineer", ["Node.js", "MongoDB", "API design"], false],
  ["india-gulf-bound", "Accountant", ["accounting", "Excel", "payroll"], false],
  ["india-career-returner", "Accountant", ["accounting", "reconciliation"], false],
].map(([name, role, skills, fresher]) => {
  const targetCountries = name === "india-gulf-bound" ? ["IN", "AE", "SA", "QA"] : ["IN"];
  const profile = {
    skills: skills.map((skill) => ({ name: skill })),
    roles: fresher ? [] : [{ title: role, years: 3 }],
    preferences: { targetRoles: [role], preferredCountryCodes: targetCountries },
    careerProfile: {
      homeLocation: { countryCode: "IN" },
      targetLocations: targetCountries.slice(1).map((countryCode) => ({ countryCode })),
      experience: { isFresher: fresher, confirmedYears: fresher ? 0 : 3 },
    },
  };
  const local = {
    title: `${role} - India`,
    requirements: skills,
    location:
      name === "india-gulf-bound"
        ? "Dubai, UAE"
        : name === "india-kerala-engineer"
          ? "Kochi, Kerala, India"
          : name === "india-fresher"
            ? "Bengaluru, India"
            : "India",
    rawDescription: "Applicants authorized to work in India or UAE may apply.",
    remoteType: name === "india-remote-only" ? "remote" : "onsite",
    locationTier: 1,
    structuredLocation: {
      countryCode: name === "india-gulf-bound" ? "AE" : "IN",
      remoteScope: "country",
    },
    eligibility: {
      countries: targetCountries,
      remoteScope: "country",
      evidence: "Applicants authorized to work in India or UAE",
      confidence: 0.9,
    },
  };
  const usOnly = {
    ...local,
    title: `${role} - US only`,
    location: "US only",
    structuredLocation: { countryCode: "US", remoteScope: "country" },
    eligibility: {
      countries: ["US"],
      remoteScope: "country",
      evidence: "US only",
      confidence: 0.9,
    },
    rawDescription: "Applicants must be authorized to work in the United States.",
  };
  return { name, profile, local, usOnly };
});

function run(profile, job, version) {
  return scoreJobMatch(profile, job, { version });
}
const rows = existing.map(({ name, profile, job }) => {
  const scores = Object.fromEntries(
    ["lexical-v2", "lexical-v3", "lexical-v4"].map((version) => [
      version,
      run(profile, job, version),
    ]),
  );
  const v2 = scores["lexical-v2"],
    v4 = scores["lexical-v4"];
  const v2Parts = Object.fromEntries(
    Object.entries(MATCH_SCORE_WEIGHTS).map(([part, weight]) => [
      part,
      v2.breakdown[part] * weight,
    ]),
  );
  const v4Parts = {
    ...Object.fromEntries(
      ["skills", "title", "experience", "location", "salary", "recency"].map((part) => [
        part,
        v4.breakdown[part] * LEXICAL_V4_WEIGHTS[part],
      ]),
    ),
    occupation: (v4.breakdown.occupation || 0) * LEXICAL_V4_WEIGHTS.occupation,
    seniority: (v4.breakdown.seniority || 0) * LEXICAL_V4_WEIGHTS.seniority,
    eligibility: v4.breakdown.eligibility || 0,
  };
  const componentDeltas = Object.fromEntries(
    [...new Set([...Object.keys(v2Parts), ...Object.keys(v4Parts)])].map((part) => [
      part,
      Number(((v4Parts[part] || 0) - (v2Parts[part] || 0)).toFixed(2)),
    ]),
  );
  return {
    name,
    v2: v2.score,
    v3: scores["lexical-v3"].score,
    v4: v4.score,
    v4Delta: v4.score - v2.score,
    componentDeltas,
  };
});
let eligibleAboveUs = 0;
for (const pair of comparisons) {
  const us = run(pair.profile, pair.us, "lexical-v4");
  const local = run(pair.profile, pair.local, "lexical-v4");
  const v4Pass = us.hardBlocked && !local.hardBlocked && local.score > us.score;
  if (v4Pass) eligibleAboveUs += 1;
  rows.push({
    name: pair.name,
    v2: run(pair.profile, pair.local, "lexical-v2").score,
    v3: run(pair.profile, pair.local, "lexical-v3").score,
    v4: local.score,
    usOnlyV4: us.score,
    usHardBlocked: us.hardBlocked,
    localEligible: !local.hardBlocked,
    v4EligibilityPass: v4Pass,
  });
}
let indiaPairsPassed = 0;
for (const pair of indiaPersonas) {
  const v2 = run(pair.profile, pair.local, "lexical-v2");
  const v3 = run(pair.profile, pair.local, "lexical-v3");
  const v4 = run(pair.profile, pair.local, "lexical-v4");
  const us = run(pair.profile, pair.usOnly, "lexical-v4");
  const pass = !v4.hardBlocked && us.hardBlocked && v4.score > us.score;
  if (pass) indiaPairsPassed += 1;
  rows.push({
    name: pair.name,
    v2: v2.score,
    v3: v3.score,
    v4: v4.score,
    v4Delta: v4.score - v2.score,
    usOnlyV4: us.score,
    usHardBlocked: us.hardBlocked,
    localEligible: !v4.hardBlocked,
    indiaEligibilityPass: pass,
  });
}
console.log("fixture | v2 | v3 | v4 | delta v4-v2 | US-only v4");
for (const row of rows)
  console.log(
    `${row.name} | ${row.v2} | ${row.v3} | ${row.v4} | ${row.v4Delta === undefined ? "—" : `${row.v4Delta >= 0 ? "+" : ""}${row.v4Delta}`} | ${row.usOnlyV4 === undefined ? "—" : `${row.usOnlyV4} (hard-blocked=${row.usHardBlocked})`}`,
  );
const existingRegressions = rows.filter(
  (row) => row.name.startsWith("existing-") && row.v4Delta < 0,
);
console.log(
  `Existing v4 score regressions: ${existingRegressions.length}/${existing.filter((item) => item.name.startsWith("existing-")).length}`,
);
console.log(
  `New explicit US-only eligibility cases passed: ${eligibleAboveUs}/${comparisons.length}`,
);
console.log(
  `New India persona eligibility/US-control cases passed: ${indiaPairsPassed}/${indiaPersonas.length}`,
);
console.log("Existing fixture component deltas v4-v2 (weighted score points):");
for (const row of rows.filter((item) => item.componentDeltas))
  console.log(`${row.name}: ${JSON.stringify(row.componentDeltas)}`);
console.log(
  `Ship gate: ${existingRegressions.length === 0 && eligibleAboveUs === comparisons.length && indiaPairsPassed === indiaPersonas.length ? "PASS (review required before switching default)" : "FAIL; keep lexical-v2 as default"}`,
);
