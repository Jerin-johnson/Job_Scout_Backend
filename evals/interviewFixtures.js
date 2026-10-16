const roles = [
  ["engineering", "Backend Engineer"],
  ["product", "Product Manager"],
  ["data", "Data Analyst"],
  ["design", "Product Designer"],
  ["operations", "Operations Manager"],
];
const modes = ["hr", "founder", "technical", "behavioral", "aptitude_case"];
const answerPair = (role, family) => [
  {
    question: `Describe a measurable ${family} improvement you owned as a ${role}.`,
    answer: `I owned a ${family} workflow improvement. I first measured the baseline, then worked with two partners to test a smaller change. The cycle time fell by 18% over six weeks; I compared the same weekly dashboard before and after and documented the limits of that comparison.`,
  },
  {
    question: `What would you investigate if a key ${family} outcome declined?`,
    answer: `I would clarify the metric and time window, segment the data, and check instrumentation before choosing a cause. In a prior project I found one segment explained most of the decline, tested a targeted fix, and reviewed the result with the team before rollout.`,
  },
];

// Synthetic and non-identifying transcripts: every mode and role family appears three times.
export const interviewFixtures = Array.from({ length: 15 }, (_, index) => {
  const [roleFamily, role] = roles[index % roles.length];
  const mode = modes[Math.floor(index / 3)];
  return {
    id: `synthetic-${String(index + 1).padStart(2, "0")}`,
    roleFamily,
    role,
    level: ["fresher", "mid", "senior"][index % 3],
    mode,
    transcript: answerPair(role, roleFamily),
  };
});
