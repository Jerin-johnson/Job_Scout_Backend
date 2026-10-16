import test from "node:test";
import assert from "node:assert/strict";
import { extractJobFeatures, scoreJobMatch, MATCH_SCORE_VERSION, annualComparableAmount } from "../src/services/jobs/matching.js";
import { normalizeRoleForMatching, suggestTargetRoleCorrections } from "../src/services/jobs/roleNormalization.js";

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

test("score bands follow selected version with lexical-v2 as the default", () => {
  assert.equal(MATCH_SCORE_VERSION, "lexical-v2");
  const low = scoreJobMatch({ skills: [], roles: [], preferences: { targetRoles: ["Frontend Engineer"] } }, {
    title: "Frontend Engineer", requirements: [], rawDescription: "",
    location: "Remote", remoteType: "remote", postedDateKnown: false,
  }, { version: "lexical-v3" });
  assert.ok(low.score < 50);
  assert.equal(low.band, "low");
  const fair = scoreJobMatch({ skills: [], roles: [], preferences: { targetRoles: ["Frontend Engineer"] } }, {
    title: "Frontend Engineer", requirements: [], rawDescription: "",
    location: "Kochi", remoteType: "onsite", postedDateKnown: true, postedAt: new Date(), locationTier: 1,
  });
  assert.ok(fair.score >= 40);
  assert.equal(fair.band, "fair");
  assert.equal(scoreJobMatch({ skills: [], roles: [], preferences: { targetRoles: ["Frontend Engineer"] } }, {
    title: "Frontend Engineer", requirements: [], rawDescription: "",
    location: "Kochi", remoteType: "onsite", postedDateKnown: true, postedAt: new Date(), locationTier: 1,
  }, { version: "lexical-v3" }).scoreVersion, "lexical-v3");
});

test("salary comparison annualizes monthly pay only in the same currency and skips unsupported periods", () => {
  assert.equal(annualComparableAmount({ amount: 1000, currency: "USD", period: "month" }, "USD"), 12000);
  assert.equal(annualComparableAmount({ amount: 1000, currency: "INR", period: "month" }, "USD"), null);
  assert.equal(annualComparableAmount({ amount: 50, currency: "USD", period: "hour" }, "USD"), null);
  assert.equal(annualComparableAmount({ amount: 50, currency: "USD", period: "unknown" }, "USD"), null);
});

test("a typo-shaped target role suggests, but does not silently persist, the canonical role", () => {
  const profile = { skills: [], roles: [], preferences: { targetRoles: ["software engierer"] } };
  assert.equal(normalizeRoleForMatching(profile.preferences.targetRoles[0]), "Software Engineer");
  const [suggestion] = suggestTargetRoleCorrections(profile);
  assert.deepEqual(suggestion, {
    source: "preference",
    index: 0,
    originalRole: "software engierer",
    suggestedRole: "Software Engineer",
    confidence: 0.88,
    proposedTargetRoles: ["Software Engineer"],
  });
  assert.equal(profile.preferences.targetRoles[0], "software engierer");
});

test("resume role facts prefill target-role suggestions only when the preference is missing", () => {
  const profile = { skills: [], roles: [{ title: "Backend Engineer" }], preferences: { targetRoles: [] } };
  assert.equal(suggestTargetRoleCorrections(profile)[0].source, "resume");
  assert.deepEqual(suggestTargetRoleCorrections(profile)[0].proposedTargetRoles, ["Backend Engineer"]);
  assert.deepEqual(suggestTargetRoleCorrections({ ...profile, preferences: { targetRoles: ["Accountant"] } }), []);
});

test("real-profile-shaped typo, missing role facts, and unmatched location still produce explainable scores", () => {
  const profile = {
    skills: ["JavaScript", "React"].map((name) => ({ name })),
    roles: [],
    preferences: { targetRoles: ["software engierer"], preferredLocations: ["a free-text place not in the catalog"] },
  };
  const job = {
    title: "Platform Engineer",
    requirements: ["JavaScript", "React", "TypeScript", "Python"],
    tags: ["TypeScript", "Python"],
    rawDescription: "",
    remoteType: "remote",
    location: "Remote",
    locationTier: 2,
    postedDateKnown: false,
  };
  const score = scoreJobMatch(profile, job, { version: "lexical-v3" });
  assert.ok(score.score >= 50, `expected a role suggestion to recover the title match, got ${score.score}`);
  assert.equal(score.band, "fair");
  assert.equal(score.hardBlocked, false);
  const scoreWithoutTypoResolution = Math.round(
    score.breakdown.skills * 40 + score.breakdown.experience * 15 +
    score.breakdown.location * 15 + score.breakdown.salary * 5 + score.breakdown.recency * 5,
  );
  assert.ok(scoreWithoutTypoResolution < 50, "the typo-shaped profile would have been hidden by the former title score");
  assert.ok(score.reasons.length >= 2);
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
