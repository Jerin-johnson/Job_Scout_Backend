import { scoreJobMatch } from "../src/domain/services/jobs/matching.js";
import { pathToFileURL } from "node:url";

export const fixtures = [
  {
    name: "existing-nurse",
    profile: {
      skills: ["GNM", "ICU", "BLS"].map((name) => ({ name })),
      roles: [{ title: "Staff Nurse", years: 3 }],
      preferences: { targetRoles: ["Staff Nurse"] },
    },
    job: {
      title: "ICU Staff Nurse",
      requirements: ["GNM", "ICU", "BLS"],
      rawDescription: "3 years experience",
      remoteType: "onsite",
      locationTier: 1,
    },
  },
  {
    name: "existing-accountant",
    profile: {
      skills: [{ name: "Accounting" }],
      roles: [{ title: "Accountant" }],
      preferences: { targetRoles: ["Accountant"] },
    },
    job: {
      title: "Senior Accountant",
      requirements: ["Accounting"],
      rawDescription: "",
      remoteType: "onsite",
      locationTier: 1,
    },
  },
  {
    name: "existing-teacher",
    profile: {
      skills: [{ name: "Teaching" }],
      roles: [{ title: "Teacher" }],
      preferences: { targetRoles: ["Teacher"] },
    },
    job: {
      title: "Mathematics Teacher",
      requirements: ["Teaching"],
      rawDescription: "",
      remoteType: "onsite",
      locationTier: 1,
    },
  },
  {
    name: "existing-frontend",
    profile: {
      skills: [{ name: "React" }],
      roles: [{ title: "Software Engineer" }],
      preferences: { targetRoles: ["Software Engineer"] },
    },
    job: {
      title: "Frontend Engineer",
      requirements: ["React"],
      rawDescription: "",
      remoteType: "remote",
      locationTier: 2,
    },
  },
  ...[
    ["existing-pharmacist", "Pharmacist", ["Pharmacy"], "Hospital Pharmacist"],
    ["existing-civil-engineer", "Civil Engineer", ["Civil engineering"], "Civil Site Engineer"],
    ["existing-hr", "HR Manager", ["Recruiting"], "Human Resources Manager"],
    ["existing-designer", "Graphic Designer", ["Figma"], "Graphic Designer"],
    ["existing-marketing", "Marketing Manager", ["Marketing"], "Digital Marketing Manager"],
    ["existing-business-analyst", "Business Analyst", ["Analysis"], "Business Analyst"],
    ["existing-devops", "DevOps Engineer", ["Kubernetes"], "DevOps Engineer"],
    ["existing-project-manager", "Project Manager", ["Project management"], "Project Manager"],
    [
      "existing-customer-support",
      "Customer Support",
      ["Customer service"],
      "Customer Support Specialist",
    ],
    ["existing-data-analyst", "Data Analyst", ["SQL", "Python"], "Data Analyst"],
    ["existing-backend", "Backend Engineer", ["Node.js", "MongoDB"], "Backend Engineer"],
  ].map(([name, role, skills, title]) => ({
    name,
    profile: {
      skills: skills.map((item) => ({ name: item })),
      roles: [{ title: role }],
      preferences: { targetRoles: [role] },
    },
    job: { title, requirements: skills, rawDescription: "", remoteType: "remote", locationTier: 2 },
  })),
  {
    name: "new-resume-role-typo",
    profile: {
      skills: [{ name: "JavaScript" }, { name: "React" }],
      roles: [],
      preferences: { targetRoles: ["software engierer"] },
    },
    job: {
      title: "Platform Engineer",
      requirements: ["JavaScript", "React", "TypeScript", "Python"],
      rawDescription: "",
      remoteType: "remote",
      locationTier: 2,
    },
  },
  {
    name: "new-nursing-role",
    profile: {
      skills: [{ name: "GNM" }, { name: "ICU" }],
      roles: [{ title: "ICU Nurse" }],
      preferences: { targetRoles: ["ICU Nurse"] },
    },
    job: {
      title: "Critical Care Nurse",
      requirements: ["GNM", "ICU"],
      rawDescription: "",
      remoteType: "onsite",
      locationTier: 1,
    },
  },
  {
    name: "new-delivery-role",
    profile: {
      skills: [{ name: "route planning" }],
      roles: [{ title: "Delivery Associate" }],
      preferences: { targetRoles: ["Delivery Associate"] },
    },
    job: {
      title: "Courier Delivery Driver",
      requirements: ["route planning"],
      rawDescription: "",
      remoteType: "onsite",
      locationTier: 1,
    },
  },
  {
    name: "new-confirmed-fresher-requirement",
    profile: {
      skills: [{ name: "Nursing" }, { name: "BLS" }],
      roles: [],
      preferences: { targetRoles: ["Staff Nurse"] },
      careerProfile: {
        experience: { isFresher: true, needsConfirmation: false, confirmedYears: 0 },
      },
    },
    job: {
      title: "Staff Nurse",
      requirements: ["Nursing", "BLS", "2 years experience"],
      rawDescription: "Two years of hospital experience preferred.",
      remoteType: "onsite",
      locationTier: 1,
    },
  },
];

