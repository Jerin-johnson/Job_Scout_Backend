import {
  ELIGIBILITY_REGION_ALIASES,
  ELIGIBILITY_REGIONS,
  ELIGIBILITY_REGION_CONFIG_VERSION,
} from "./eligibilityRegions.js";

const COUNTRY = new Map(
  Object.entries({
    india: "IN",
    "united states": "US",
    "united states of america": "US",
    usa: "US",
    us: "US",
    "united kingdom": "GB",
    uk: "GB",
    "great britain": "GB",
    ireland: "IE",
    canada: "CA",
    australia: "AU",
    "new zealand": "NZ",
    germany: "DE",
    france: "FR",
    spain: "ES",
    italy: "IT",
    netherlands: "NL",
    singapore: "SG",
    "united arab emirates": "AE",
    uae: "AE",
    "saudi arabia": "SA",
    qatar: "QA",
    japan: "JP",
    china: "CN",
    philippines: "PH",
    malaysia: "MY",
    indonesia: "ID",
    thailand: "TH",
    vietnam: "VN",
    pakistan: "PK",
    bangladesh: "BD",
    "sri lanka": "LK",
    nepal: "NP",
    oman: "OM",
    kuwait: "KW",
    bahrain: "BH",
    egypt: "EG",
    nigeria: "NG",
    kenya: "KE",
    "south africa": "ZA",
    sweden: "SE",
    norway: "NO",
    denmark: "DK",
    finland: "FI",
    switzerland: "CH",
    belgium: "BE",
    portugal: "PT",
    poland: "PL",
    austria: "AT",
    greece: "GR",
    ukraine: "UA",
    turkey: "TR",
    israel: "IL",
    mexico: "MX",
    brazil: "BR",
    argentina: "AR",
    chile: "CL",
    colombia: "CO",
  }),
);

function countryCodes(text: string): string[] {
  const normalized = String(text || "").toLowerCase();
  return [
    ...new Set(
      [...COUNTRY]
        .filter(([name]) =>
          new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalized),
        )
        .map(([, code]) => code),
    ),
  ];
}

export interface JobEligibility {
  version: number | string;
  countries: string[];
  remoteScope: string;
  sponsorship: boolean;
  workAuthorizationRequired: boolean;
  confidence: number;
  evidence: string;
}

export interface JobInputLike {
  location?: unknown;
  locations?: unknown;
  locationRestrictions?: unknown;
  country?: unknown;
  rawDescription?: unknown;
  tags?: unknown[];
  structuredLocation?: {
    eligibleCountryCodes?: string[];
    countryCode?: string;
    remoteScope?: string;
  };
  eligibility?: JobEligibility;
}

export interface ProfileInputLike {
  careerProfile?: {
    homeLocation?: { countryCode?: string; scope?: string };
    targetLocations?: Array<{ countryCode?: string; scope?: string }>;
    workAuthorization?: {
      sponsorshipOrRelocation?: {
        countryCodes?: string[];
      };
    };
  };
  preferences?: {
    preferredCountryCodes?: string[];
  };
}

export interface ClassifiedEligibility extends JobEligibility {
  status: "eligible" | "not_open" | "unknown";
  countryCode: string | null;
  reason?: string;
}

