const COUNTRY = new Map([
  ["india", "IN"], ["united states", "US"], ["united states of america", "US"], ["usa", "US"], ["us", "US"],
  ["united kingdom", "GB"], ["uk", "GB"], ["great britain", "GB"], ["ireland", "IE"], ["canada", "CA"],
  ["australia", "AU"], ["new zealand", "NZ"], ["germany", "DE"], ["france", "FR"], ["spain", "ES"],
  ["netherlands", "NL"], ["singapore", "SG"], ["united arab emirates", "AE"], ["uae", "AE"], ["saudi arabia", "SA"],
  ["qatar", "QA"], ["united arab emirates (uae)", "AE"],
]);
const CONTINENTS = { europe: "EU", eu: "EU", apac: "APAC", asia: "AS", "north america": "NA", "latin america": "LATAM", africa: "AF" };

function countryCodes(text) {
  const normalized = String(text || "").toLowerCase();
  return [...new Set([...COUNTRY].filter(([name]) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i").test(normalized)).map(([, code]) => code))];
}

/** Deterministic, conservative eligibility parser. Missing evidence remains unknown. */
export function parseJobEligibility(job = {}) {
  const sourceLocation = [job.location, job.locations, job.locationRestrictions, job.country, job.rawDescription, ...(job.tags || [])]
    .flat().filter(Boolean).join(" | ").slice(0, 5000);
  const rawEvidence = sourceLocation.match(/.{0,50}(?:worldwide|anywhere|us only|usa only|united states only|must be authorized|authorized to work|remote\s*\([^)]*\)|europe|eu only|apac|timezone|time zone|india|united kingdom|ireland).{0,70}/i)?.[0] || "";
  const evidence = Array.from(rawEvidence).filter((character) => {
    const code = character.codePointAt(0);
    return code >= 0x20 && code !== 0x7f;
  }).join("").replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  const countries = [
    ...(job.structuredLocation?.eligibleCountryCodes || []),
    job.structuredLocation?.countryCode,
    ...countryCodes(sourceLocation),
  ].map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
  const normalized = sourceLocation.toLowerCase();
  const worldwide = /\b(worldwide|anywhere in the world|work from anywhere)\b/.test(normalized);
  const continent = Object.keys(CONTINENTS).find((x) => new RegExp(`\\b${x}\\b`, "i").test(normalized));
  const timezoneLimited = /\b(?:utc|gmt)[+-]\d{1,2}|time ?zone|overlap with .*hours|business hours/i.test(normalized);
  const remoteScope = worldwide ? "worldwide" : continent ? CONTINENTS[continent] : timezoneLimited ? "timezone" : countries.length ? "country" : job.structuredLocation?.remoteScope || "unknown";
  const auth = /must be authorized|authorized to work|work authorization|required.*visa|visa sponsorship not available/i.test(normalized);
  const confidence = worldwide ? 0.98 : countries.length ? 0.9 : continent || timezoneLimited ? 0.72 : 0.2;
  return {
    version: 1,
    countries: [...new Set(countries)], remoteScope, sponsorship: /sponsor(?:ship|s)? (?:available|provided)|visa sponsorship/i.test(normalized),
    workAuthorizationRequired: auth, confidence, evidence: evidence.slice(0, 180),
  };
}

export function profileApplicantCountries(profile = {}) {
  const career = profile.careerProfile || {};
  const careerLocations = [career.homeLocation, ...(career.targetLocations || [])];
  const workCountries = career.workAuthorization?.sponsorshipOrRelocation?.countryCodes || [];
  const legacyCountries = profile.preferences?.preferredCountryCodes || [];
  const inferred = careerLocations.map((location) => location?.countryCode || (location?.scope === "anywhere_in_india" ? "IN" : null));
  return [...new Set([
    career.homeLocation?.countryCode,
    ...inferred,
    ...workCountries,
    ...legacyCountries,
  ].map((x) => String(x || "").toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))];
}

export function classifyEligibility(job, profile) {
  const parsed = job.eligibility || parseJobEligibility(job);
  const applicantCountries = profileApplicantCountries(profile);
  if (!applicantCountries.length) return { status: "unknown", countryCode: null, ...parsed };
  const countryMatch = parsed.countries.some((code) => applicantCountries.includes(code));
  const continentMatch = parsed.remoteScope === "APAC" && applicantCountries.some((code) => ["IN", "CN", "JP", "SG", "AU", "NZ", "KR", "TH", "ID", "MY", "PH", "VN"].includes(code))
    || parsed.remoteScope === "EU" && applicantCountries.some((code) => ["GB", "IE", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "FI", "PL"].includes(code));
  const status = parsed.remoteScope === "worldwide" || countryMatch || continentMatch ? "eligible"
    : parsed.countries.length || parsed.remoteScope === "EU" || parsed.remoteScope === "APAC" ? "not_open" : "unknown";
  return { status, countryCode: applicantCountries[0], ...parsed };
}