const rows = fixtures.map(({ name, profile, job }) => {
  const v2 = scoreJobMatch(profile, job, { version: "lexical-v2" });
  const v2_1 = scoreJobMatch(profile, job, { version: "lexical-v2.1" });
  const v3 = scoreJobMatch(profile, job, { version: "lexical-v3" });
  return {
    fixture: name,
    v2: v2.score,
    v2Band: v2.band,
    v2_1: v2_1.score,
    v2_1Band: v2_1.band,
    v3: v3.score,
    v3Band: v3.band,
    delta: v3.score - v2.score,
    v2_1Delta: v2_1.score - v2.score,
  };
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(
    [
      "fixture | v2 | v2.1 | v3 | v3-v2 delta | v2.1-v2 delta",
      ...rows.map(
        (row) =>
          `${row.fixture} | ${row.v2} (${row.v2Band}) | ${row.v2_1} (${row.v2_1Band}) | ${row.v3} (${row.v3Band}) | ${row.delta >= 0 ? "+" : ""}${row.delta} | ${row.v2_1Delta >= 0 ? "+" : ""}${row.v2_1Delta}`,
      ),
    ].join("\n"),
  );
  const regressedExisting = rows.filter(
    (row) => row.fixture.startsWith("existing-") && row.delta < 0,
  );
  const improvedNew = rows.filter((row) => row.fixture.startsWith("new-") && row.delta > 0);
  const v2_1ExistingRegressions = rows.filter(
    (row) => row.fixture.startsWith("existing-") && row.v2_1Delta < 0,
  );
  const fresherBehavior = rows.find((row) => row.fixture === "new-confirmed-fresher-requirement");
  console.log(
    `v3 existing regressions: ${regressedExisting.length}; v3 new fixture improvements: ${improvedNew.length}/${rows.filter((row) => row.fixture.startsWith("new-")).length}; v2.1 existing regressions: ${v2_1ExistingRegressions.length}; confirmed-fresher experience adjustment: ${fresherBehavior?.v2_1Delta < 0 ? "PASS" : "FAIL"}`,
  );
  if (v2_1ExistingRegressions.length || !(fresherBehavior?.v2_1Delta < 0))
    console.log("The v2.1 behavior gate did not pass; default remains lexical-v2.");
  else console.log("The v2.1 fixture gate passes; default selected as lexical-v2.1.");
  if (regressedExisting.length || improvedNew.length === 0)
    console.log("The v3 ship gate did not pass; lexical-v2.1 remains the selected default.");
  else console.log("The fixture gate passes; review before changing the configured default.");
}
