import { createHash } from "node:crypto";
import { z } from "zod";
import { decryptText } from "../shared/utils/crypto.js";
import { get, set, CacheKeys, TTL } from "../shared/cache.js";
import { canonicalSkill, extractJobFeatures } from "./jobs/matching.js";

export const RESUME_MATCH_SCORE_VERSION = "resume-match-v1";
export const RESUME_MATCH_WEIGHTS = Object.freeze({ mustHave: 35, niceToHave: 12, tools: 8, licences: 10, softSkills: 5, title: 15, experience: 8, education: 4, evidence: 3 });
export const RESUME_MATCH_PROMPT_VERSION = "resume-match-suggestions-v1";

const suggestionSchema = z.object({
  suggestions: z.array(z.object({
    requirement: z.string().min(1).max(120),
    whereToAdd: z.enum(["summary", "skills", "experience", "education"]),
    wording: z.string().min(1).max(500),
    factId: z.string().min(1),
    onlyIfTrue: z.literal(true),
  }).strict()).max(8),
}).strict();

const SOFT_SKILLS = ["communication", "collaboration", "leadership", "problem solving", "critical thinking", "teamwork", "time management", "adaptability", "empathy", "patient care", "attention to detail"];
const LICENSE_PATTERN = /\b(?:license|licence|registered nurse|\brn\b|bls|acls|cpr|dha|nmc|b\.ed|cpa|acca|cfa|pmp|pharmacy registration)\b/gi;
const STOP_WORDS = new Set("a an and are as at be by for from had has have in into is it of on or our the their this to was we with you your helped led built managed created developed delivered improved responsible using used experience skills professional candidate job role company requirements must preferred nice have all willing only if true based on demonstrated".split(" "));
const INJECTION_LINE = /ignore\s+(?:all\s+|any\s+|previous\s+|prior\s+)?(?:instructions|rules)|system\s+prompt|developer\s+message|assistant\s+message|reveal\s+(?:the\s+)?prompt|return\s+only\s+(?:json|xml)|follow\s+these\s+instructions/i;

function sha(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function normalize(value = "") {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, " ").trim();
}
function includesTerm(haystack, term) {
  const source = ` ${normalize(haystack)} `;
  const needle = ` ${normalize(term)} `;
  return Boolean(term && normalize(term) && source.includes(needle));
}
function uniqueTerms(values) { return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]; }
function safeSourceText(text = "") {
  return String(text).split(/\r?\n/).filter((line) => !INJECTION_LINE.test(line)).join("\n").slice(0, 100_000);
}

export function getResumePlainText(resume) {
  if (!resume?.encryptedRawText) return "";
  return decryptText(resume.encryptedRawText);
}

