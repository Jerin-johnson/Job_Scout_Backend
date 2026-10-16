import test from "node:test";
import assert from "node:assert/strict";
import { extractJobFeatures, scoreJobMatch, MATCH_SCORE_VERSION } from "../src/services/jobs/matching.js";

const nurseProfile = {
  skills: ["GNM", "ICU", "BLS", "Patient care", "Nursing"].map((name) => ({ name })),
  roles: [{ title: "Staff Nurse", years: 3 }],
  preferences: { targetRoles: ["Staff Nurse"], preferredLocations: ["Kochi"], remotePreference: "any" },
};

test("job feature extraction expands clinical aliases and captures experience and licences", () => {
  const features = extractJobFeatures({
    title: "ICU Staff Nurse",
    requirements: ["GNM or BSc Nursing", "BLS certification", "2 years experience"],
    rawDescription: "Registered Nurse licence required. Provide critical care.",
  });
  assert.ok(features.skills.includes("nursing"));
  assert.ok(features.skills.includes("critical care"));
  assert.equal(features.experienceYears, 2);
  assert.ok(features.licenses.some((license) => license.includes("registered nurse")));
  assert.equal(features.occupation, "nurse");
});

test("features capture required versus preferred skills, employment, and concise responsibilities", () => {
  const features = extractJobFeatures({
    title: "Accountant",
    employmentType: "full-time",
    requirements: ["CPA required", "Excel preferred", "3 years experience"],
    rawDescription: "You will manage monthly close. Responsible for reconciliations and reporting.",
  });
  assert.ok(features.requiredSkills.includes("cpa required"));
  assert.ok(features.preferredSkills.includes("excel preferred"));
  assert.equal(features.employmentType, "full-time");
  assert.ok(features.responsibilities.length > 0);
});

test("lexical scoring ranks a nurse role ahead of unrelated AI trainer role without vectors", () => {
  const nurse = {
    title: "ICU Staff Nurse",
    requirements: ["GNM", "ICU", "BLS", "Patient care"],
    tags: ["nursing", "critical care"],
    rawDescription: "Three years of nursing experience preferred.",
    location: "Kochi, Kerala, India",
    remoteType: "onsite",
    postedDateKnown: false,
    locationTier: 1,
  };
  const unrelated = {
    title: "AI Trainer",
    requirements: ["Python", "Machine learning", "LLM evaluation"],
    tags: ["AI", "machine learning"],
    rawDescription: "Train generative AI models.",
    location: "Remote",
    remoteType: "remote",
    postedDateKnown: false,
    locationTier: 2,
  };
  const nurseScore = scoreJobMatch(nurseProfile, nurse);
  const unrelatedScore = scoreJobMatch(nurseProfile, unrelated);
  assert.ok(nurseScore.score > unrelatedScore.score);
  assert.ok(nurseScore.score >= 50);
  assert.equal(nurseScore.scoreVersion, MATCH_SCORE_VERSION);
  assert.equal(nurseScore.band, "strong");
  assert.ok(nurseScore.reasons.length >= 2);
});

test("broad software-engineering targets recognize frontend and backend specializations", () => {
  const profile = {
    skills: ["TypeScript", "React", "Node.js", "MongoDB"].map((name) => ({ name })),
    roles: [{ title: "Software Engineer", years: 3 }],
    preferences: { targetRoles: ["Software Engineer"] },
  };
  const job = {
    title: "Frontend Engineer", requirements: ["TypeScript", "React", "CSS"],
    tags: ["TypeScript", "React"], rawDescription: "3 years experience",
    remoteType: "remote", location: "Remote", locationTier: 2,
    postedDateKnown: false,
  };
  const score = scoreJobMatch(profile, job);
  assert.ok(score.score >= 50);
  assert.ok(score.reasons.some((reason) => reason.includes("closely related")));
});

test("band labels include Low instead of dropping below-threshold jobs", () => {
  const low = scoreJobMatch({ skills: [], roles: [], preferences: {} }, {
    title: "Unrelated role", requirements: ["rare specialist topic"], rawDescription: "",
    location: "Remote", remoteType: "remote", postedDateKnown: false,
  });
  assert.ok(["low", "fair"].includes(low.band));
  if (low.score >= 40) assert.equal(low.band, "fair");
  else assert.equal(low.band, "low");
});

test("eligibility remains explicitly unknown and only a known country exclusion hard-blocks", () => {
  const profile = { skills: [], roles: [{ title: "Engineer" }], preferences: { preferredCountryCodes: ["IN"] } };
  const unknown = scoreJobMatch(profile, { title: "Engineer", rawDescription: "", location: "Remote", remoteType: "remote", structuredLocation: { remoteScope: "unknown", eligibleCountryCodes: [] } });
  const excluded = scoreJobMatch(profile, { title: "Engineer", rawDescription: "", location: "Remote", remoteType: "remote", structuredLocation: { remoteScope: "country", eligibleCountryCodes: ["US"] } });
  assert.equal(unknown.eligibility, "unknown");
  assert.equal(unknown.hardBlocked, false);
  assert.equal(excluded.eligibility, "excluded");
  assert.equal(excluded.hardBlocked, true);
});

test("15 role-family fixtures prefer the matching occupation over an unrelated AI Trainer role", () => {
  const fixtures = [
    ["Staff Nurse", ["GNM", "ICU"], "ICU Staff Nurse"],
    ["Backend Engineer", ["Node.js", "MongoDB"], "Backend Engineer"],
    ["Accountant", ["Accounting", "Excel"], "Senior Accountant"],
    ["Mathematics Teacher", ["Teaching", "Curriculum"], "Mathematics Teacher"],
    ["Frontend Engineer", ["React", "JavaScript"], "Frontend Engineer"],
    ["Data Analyst", ["SQL", "Python"], "Data Analyst"],
    ["Customer Support", ["Customer service"], "Customer Support Specialist"],
    ["Pharmacist", ["Pharmacy"], "Hospital Pharmacist"],
    ["Civil Engineer", ["Civil engineering"], "Civil Site Engineer"],
    ["HR Manager", ["Recruiting"], "Human Resources Manager"],
    ["Graphic Designer", ["Figma"], "Graphic Designer"],
    ["Marketing Manager", ["Marketing"], "Digital Marketing Manager"],
    ["Business Analyst", ["Analysis"], "Business Analyst"],
    ["DevOps Engineer", ["Kubernetes"], "DevOps Engineer"],
    ["Project Manager", ["Project management"], "Project Manager"],
  ];
  for (const [role, skills, goodTitle] of fixtures) {
    const profile = { roles: [{ title: role }], skills: skills.map((name) => ({ name })), preferences: { targetRoles: [role] } };
    const good = scoreJobMatch(profile, { title: goodTitle, requirements: skills, tags: skills, rawDescription: "", remoteType: "remote", location: "Remote", postedDateKnown: false });
    const unrelated = scoreJobMatch(profile, { title: "AI Trainer", requirements: ["LLM evaluation"], tags: ["machine learning"], rawDescription: "", remoteType: "remote", location: "Remote", postedDateKnown: false });
    assert.ok(good.score > unrelated.score, `${role} should outrank unrelated AI Trainer`);
  }
});
