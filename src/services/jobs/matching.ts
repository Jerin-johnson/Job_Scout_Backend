import { normalizeRoleForMatching } from "./roleNormalization.js";
import { env } from "../../config/env.js";
import { classifyEligibility, profileApplicantCountries } from "./eligibility.js";
import { classifyJobOccupation } from "./occupationClassification.js";

/** Deterministic, provider-free job feature extraction and profile matching. */
export const MATCH_SCORE_VERSION = env.JOB_MATCH_SCORE_VERSION;
export const MATCH_SCORE_WEIGHTS = Object.freeze({
  skills: 40,
  title: 20,
  experience: 15,
  location: 15,
  salary: 5,
  recency: 5,
});
// New, versioned scoring contract. v2 and v3 remain unchanged.
export const LEXICAL_V4_WEIGHTS = Object.freeze({
  skills: 32,
  title: 22,
  experience: 10,
  location: 12,
  salary: 5,
  recency: 5,
  occupation: 8,
  seniority: 3,
  eligibility: 3,
});

const ALIASES = new Map<string, string>([
  ["js", "javascript"],
  ["node", "node.js"],
  ["nodejs", "node.js"],
  ["postgres", "postgresql"],
  ["mongo", "mongodb"],
  ["icu", "critical care"],
  ["gnm", "general nursing midwifery"],
  ["bsc nursing", "nursing"],
  ["registered nurse", "nursing"],
  ["rn", "nursing"],
  ["staff nurse", "nursing"],
  ["accountant", "accounting"],
  ["teacher", "teaching"],
]);
const OCCUPATION_GROUPS: string[][] = [
  ["nurse", "nursing", "gnm", "icu", "critical care", "staff nurse", "registered nurse"],
  ["teacher", "teaching", "educator", "tutor"],
  ["accountant", "accounting", "bookkeeper", "finance"],
  ["backend", "back end", "server side", "api engineer"],
  ["frontend", "front end", "ui engineer", "web developer"],
  ["data analyst", "business analyst", "analytics"],
];
const LICENSE_TERMS: string[] = [
  "license",
  "licence",
  "registered nurse",
  "rn",
  "bls",
  "acls",
  "cpr",
  "dha",
  "nmc",
  "b.ed",
  "cpa",
  "acca",
  "cfa",
  "pmp",
];

function normalize(value = ""): string {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.+#]+/gu, " ")
    .trim();
}
function terms(value = ""): string[] {
  return normalize(value)
    .split(/\s+/)
    .filter((part) => part.length > 1);
}
export function canonicalSkill(value: unknown): string {
  const valueNormalized = normalize(String(value || ""));
  return ALIASES.get(valueNormalized) || valueNormalized;
}
function includesPhrase(text: string, phrase: string): boolean {
  const normalizedText = ` ${normalize(text)} `;
  return normalizedText.includes(` ${normalize(phrase)} `);
}

export function annualComparableAmount(
  {
    amount,
    currency,
    period,
  }: {
    amount?: number | string | null;
    currency?: string | null;
    period?: string | null;
  },
  targetCurrency: string | null | undefined,
  ratesPerEur: Record<string, number> | Map<string, number> | null = null,
): number | null {
  const value = Number(amount);
  const code = String(currency || "").toUpperCase();
  const cadence = String(period || "").toLowerCase();
  if (!Number.isFinite(value) || value <= 0 || !targetCurrency) return null;
  const target = String(targetCurrency).toUpperCase();
  const rates =
    ratesPerEur instanceof Map
      ? Object.fromEntries(ratesPerEur)
      : (ratesPerEur as Record<string, number> | null) || {};
  let comparable = value;
  if (code !== target) {
    if (!Number(rates[code]) || !Number(rates[target])) return null;
    comparable = (value / Number(rates[code])) * Number(rates[target]);
  }
  if (cadence === "year" || cadence === "annual") return comparable;
  if (cadence === "month" || cadence === "monthly") return comparable * 12;
  if (cadence === "yearly") return comparable;
  return null;
}