function experienceYears(profile = {}) {
  const month = (value) => {
    if (!value) return null;
    if (/^(present|current|now)$/i.test(value)) { const d = new Date(); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
    const match = String(value).match(/^(\d{4})(?:[-/.](\d{1,2}))?/);
    if (match) return Number(match[1]) * 12 + (Number(match[2] || 1) - 1);
    const date = Date.parse(value);
    return Number.isFinite(date) ? new Date(date).getUTCFullYear() * 12 + new Date(date).getUTCMonth() : null;
  };
  const intervals = [];
  for (const role of profile.roles || []) {
    if (/intern(ship)?/i.test(role.title || "")) continue;
    const start = month(role.startDate);
    const end = month(role.endDate || (role.isCurrent ? "present" : ""));
    if (start !== null && end !== null && end >= start) intervals.push([start, end + 1]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const item of intervals) {
    const last = merged.at(-1);
    if (!last || item[0] > last[1]) merged.push([...item]);
    else last[1] = Math.max(last[1], item[1]);
  }
  const total = merged.reduce((sum, [start, end]) => sum + end - start, 0);
  return total ? total / 12 : null;
}

function factEntries(profile = {}) {
  const facts = [];
  for (const role of profile.roles || []) {
    facts.push({ factId: role.factId, section: "experience", content: `${role.title || ""} ${role.company || ""} ${(role.startDate || "")} ${(role.endDate || "")}`.trim() });
    for (const achievement of role.achievements || []) facts.push({ factId: achievement.factId, section: "experience", content: achievement.bullet || "" });
  }
  for (const skill of profile.skills || []) facts.push({ factId: skill.factId, section: "skills", content: skill.name || "" });
  for (const education of profile.education || []) facts.push({ factId: education.factId, section: "education", content: `${education.degree || ""} ${education.institution || ""}`.trim() });
  return facts.filter((fact) => fact.factId && fact.content);
}

function phraseInTerms(index, term) {
  const phrase = normalize(term).split(" ").filter(Boolean);
  if (!phrase.length) return false;
  for (let start = 0; start <= index.textTerms.length - phrase.length; start++) {
    if (phrase.every((part, offset) => index.textTerms[start + offset] === part)) return true;
  }
  return false;
}

function buildResumeIndex({ resume, profile, text, cached = null }) {
  const cacheKey = CacheKeys.resumeParse(`${resume.userId}:${resume.fileHash}:${RESUME_MATCH_SCORE_VERSION}`);
  const safeText = safeSourceText(text);
  const value = {
    textTerms: cached?.textTerms || normalize(safeText).split(" ").filter(Boolean),
    skills: uniqueTerms((profile.skills || []).map((item) => item.name).filter((term) => includesTerm(safeText, term)).map(canonicalSkill)),
    roles: uniqueTerms((profile.roles || []).map((item) => item.title).filter((term) => includesTerm(safeText, term))),
    experienceYears: experienceYears(profile),
    education: uniqueTerms((profile.education || []).map((item) => item.degree).filter((term) => includesTerm(safeText, term))),
    // Profile facts are shared across previously uploaded resumes. Keep evidence
    // strictly limited to facts whose text is present in this selected file.
    facts: factEntries(profile)
      .map((fact) => ({ ...fact, content: safeSourceText(fact.content) }))
      .filter((fact) => fact.content && includesTerm(safeText, fact.content)),
    fileType: cached?.fileType || resume.mimeType,
    textLength: cached?.textLength ?? safeText.length,
    hasEmail: cached?.hasEmail ?? /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(safeText),
    hasPhone: cached?.hasPhone ?? /(?:\+?\d[\d ()-]{7,}\d)/.test(safeText),
    atsReadiness: cached?.atsReadiness,
  };
  return { cacheKey, value };
}

function makeRequirements(job) {
  const features = extractJobFeatures({ ...job, rawDescription: safeSourceText(job.rawDescription || job.description || "") });
  const text = [job.title, job.rawDescription, ...(job.requirements || []), ...(job.tags || [])].join("\n").slice(0, 20000);
  const explicitRequirements = (job.requirements || []).filter((value) => typeof value === "string" && value.trim());
  const requirements = {
    // Do not turn every token from a job description into a requirement. The
    // existing broad feature extractor intentionally produces title/description
    // terms for job ranking; resume matching uses explicit requirements and
    // source tags to avoid over-counting generic words.
    requiredSkills: uniqueTerms(features.requiredSkills?.length ? features.requiredSkills : explicitRequirements.filter((term) => !/\b(preferred|nice to have|bonus|desirable)\b/i.test(term))),
    preferredSkills: uniqueTerms(features.preferredSkills?.length ? features.preferredSkills : explicitRequirements.filter((term) => /\b(preferred|nice to have|bonus|desirable)\b/i.test(term))),
    tools: uniqueTerms(job.tags || []),
    licences: uniqueTerms([...(features.licenses || []), ...[...text.matchAll(LICENSE_PATTERN)].map((match) => match[0])]),
    softSkills: SOFT_SKILLS.filter((term) => includesTerm(text, term)),
    years: features.experienceYears ?? [...text.matchAll(/(\d{1,2})\+?\s+years?/gi)].map((match) => Number(match[1])).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null,
    seniority: features.seniority || "mid",
    education: uniqueTerms(features.education || []),
    occupation: features.occupation || "unclassified",
    title: String(job.title || "").slice(0, 200),
    eligibility: job.eligibility ? { countries: job.eligibility.countries || [], remoteScope: job.eligibility.remoteScope || "unknown", sponsorship: job.eligibility.sponsorship ?? null } : null,
  };
  return requirements;
}

function keywordGroup(terms, index, jobText, ignored) {
  return uniqueTerms(terms).map((term) => {
    const key = canonicalSkill(term);
    const sourceMatch = index.skills.some((skill) => canonicalSkill(skill) === key) || phraseInTerms(index, key);
    const evidenceFact = index.facts.find((fact) => includesTerm(fact.content, key));
    const evidenceInExperience = evidenceFact?.section === "experience";
    const evidenceInJob = includesTerm(jobText, key);
    return { term, matched: sourceMatch && !ignored.has(key), baseMatched: sourceMatch, ignored: ignored.has(key), evidence: evidenceInExperience ? { section: evidenceFact.section, snippet: evidenceFact.content.slice(0, 120) } : null, evidenceStrength: evidenceInExperience ? "experience" : sourceMatch ? "resume" : evidenceInJob ? "job" : "none" };
  });
}

function calculateScore(requirements, index, jobText, ignoredKeywords = []) {
  const ignored = new Set(ignoredKeywords.map(canonicalSkill));
  const groups = {
    mustHave: keywordGroup(requirements.requiredSkills, index, jobText, ignored),
    niceToHave: keywordGroup(requirements.preferredSkills, index, jobText, ignored),
    tools: keywordGroup(requirements.tools, index, jobText, ignored),
    licences: keywordGroup(requirements.licences, index, jobText, ignored),
    softSkills: keywordGroup(requirements.softSkills, index, jobText, ignored),
  };
  const ratio = (items) => {
    const active = items.filter((item) => !item.ignored);
    return active.length ? active.filter((item) => item.matched).length / active.length : null;
  };
  const components = [
    [RESUME_MATCH_WEIGHTS.mustHave, ratio(groups.mustHave)],
    [RESUME_MATCH_WEIGHTS.niceToHave, ratio(groups.niceToHave)],
    [RESUME_MATCH_WEIGHTS.tools, ratio(groups.tools)],
    [RESUME_MATCH_WEIGHTS.licences, ratio(groups.licences)],
    [RESUME_MATCH_WEIGHTS.softSkills, ratio(groups.softSkills)],
  ];
  const roleTitles = [...index.roles];
  const titleRatio = requirements.title && roleTitles.length ? (roleTitles.some((role) => includesTerm(requirements.title, role) || includesTerm(role, requirements.title)) ? 1 : 0) : (requirements.occupation === "unclassified" ? null : 0.5);
  components.push([RESUME_MATCH_WEIGHTS.title, titleRatio]);
  const expRatio = requirements.years === null || requirements.years === undefined || index.experienceYears === null || index.experienceYears === undefined ? null : Math.min(1, index.experienceYears / Math.max(requirements.years, 1));
  components.push([RESUME_MATCH_WEIGHTS.experience, expRatio]);
  const eduRatio = requirements.education.length ? (requirements.education.some((degree) => index.education.some((candidate) => includesTerm(candidate, degree) || includesTerm(degree, candidate))) ? 1 : 0) : null;
  components.push([RESUME_MATCH_WEIGHTS.education, eduRatio]);
  const applicable = components.filter(([, value]) => value !== null);
  const score = applicable.length ? Math.round(100 * applicable.reduce((sum, [weight, value]) => sum + weight * value, 0) / applicable.reduce((sum, [weight]) => sum + weight, 0)) : 0;
  const all = Object.values(groups).flat();
  const evidence = all.filter((item) => item.evidence).slice(0, 10).map(({ term, evidence: itemEvidence }) => ({ term, ...itemEvidence }));
  return {
    score,
    band: score >= 75 ? "strong" : score >= 50 ? "moderate" : "early",
    groups,
    matched: all.filter((item) => item.matched && !item.ignored).length,
    missing: all.filter((item) => !item.matched && !item.ignored).length,
    evidence,
    ignoredKeywords: [...ignored],
    scoringParts: {
      mustHave: ratio(groups.mustHave), niceToHave: ratio(groups.niceToHave), tools: ratio(groups.tools),
      licences: ratio(groups.licences), softSkills: ratio(groups.softSkills), title: titleRatio,
      experience: expRatio, education: eduRatio,
    },
  };
}

export function applyIgnoredKeywords(match, ignoredKeywords = []) {
  const ignored = new Set(ignoredKeywords.map(canonicalSkill));
  const groups = Object.fromEntries(Object.entries(match.groups).map(([key, items]) => [key, items.map((item) => ({ ...item, ignored: ignored.has(canonicalSkill(item.term)), matched: item.baseMatched && !ignored.has(canonicalSkill(item.term)) }))]));
  const keyMap = { mustHave: "mustHave", niceToHave: "niceToHave", tools: "tools", licences: "licences", softSkills: "softSkills" };
  const parts = { ...match.scoringParts };
  for (const [part, key] of Object.entries(keyMap)) {
    const active = groups[key].filter((item) => !item.ignored);
    parts[part] = active.length ? active.filter((item) => item.matched).length / active.length : null;
  }
  const weights = RESUME_MATCH_WEIGHTS;
  const components = [
    [weights.mustHave, parts.mustHave], [weights.niceToHave, parts.niceToHave], [weights.tools, parts.tools],
    [weights.licences, parts.licences], [weights.softSkills, parts.softSkills], [weights.title, parts.title],
    [weights.experience, parts.experience], [weights.education, parts.education],
  ].filter(([, value]) => value !== null);
  const score = components.length ? Math.round(100 * components.reduce((sum, [weight, value]) => sum + weight * value, 0) / components.reduce((sum, [weight]) => sum + weight, 0)) : 0;
  const items = Object.values(groups).flat();
  return { ...match, groups, score, band: score >= 75 ? "strong" : score >= 50 ? "moderate" : "early", matched: items.filter((item) => item.matched && !item.ignored).length, missing: items.filter((item) => !item.matched && !item.ignored).length, ignoredKeywords: [...ignored] };
}

function atsChecks(index, jobRequirements = []) {
  const text = index.text;
  const heading = /\b(experience|work history|education|skills|certifications|summary|projects)\b/i.test(text);
  const dates = [...text.matchAll(/\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:(?:19|20)\d{2}|present|current))?\b/gi)].length;
  const bullets = (text.match(/^\s*(?:[-*•▪]|\d+[.)])\s+/gm) || []).length;
  const metrics = (text.match(/\b\d+(?:\.\d+)?\s*(?:%|percent|users|customers|hours|days|weeks|months|years|projects|patients|cases|dollars|\$)/gi) || []).length;
  const dateFormats = [...text.matchAll(/\b(?:\d{1,2}[/-])?\d{4}\b/g)].map((match) => match[0].includes("/") ? "slash" : match[0].includes("-") ? "dash" : "year");
  const density = jobRequirements.length ? jobRequirements.filter((term) => includesTerm(text, term)).length / jobRequirements.length : 0;
  const checks = [
    ["contact_email", index.hasEmail, "Add a professional email address."],
    ["contact_phone", index.hasPhone, "Add a phone number if employers need to contact you."],
    ["standard_sections", heading, "Use clear headings such as Experience, Education, and Skills."],
    ["dated_experience", dates >= 2, "Add dates to each role so chronology is clear."],
    ["consistent_dates", new Set(dateFormats).size <= 2, "Use one consistent date format throughout."],
    ["bullet_structure", bullets >= 2, "Use concise bullets for experience and achievements."],
    ["measurable_results", metrics > 0, "Add accurate outcomes or measurements where available."],
    ["reasonable_length", index.textLength >= 500 && index.textLength <= 14000, "Keep resume text concise and focused (roughly one to two pages)."],
    ["extractable_text", index.textLength >= 250, "Use a text-based PDF or DOCX; scanned images may not parse."],
    ["supported_file_type", ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(index.fileType), "Use a text-based PDF or DOCX file."],
    ["layout_readability", !text.split(/\r?\n/).some((line) => /\t{2,}| {6,}/.test(line)), "Check that columns and spacing preserve reading order when extracted."],
    ["keyword_density", density <= 0.7, "Avoid repeating job keywords unnaturally."],
    ["skills_section", /\b(skills|technical skills|clinical skills|competencies)\b/i.test(text), "Add a clearly labeled skills or competencies section."],
    ["experience_section", /\b(experience|employment|work history|clinical experience)\b/i.test(text), "Add a clearly labeled experience section when applicable."],
    ["education_section", /\b(education|academic|training)\b/i.test(text), "Add a clearly labeled education or training section."],
  ].map(([id, passed, fixHint]) => ({ id, status: passed ? "pass" : "warn", fixHint }));
  const score = Math.round(checks.reduce((sum, item) => sum + (item.status === "pass" ? 1 : 0.5), 0) * 100 / checks.length);
  return { score, checks };
}

