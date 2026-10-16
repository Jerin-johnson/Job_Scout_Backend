import { scoreJobMatch } from "../src/services/jobs/matching.js";
import { fixtures as existing } from "./evaluate-match-versions.js";

const realisticProfiles = [
  ["kerala-nurse", "Registered Nurse", ["nursing", "patient care", "BLS"], false, ["IN"]],
  ["kerala-engineer", "Software Engineer", ["javascript", "react", "node.js"], false, ["IN"]],
  ["fresher", "Graduate Nurse", ["nursing", "clinical rotations"], true, ["IN"]],
  ["gulf-bound", "Registered Nurse", ["nursing", "DHA", "patient care"], false, ["IN", "AE", "SA", "QA"]],
  ["remote-engineer", "Backend Engineer", ["node.js", "mongodb", "api design"], false, ["IN"]],
  ["career-returner", "Accountant", ["accounting", "excel", "payroll"], false, ["IN"]],
  ["no-role-facts", "Data Analyst", ["SQL", "Excel"], false, ["IN"]],
];
const comparisons = realisticProfiles.flatMap(([name, role, skills, fresher, countries]) => {
  const profile = { skills: skills.map((skill) => ({ name: skill })), roles: name === "no-role-facts" ? [] : [{ title: role, years: fresher ? 0 : 3 }], preferences: { targetRoles: [role], preferredCountryCodes: countries }, careerProfile: { homeLocation: { countryCode: countries[0] }, targetLocations: countries.slice(1).map((countryCode) => ({ countryCode, scope: "country" })), experience: { isFresher: fresher, confirmedYears: fresher ? 0 : 3 } } };
  const count = 2;
  return Array.from({ length: count }, (_, index) => {
    const us = { title: `${role} ${index + 1}`, requirements: skills, location: "Remote - US only", rawDescription: "Must be authorized to work in the US. Visa sponsorship not available.", remoteType: "remote", occupation: name.includes("nurse") ? "nursing" : "unclassified", locationTier: 1 };
    const local = { ...us, location: countries[0] === "IN" ? "Kochi, India" : "India or Gulf", rawDescription: "Applicants based in India or Gulf welcome.", eligibility: { countries, remoteScope: "country", confidence: 0.9 }, locationTier: 1 };
    return { name: `${name}-us-only-${index + 1}`, profile, us, local };
  });
});

function run(profile, job, version) {
  return scoreJobMatch(profile, job, { version });
}
const rows = existing.map(({ name, profile, job }) => {
  const scores = Object.fromEntries(["lexical-v2", "lexical-v3", "lexical-v4"].map((version) => [version, run(profile, job, version)]));
  return { name, v2: scores["lexical-v2"].score, v3: scores["lexical-v3"].score, v4: scores["lexical-v4"].score, v4Delta: scores["lexical-v4"].score - scores["lexical-v2"].score };
});
let eligibleAboveUs = 0;
for (const pair of comparisons) {
  const us = run(pair.profile, pair.us, "lexical-v4");
  const local = run(pair.profile, pair.local, "lexical-v4");
  const v4Pass = us.hardBlocked && !local.hardBlocked && local.score > us.score;
  if (v4Pass) eligibleAboveUs += 1;
  rows.push({ name: pair.name, v2: run(pair.profile, pair.local, "lexical-v2").score, v3: run(pair.profile, pair.local, "lexical-v3").score, v4: local.score, usOnlyV4: us.score, usHardBlocked: us.hardBlocked, localEligible: !local.hardBlocked, v4EligibilityPass: v4Pass });
}
console.log("fixture | v2 | v3 | v4 | delta v4-v2 | US-only v4");
for (const row of rows) console.log(`${row.name} | ${row.v2} | ${row.v3} | ${row.v4} | ${row.v4Delta === undefined ? "—" : `${row.v4Delta >= 0 ? "+" : ""}${row.v4Delta}`} | ${row.usOnlyV4 === undefined ? "—" : `${row.usOnlyV4} (hard-blocked=${row.usHardBlocked})`}`);
const existingRegressions = rows.filter((row) => row.name.startsWith("existing-") && row.v4Delta < 0);
console.log(`Existing v4 score regressions: ${existingRegressions.length}/${existing.filter((item) => item.name.startsWith("existing-")).length}`);
console.log(`New explicit US-only eligibility cases passed: ${eligibleAboveUs}/${comparisons.length}`);
console.log(`Ship gate: ${existingRegressions.length === 0 && eligibleAboveUs === comparisons.length ? "PASS (review required before switching default)" : "FAIL; keep lexical-v2 as default"}`);