export interface ExtractedJobFeatures {
  version: number;
  skills: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  titleTokens: string[];
  companyTokens: string[];
  occupation: string;
  experienceYears: number | null;
  seniority: string;
  education: string[];
  licenses: string[];
  employmentType: string;
  workMode: string;
  eligibilityHints: string[];
  salaryText: string;
  responsibilities: string[];
}

export interface JobForFeatureExtractionLike {
  title?: string;
  rawDescription?: string;
  requirements?: string[];
  tags?: string[];
  company?: string;
  occupation?: string;
  remoteType?: string;
  employmentType?: string;
  compensation?: {
    originalText?: string;
    currency?: string;
    payPeriod?: string;
    min?: number;
    max?: number;
    normalizedAnnualMax?: number;
    normalizedCurrency?: string;
  };
  salaryText?: string;
  locationTier?: number;
  postedDateKnown?: boolean;
  postedAt?: Date | string | null;
  structuredLocation?: {
    eligibleCountryCodes?: string[];
    countryCode?: string;
    remoteScope?: string;
    [key: string]: unknown;
  };
  eligibility?: {
    evidence?: string;
    countries?: string[];
    remoteScope?: string;
    [key: string]: unknown;
  };
  features?: unknown;
  [key: string]: unknown;
}

export function extractJobFeatures(job: JobForFeatureExtractionLike = {}): ExtractedJobFeatures {
  const title = String(job.title || "");
  const description = String(job.rawDescription || "").slice(0, 24000);
  const requirementText = [...(job.requirements || []), ...(job.tags || [])].join(" ");
  const text = `${title} ${requirementText} ${description}`;
  const requiredSkills: string[] = [];
  const preferredSkills: string[] = [];
  for (const requirement of job.requirements || []) {
    const normalized = normalize(requirement);
    if (
      !normalized ||
      normalized.length > 80 ||
      /\b\d+\+?\s+years?\b|experience|responsibilit|qualification|work authorization/i.test(
        normalized,
      )
    )
      continue;
    const target = /\b(preferred|nice to have|bonus|desirable)\b/i.test(normalized)
      ? preferredSkills
      : requiredSkills;
    target.push(canonicalSkill(requirement));
  }
  const skillCandidates = new Set<string>([
    ...terms(requirementText),
    ...terms(title),
    ...(job.requirements || []).map(canonicalSkill),
    ...(job.tags || []).map(canonicalSkill),
  ]);
  for (const [alias, replacement] of ALIASES) {
    if (includesPhrase(text, alias)) skillCandidates.add(replacement);
  }
  const skills = [...skillCandidates].map(canonicalSkill).filter(Boolean).slice(0, 100);
  const years = [...text.matchAll(/(?:minimum\s+of\s+)?(\d{1,2})\+?\s+years?/gi)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const experienceYears = years.length ? Math.min(...years) : null;
  const lower = text.toLowerCase();
  const seniority = /\b(intern|internship|fresher|graduate|entry.level)\b/.test(lower)
    ? "entry"
    : /\b(principal|staff engineer|director|head of|vp|vice president)\b/.test(lower)
      ? "senior"
      : /\b(senior|lead|manager|experienced)\b/.test(lower)
        ? "mid_senior"
        : "mid";
  const classifiedOccupation =
    job.occupation && job.occupation !== "unclassified"
      ? job.occupation
      : classifyJobOccupation(job).occupation;
  const occupation = classifiedOccupation === "nursing" ? "nurse" : classifiedOccupation;
  const licenses = LICENSE_TERMS.filter((term) => includesPhrase(text, term));
  const education = [
    ...new Set(
      (text.match(/\b(?:bachelor|master|b\.sc|b\.tech|m\.tech|phd|diploma|degree)\b/gi) || []).map(
        normalize,
      ),
    ),
  ];
  const workMode =
    job.remoteType ||
    (/\b(remote|work from home|distributed)\b/i.test(text) ? "remote" : "unknown");
  const eligibilityHints = [
    ...new Set(
      (text.match(/\b(?:us|usa|united states|eu|europe|india|uk|gulf|uae)\s+only\b/gi) || []).map(
        normalize,
      ),
    ),
  ];
  const employmentType =
    job.employmentType ||
    (/\bintern(ship)?\b/i.test(text)
      ? "internship"
      : /\bpart[ -]time\b/i.test(text)
        ? "part-time"
        : /\bcontract(or)?\b/i.test(text)
          ? "contract"
          : /\bfull[ -]time\b/i.test(text)
            ? "full-time"
            : "unknown");
  const responsibilities = [
    ...new Set(
      (
        description.match(
          /[^.!?\n]{0,180}\b(?:responsible for|duties include|you will|will manage|will develop|provide care|oversee|lead a team)\b[^.!?\n]{0,180}[.!?]?/gi,
        ) || []
      ).map((item) => item.trim()),
    ),
  ].slice(0, 5);
  return {
    version: 1,
    skills,
    requiredSkills: [...new Set(requiredSkills)].slice(0, 60),
    preferredSkills: [...new Set(preferredSkills)].slice(0, 60),
    titleTokens: terms(title),
    companyTokens: terms(job.company || ""),
    occupation,
    experienceYears,
    seniority,
    education: education.slice(0, 12),
    licenses,
    employmentType,
    workMode,
    eligibilityHints,
    salaryText: String(job.compensation?.originalText || job.salaryText || "").slice(0, 300),
    responsibilities,
  };
}

export interface ProfileForMatchLike {
  skills?: Array<{ name?: string } | string>;
  preferences?: {
    targetRoles?: string[];
    minimumSalaryUsd?: number;
    preferredCountryCodes?: string[];
  } | Record<string, unknown> | null;
  careerProfile?: {
    targetRoles?: Array<{ customRoleLabel?: string; roleCode?: string }>;
    experience?: {
      isFresher?: boolean;
      needsConfirmation?: boolean;
      confirmedYears?: number | null;
    };
    compensation?: {
      currencyCode?: string;
      minimumAmount?: number;
      period?: string;
    };
    homeLocation?: { countryCode?: string; scope?: string };
    targetLocations?: Array<{ countryCode?: string; scope?: string }>;
    workAuthorization?: {
      sponsorshipOrRelocation?: {
        countryCodes?: string[];
      };
    };
  };
  roles?: unknown[] | null;
}

function roleSimilarity(
  profile: ProfileForMatchLike,
  features: ExtractedJobFeatures,
  title: string | undefined,
  version: string,
): number {
  const pref = (profile.preferences || {}) as Record<string, unknown>;
  const careerTargets = (profile.careerProfile?.targetRoles || []).map(
    (role) => role.customRoleLabel || String(role.roleCode || "").replace(/[-_]+/g, " "),
  );
  const roleTerms = [
    ...((pref.targetRoles as string[] | undefined) || []),
    ...careerTargets,
    ...(profile.roles || []).map((role) =>
      typeof role === "object" && role !== null && "title" in role
        ? String((role as { title?: unknown }).title || "")
        : "",
    ),
  ]
    .map((role) => normalize(version === "lexical-v3" ? normalizeRoleForMatching(role) : role))
    .filter(Boolean);
  if (!roleTerms.length) return features.occupation ? 0.5 : 0.35;
  const titleText = normalize(title);
  if (roleTerms.some((role) => titleText.includes(role) || role.includes(titleText))) return 1;
  const softwareRolePattern =
    /\b(software|backend|back end|frontend|front end|full stack|web|api)\b/;
  const softwareRoleTitlePattern =
    /\b(software engineer|software developer|backend|front end|frontend|full stack|web developer|api engineer|application developer)\b/;
  if (
    roleTerms.some((role) => softwareRolePattern.test(role)) &&
    softwareRoleTitlePattern.test(titleText)
  )
    return 0.75;
  const normalizedRoles = roleTerms.flatMap(
    (role) =>
      OCCUPATION_GROUPS.find((group) => group.some((term) => role.includes(term))) || [role],
  );
  const group = OCCUPATION_GROUPS.find((items) => items.some((term) => titleText.includes(term)));
  if (group && normalizedRoles.some((role) => group.some((term) => role.includes(term))))
    return 0.85;
  const titleSet = new Set(terms(titleText));
  const best = Math.max(
    0,
    ...roleTerms.map((role) => {
      const rt = terms(role);
      return rt.length ? rt.filter((term) => titleSet.has(term)).length / rt.length : 0;
    }),
  );
  return best;
}

export interface JobMatchBreakdown {
  skills: number;
  title: number;
  experience: number;
  location: number;
  salary: number;
  recency: number;
  occupation?: number;
  seniority?: number;
  eligibility?: number;
}

export interface JobMatchScoreResult {
  score: number;
  band: "strong" | "good" | "fair" | "low";
  reasons: string[];
  matchingSkills: string[];
  missingSkills: string[];
  scoreVersion: string;
  confidence?: "medium" | "low";
  breakdown: JobMatchBreakdown;
  eligibility: string;
  eligibilityDetails: unknown;
  hardBlocked: boolean;
  gaps: {
    missingRequiredSkills: string[];
    missingPreferredSkills: string[];
  };
  features: ExtractedJobFeatures;
}

export function scoreJobMatch(
  profile: ProfileForMatchLike = {},
  job: JobForFeatureExtractionLike = {},
  {
    now = new Date(),
    version = MATCH_SCORE_VERSION,
    ratesPerEur = null,
  }: {
    now?: Date;
    version?: string;
    ratesPerEur?: Record<string, number> | Map<string, number> | null;
  } = {},
): JobMatchScoreResult {
  const features =
    typeof job.features === "object" && job.features !== null && (job.features as { version?: number }).version === 1
      ? (job.features as ExtractedJobFeatures)
      : extractJobFeatures(job);
  const profileSkills = new Set(
    (profile.skills || []).map((skill) =>
      typeof skill === "string" ? canonicalSkill(skill) : canonicalSkill(skill?.name),
    ),
  );
  const jobSkills = new Set(features.skills.map(canonicalSkill));
  const required = (job.requirements || []).map(canonicalSkill).filter(Boolean);
  const overlap = [...profileSkills].filter(
    (skill) => jobSkills.has(skill) || required.includes(skill),
  );
  const requiredFeatures = features.requiredSkills?.length
    ? features.requiredSkills.map(canonicalSkill)
    : required;
  const denominator = Math.max(
    1,
    Math.min(7, requiredFeatures.length || jobSkills.size || profileSkills.size),
  );
  const skillRatio = Math.min(1, overlap.length / denominator);
  const titleFit = roleSimilarity(profile, features, job.title, version);
  const roleYears = (profile.roles || []).map((role) => {
    if (typeof role !== "object" || role === null) return 0;
    const r = role as { years?: unknown; startDate?: unknown; endDate?: unknown; isCurrent?: unknown };
    if (Number(r.years) > 0) return Number(r.years);
    const start = Date.parse(String(r.startDate || ""));
    const end = r.isCurrent || !r.endDate ? now.getTime() : Date.parse(String(r.endDate));
    return Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? (end - start) / (365.25 * 86400000)
      : 0;
  });
  const confirmedCareerExperience = profile.careerProfile?.experience;
  const careerYears = confirmedCareerExperience?.isFresher
    ? 0
    : !confirmedCareerExperience?.needsConfirmation &&
        confirmedCareerExperience?.confirmedYears !== null &&
        confirmedCareerExperience?.confirmedYears !== undefined
      ? Number(confirmedCareerExperience.confirmedYears)
      : 0;
  const profileYears = Math.max(careerYears, 0, ...roleYears);
  const experienceFit =
    features.experienceYears === null || features.experienceYears === undefined || !profileYears
      ? 0.55
      : profileYears >= features.experienceYears
        ? 1
        : Math.max(0.25, profileYears / features.experienceYears);
  const pref = (profile.preferences || {}) as Record<string, unknown>;
  const tier = job.locationTier || 2;
  const locationFit = Math.max(0.35, 1 - (tier - 1) * 0.15);
  const desiredCompensation = profile.careerProfile?.compensation;
  const targetCurrency =
    desiredCompensation?.currencyCode || (Number(pref.minimumSalaryUsd || 0) > 0 ? "USD" : null);
  const targetMinimum =
    desiredCompensation?.minimumAmount ?? (pref.minimumSalaryUsd as number | undefined);
  const targetAnnualMinimum = annualComparableAmount(
    {
      amount: targetMinimum,
      currency: targetCurrency,
      period: desiredCompensation?.period || "annual",
    },
    targetCurrency,
    ratesPerEur,
  );
  const normalizedAnnualMax = job.compensation?.normalizedAnnualMax;
  const normalizedAnnualCurrency = job.compensation?.normalizedCurrency;
  const jobSalaryMax =
    normalizedAnnualMax && normalizedAnnualCurrency
      ? annualComparableAmount(
          { amount: normalizedAnnualMax, currency: normalizedAnnualCurrency, period: "annual" },
          targetCurrency,
          ratesPerEur,
        )
      : annualComparableAmount(
          {
            amount: job.compensation?.max,
            currency: job.compensation?.currency,
            period: job.compensation?.payPeriod,
          },
          targetCurrency,
          ratesPerEur,
        );
  const salaryFit =
    !targetAnnualMinimum || !jobSalaryMax ? 0.6 : jobSalaryMax >= targetAnnualMinimum ? 1 : 0.25;
  const ageDays =
    job.postedDateKnown && job.postedAt
      ? Math.max(0, (now.getTime() - new Date(job.postedAt).getTime()) / 86400000)
      : 30;
  const recencyFit = job.postedDateKnown ? Math.max(0.1, 1 - ageDays / 60) : 0.35;
  const eligibilityDetails = classifyEligibility(
    job as unknown as Record<string, unknown>,
    profile as unknown as Record<string, unknown>,
  );
  const preferredCountries = profileApplicantCountries(profile as unknown as Record<string, unknown>);
  const profileHasApplicantCountry = preferredCountries.length > 0;
  const eligibleCountries = (
    ((job.structuredLocation?.eligibleCountryCodes as string[] | undefined) || [])
  ).map((code) => String(code).toUpperCase());
  const explicitCountry = String(job.structuredLocation?.countryCode || "").toUpperCase();
  const legacyEligibility = !preferredCountries.length
    ? "unknown"
    : eligibleCountries.some((code) => preferredCountries.includes(code)) ||
        preferredCountries.includes(explicitCountry) ||
        job.structuredLocation?.remoteScope === "worldwide"
      ? "eligible"
      : eligibleCountries.length
        ? "excluded"
        : "unknown";
  const eligibility =
    eligibilityDetails.status === "unknown" && legacyEligibility !== "unknown"
      ? legacyEligibility
      : eligibilityDetails.status === "not_open"
        ? "excluded"
        : eligibilityDetails.status;
  const jobHasEligibilityEvidence = Boolean(
    job.eligibility?.evidence ||
      job.eligibility?.countries?.length ||
      (job.eligibility?.remoteScope && job.eligibility.remoteScope !== "unknown") ||
      job.structuredLocation?.countryCode ||
      (job.structuredLocation?.eligibleCountryCodes as unknown[] | undefined)?.length ||
      (job.structuredLocation?.remoteScope && job.structuredLocation.remoteScope !== "unknown"),
  );
  const eligibilityScore =
    !profileHasApplicantCountry || !jobHasEligibilityEvidence
      ? 0
      : eligibility === "eligible"
        ? LEXICAL_V4_WEIGHTS.eligibility
        : eligibility === "unknown"
          ? -2
          : -LEXICAL_V4_WEIGHTS.eligibility;
  const requiredText = (job.requirements || []).join(" ").toLowerCase();
  const requiredLicenses = (features.licenses || []).filter((license) =>
    new RegExp(
      `(?:${license.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}).{0,24}(?:required|mandatory|must have)`,
      "i",
    ).test(requiredText),
  );
  const missingRequiredLicense = requiredLicenses.some(
    (license) => !profileSkills.has(canonicalSkill(license)),
  );
  const v4 = version === "lexical-v4";
  const profileRoleTitles = [
    ...((pref.targetRoles as string[] | undefined) || []),
    ...(profile.careerProfile?.targetRoles || []).map(
      (role) => role.customRoleLabel || String(role.roleCode || "").replace(/[-_]+/g, " "),
    ),
    ...(profile.roles || []).map((role) =>
      typeof role === "string"
        ? role
        : role && typeof role === "object" && "title" in role
          ? String((role as { title?: unknown }).title || "")
          : "",
    ),
  ].filter(Boolean);
  const profileOccupationFamilies = profileRoleTitles
    .map((role) => classifyJobOccupation({ title: role }).occupation)
    .filter((family) => family && family !== "unclassified");
  const jobOccupationFamily =
    job.occupation && job.occupation !== "unclassified"
      ? job.occupation
      : classifyJobOccupation(job).occupation;
  const occupationFit =
    jobOccupationFamily && profileOccupationFamilies.includes(jobOccupationFamily);
  const hardBlocked = eligibility === "excluded" || missingRequiredLicense;
  const weights = MATCH_SCORE_WEIGHTS;
  const score = Math.round(
    v4
      ? skillRatio * LEXICAL_V4_WEIGHTS.skills +
          titleFit * LEXICAL_V4_WEIGHTS.title +
          experienceFit * LEXICAL_V4_WEIGHTS.experience +
          locationFit * LEXICAL_V4_WEIGHTS.location +
          salaryFit * LEXICAL_V4_WEIGHTS.salary +
          recencyFit * LEXICAL_V4_WEIGHTS.recency +
          (occupationFit ? LEXICAL_V4_WEIGHTS.occupation : 0) +
          (profile.careerProfile?.experience?.isFresher && features.seniority === "entry"
            ? LEXICAL_V4_WEIGHTS.seniority
            : 0) +
          eligibilityScore
      : skillRatio * weights.skills +
          titleFit * weights.title +
          experienceFit * weights.experience +
          locationFit * weights.location +
          salaryFit * weights.salary +
          recencyFit * weights.recency,
  );
  const fairThreshold = version === "lexical-v2" ? 40 : 50;
  const band =
    score >= 80 ? "strong" : score >= 65 ? "good" : score >= fairThreshold ? "fair" : "low";
  const reasons = [
    `${overlap.length} of ${Math.max(1, requiredFeatures.length || jobSkills.size)} listed skills match`,
    titleFit >= 0.7
      ? "Role title is closely related to your target"
      : "Role title is a partial fit",
    tier === 1
      ? "Matches your preferred location"
      : job.remoteType === "remote"
        ? `Remote role; eligibility ${eligibility}`
        : "Location fit is approximate",
    ...(v4 &&
    !profile.roles?.length &&
    !confirmedCareerExperience?.isFresher &&
    confirmedCareerExperience?.needsConfirmation !== false
      ? ["Role facts are missing or unconfirmed; confirm experience for a more reliable estimate"]
      : []),
  ];
  const missingRequired = [...new Set(requiredFeatures)]
    .filter((skill) => !profileSkills.has(skill))
    .slice(0, 12);
  return {
    score: Math.max(0, Math.min(100, score)),
    band,
    reasons,
    matchingSkills: overlap.slice(0, 20),
    missingSkills: missingRequired,
    scoreVersion: version,
    confidence: v4
      ? profile.roles?.length ||
        confirmedCareerExperience?.isFresher ||
        confirmedCareerExperience?.needsConfirmation === false
        ? "medium"
        : "low"
      : undefined,
    breakdown: {
      skills: skillRatio,
      title: titleFit,
      experience: experienceFit,
      location: locationFit,
      salary: salaryFit,
      recency: recencyFit,
      ...(v4
        ? {
            occupation: occupationFit ? 1 : 0,
            seniority:
              profile.careerProfile?.experience?.isFresher && features.seniority === "entry"
                ? 1
                : 0,
            eligibility: eligibilityScore,
          }
        : {}),
    },
    eligibility,
    eligibilityDetails,
    hardBlocked,
    gaps: {
      missingRequiredSkills: missingRequired,
      missingPreferredSkills: (features.preferredSkills || [])
        .map(canonicalSkill)
        .filter((skill) => !profileSkills.has(skill))
        .slice(0, 12),
    },
    features,
  };
}