export async function scoreResumeForJob({ resume, profile, job, ignoredKeywords = [] }) {
  const text = getResumePlainText(resume);
  const { cacheKey } = buildResumeIndex({ resume, profile, text });
  let cachedIndex = await get(cacheKey);
  const indexCacheHit = Boolean(cachedIndex);
  if (!cachedIndex) {
    const termIndex = buildResumeIndex({ resume, profile, text }).value;
    const checks = atsChecks({ ...termIndex, text: safeSourceText(text) }, []);
    cachedIndex = { textTerms: termIndex.textTerms, fileType: termIndex.fileType, textLength: termIndex.textLength, hasEmail: termIndex.hasEmail, hasPhone: termIndex.hasPhone, atsReadiness: checks };
    await set(cacheKey, cachedIndex, TTL.RESUME_PARSE);
  }
  const cache = buildResumeIndex({ resume, profile, text, cached: cachedIndex });
  const cleanJob = { ...job, rawDescription: safeSourceText(job.rawDescription || job.description || "") };
  const requirementsCacheKey = CacheKeys.jobDescription(`${reportJobHash(cleanJob)}:resume-match-requirements-v1`);
  let requirements = await get(requirementsCacheKey);
  if (!requirements) {
    requirements = makeRequirements(cleanJob);
    await set(requirementsCacheKey, requirements, TTL.JD_PARSE);
  }
  const jobText = [cleanJob.title, cleanJob.rawDescription, ...(cleanJob.requirements || []), ...(cleanJob.tags || [])].join("\n").slice(0, 20000);
  return {
    requirements,
    match: calculateScore(requirements, cache.value, jobText, ignoredKeywords),
    atsReadiness: applyKeywordDensity(cache.value.atsReadiness, cache.value.textTerms, [...requirements.requiredSkills, ...requirements.preferredSkills]),
    indexCacheHit,
  };
}