/** Deterministic, conservative eligibility parser. Missing evidence remains unknown. */
export function parseJobEligibility(job: JobInputLike = {}): JobEligibility {
  const sourceLocation = [
    job.location,
    job.locations,
    job.locationRestrictions,
    job.country,
    job.rawDescription,
    ...(job.tags || []),
  ]
    .flat()
    .filter(Boolean)
    .join(" | ")
    .slice(0, 5000);
  const rawEvidence =
    sourceLocation.match(
      /.{0,50}(?:worldwide|anywhere|us only|usa only|united states only|must be authorized|authorized to work|remote\s*\([^)]*\)|europe|eu|emea|apac|asia pacific|latam|latin america|north america|africa|timezone|time zone|india|united kingdom|ireland).{0,70}/i,
    )?.[0] || "";
  const evidence = Array.from(rawEvidence)
    .filter((character) => {
      const code = character.codePointAt(0);
      return typeof code === "number" && code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const countries = [
    ...(job.structuredLocation?.eligibleCountryCodes || []),
    job.structuredLocation?.countryCode,
    ...countryCodes(sourceLocation),
  ]
    .map((x) => String(x || "").toUpperCase())
    .filter((x) => /^[A-Z]{2}$/.test(x));
  const normalized = sourceLocation.toLowerCase();
  const worldwide = /\b(worldwide|anywhere in the world|work from anywhere)\b/.test(normalized);
  const regionAlias = Object.keys(ELIGIBILITY_REGION_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((alias) =>
      new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalized),
    );
  const regionCode = regionAlias ? ELIGIBILITY_REGION_ALIASES[regionAlias] : null;
  const regionCountries = regionCode ? ELIGIBILITY_REGIONS[regionCode] || [] : [];
  countries.push(...regionCountries);
  const timezoneLimited =
    /\b(?:utc|gmt)[+-]\d{1,2}|time ?zone|overlap with .*hours|business hours/i.test(normalized);
  const remoteScope = worldwide
    ? "worldwide"
    : regionCode ||
      (timezoneLimited
        ? "timezone"
        : countries.length
          ? "country"
          : job.structuredLocation?.remoteScope || "unknown");
  const auth =
    /must be authorized|authorized to work|work authorization|required.*visa|visa sponsorship not available/i.test(
      normalized,
    );
  const confidence = worldwide ? 0.98 : countries.length ? 0.9 : regionCode || timezoneLimited ? 0.72 : 0.2;
  return {
    version: ELIGIBILITY_REGION_CONFIG_VERSION,
    countries: [...new Set(countries)],
    remoteScope,
    sponsorship: /sponsor(?:ship|s)? (?:available|provided)|visa sponsorship/i.test(normalized),
    workAuthorizationRequired: auth,
    confidence,
    evidence: evidence.slice(0, 180),
  };
}

export function profileApplicantCountries(profile: ProfileInputLike = {}): string[] {
  const career = profile.careerProfile || {};
  const careerLocations = [career.homeLocation, ...(career.targetLocations || [])];
  const workCountries = career.workAuthorization?.sponsorshipOrRelocation?.countryCodes || [];
  const legacyCountries = profile.preferences?.preferredCountryCodes || [];
  const inferred = careerLocations.map((location) =>
    location?.countryCode || (location?.scope === "anywhere_in_india" ? "IN" : null),
  );
  return [
    ...new Set(
      [
        career.homeLocation?.countryCode,
        ...inferred,
        ...workCountries,
        ...legacyCountries,
      ]
        .map((x) => String(x || "").toUpperCase())
        .filter((x) => /^[A-Z]{2}$/.test(x)),
    ),
  ];
}

export function classifyEligibility(
  job: JobInputLike,
  profile: ProfileInputLike,
): ClassifiedEligibility {
  const parsed = job.eligibility || parseJobEligibility(job);
  const applicantCountries = profileApplicantCountries(profile);
  if (!applicantCountries.length) return { status: "unknown", countryCode: null, ...parsed };
  const countryMatch = parsed.countries.some((code) => applicantCountries.includes(code));
  const regionMatch =
    Object.hasOwn(ELIGIBILITY_REGIONS, parsed.remoteScope) &&
    applicantCountries.some((code) =>
      (ELIGIBILITY_REGIONS[parsed.remoteScope] || []).includes(code),
    );
  const restrictedRegion = Object.hasOwn(ELIGIBILITY_REGIONS, parsed.remoteScope);
  const status: "eligible" | "not_open" | "unknown" =
    parsed.remoteScope === "worldwide" || countryMatch || regionMatch
      ? "eligible"
      : parsed.countries.length || restrictedRegion
        ? "not_open"
        : "unknown";
  return { status, countryCode: applicantCountries[0], ...parsed };
}
