import { ROLE_SUGGESTIONS } from "../profileSuggestionCatalog.js";
import { ONET_SUBSET } from "./referenceData/index.js";

const ROLE_CATALOG = [
  {
    canonical: "Software Engineer",
    aliases: ["software engineer", "software developer", "software engineering"],
  },
  {
    canonical: "Backend Engineer",
    aliases: ["backend engineer", "back end engineer", "api engineer", "server side engineer"],
  },
  {
    canonical: "Frontend Engineer",
    aliases: ["frontend engineer", "front end engineer", "web developer", "ui engineer"],
  },
  {
    canonical: "Full Stack Engineer",
    aliases: ["full stack engineer", "fullstack engineer", "full stack developer"],
  },
  {
    canonical: "Staff Nurse",
    aliases: ["staff nurse", "registered nurse", "nurse", "nursing", "gnm", "icu nurse"],
  },
  { canonical: "Accountant", aliases: ["accountant", "accounting", "bookkeeper"] },
  { canonical: "Teacher", aliases: ["teacher", "teaching", "educator", "tutor"] },
  {
    canonical: "Data Analyst",
    aliases: ["data analyst", "analytics analyst", "reporting analyst"],
  },
  ...ROLE_SUGGESTIONS.map(({ label, aliases }) => ({ canonical: label, aliases })),
  ...ONET_SUBSET.occupations.map(({ label, aliases }) => ({ canonical: label, aliases })),
];

function normalize(value = "") {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    for (let column = 0; column <= right.length; column += 1) previous[column] = current[column];
  }
  return previous[right.length];
}

function similarity(left, right) {
  if (!left || !right) return 0;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

function bestRoleMatch(value) {
  const normalized = normalize(value);
  if (!normalized) return null;

  for (const entry of ROLE_CATALOG) {
    if (entry.aliases.some((alias) => normalize(alias) === normalized)) {
      return { canonical: entry.canonical, confidence: 1, exact: true };
    }
  }

  let best = null;
  const inputTokens = normalized.split(" ");
  for (const entry of ROLE_CATALOG) {
    for (const alias of entry.aliases) {
      const candidate = normalize(alias);
      const candidateTokens = candidate.split(" ");
      if (!inputTokens.some((token) => candidateTokens.includes(token))) continue;
      const confidence = similarity(normalized, candidate);
      if (confidence >= 0.82 && (!best || confidence > best.confidence)) {
        best = { canonical: entry.canonical, confidence, exact: false };
      }
    }
  }
  return best;
}

/** Return a canonical role only when the role is an exact alias or a high-confidence typo match. */
export function normalizeRoleForMatching(value = "") {
  return bestRoleMatch(value)?.canonical || String(value).trim();
}

/** Suggestions are returned separately so callers can ask the user before saving any correction. */
export function suggestTargetRoleCorrections(profile = {}) {
  const preferences = profile.preferences || {};
  const targetRoles = (preferences.targetRoles || [])
    .map((role) => String(role).trim())
    .filter(Boolean);
  const profileRoles = (profile.roles || [])
    .map((role) => String(role.title || "").trim())
    .filter(Boolean);

  if (!targetRoles.length) {
    const uniqueProfileRoles = [...new Set(profileRoles)];
    return uniqueProfileRoles.slice(0, 3).map((role, index) => ({
      source: "resume",
      index,
      originalRole: "",
      suggestedRole: role,
      confidence: 1,
      proposedTargetRoles: uniqueProfileRoles,
    }));
  }

  return targetRoles.flatMap((role, index) => {
    const match = bestRoleMatch(role);
    if (!match || match.exact || normalize(role) === normalize(match.canonical)) return [];
    const proposedTargetRoles = [...targetRoles];
    proposedTargetRoles[index] = match.canonical;
    return [
      {
        source: "preference",
        index,
        originalRole: role,
        suggestedRole: match.canonical,
        confidence: Number(match.confidence.toFixed(2)),
        proposedTargetRoles,
      },
    ];
  });
}