function applyKeywordDensity(ats, textTerms, jobRequirements) {
  const source = new Set(textTerms);
  const density = jobRequirements.length ? jobRequirements.filter((term) => source.has(normalize(term))).length / jobRequirements.length : 0;
  const checks = ats.checks.map((check) => check.id === "keyword_density" ? { ...check, status: density <= 0.7 ? "pass" : "warn" } : check);
  return { score: Math.round(checks.reduce((sum, item) => sum + (item.status === "pass" ? 1 : 0.5), 0) * 100 / checks.length), checks };
}

export function filterGroundedSuggestions(suggestions, facts, requirements = []) {
  const factsById = new Map(facts.map((fact) => [fact.factId, fact]));
  const jobTerms = new Set(requirements.map(canonicalSkill));
  return suggestionSchema.parse(suggestions).suggestions.filter((suggestion) => {
    const fact = factsById.get(suggestion.factId);
    if (!fact || !jobTerms.has(canonicalSkill(suggestion.requirement))) return false;
    const wording = normalize(suggestion.wording);
    const source = normalize(fact.content);
    const allowedWords = new Set([...source.split(" "), ...STOP_WORDS, ...jobTerms]);
    const wordingTerms = wording.split(" ").filter((word) => word.length > 2 && !/^\d+$/.test(word));
    if (wordingTerms.some((word) => !allowedWords.has(word))) return false;
    const introducedMetrics = [...suggestion.wording.matchAll(/\b\d+(?:\.\d+)?\s*(?:%|percent|users|patients|years|months|dollars|\$)?\b/gi)].map((match) => normalize(match[0]));
    if (introducedMetrics.some((metric) => metric && !source.includes(metric))) return false;
    const introducedLicences = [...suggestion.wording.matchAll(LICENSE_PATTERN)].map((match) => normalize(match[0]));
    if (introducedLicences.some((term) => !source.includes(term))) return false;
    const capitalized = suggestion.wording.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [];
    if (capitalized.some((entity) => !source.includes(normalize(entity)))) return false;
    const mentionedRequirements = [...jobTerms].filter((term) => term && wording.includes(term));
    if (mentionedRequirements.some((term) => !source.includes(term))) return false;
    return true;
  });
}

export function reportJobHash(job) {
  return sha(JSON.stringify({ title: job.title, company: job.company, description: job.rawDescription || job.description || "", requirements: job.requirements || [], tags: job.tags || [], updatedAt: job.updatedAt || null }));
}
