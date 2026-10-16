const EXPERIENCE_HEADINGS = new Set([
  "experience",
  "work experience",
  "professional experience",
  "employment history",
  "work history",
  "career history",
  "experience and internships",
  "experience and employment",
  "work experience and internships",
  "employment and internship experience",
  "experience summary",
  "clinical experience",
  "internship experience",
  "internships",
  "experience and internships",
]);

const END_HEADINGS = new Set([
  "education",
  "academic background",
  "skills",
  "technical skills",
  "certifications",
  "licenses",
  "projects",
  "references",
  "languages",
  "awards",
  "summary",
  "profile",
  "objective",
]);

const ROLE_CUES = /\b(engineer|engineering|developer|programmer|nurse|nursing|gnm|midwife|midwifery|teacher|educator|tutor|accountant|accounting|auditor|sales|delivery|courier|analyst|designer|manager|intern|trainee|student nurse|nursing student|registered general nurse|nursing officer|clinical|ward|staff|associate|executive|representative|specialist|technician|consultant|administrator|pharmacist|physiotherapist|caregiver|assistant professor|lecturer|recruiter|human resources|hr executive|support agent|customer service|driver|operator|supervisor|coordinator|medical officer|doctor|physician|therapist|lab technologist|resident|fellow|instructor|attendant|cashier|chef|cook|housekeeping|worker|officer|faculty|researcher)\b/i;
const EMPLOYER_CUES = /\b(hospital|medical center|medical centre|clinic|healthcare|health care|school|university|college|institute|company|technologies|technology|solutions|services|industries|corporation|corp\.?|inc\.?|limited|ltd\.?|private limited|pvt\.?|llp|trust|foundation|bank|hotel|group|academy|pharma|laboratories|laboratory)\b/i;
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DATE_PART = `(?:${MONTH}\\s+(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])[./-](?:19|20)\\d{2}|(?:19|20)\\d{2})`;
const DATE_RANGE = new RegExp(
  `(${DATE_PART})\\s*(?:[-–—]|\\bto\\b|\\bthrough\\b)\\s*(present|current|now|${DATE_PART})`,
  "i",
);
const SINGLE_DATE = new RegExp(`\\b${DATE_PART}\\b`, "i");

function normalizeHeading(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^\s*(?:\d+(?:\.\d+)*\s*)?/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function cleanLine(value) {
  return String(value || "")
    .replace(/^\s*(?:[•●▪◦*-]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isExperienceHeading(value) {
  const normalized = normalizeHeading(value);
  return EXPERIENCE_HEADINGS.has(normalized) ||
    (String(value || "").length <= 80 && /\b(?:work|professional|clinical|employment|internship)?\s*experiences?\b/i.test(normalized));
}

function findExperienceLines(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const start = lines.findIndex(isExperienceHeading);
  if (start < 0) return [];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (END_HEADINGS.has(normalizeHeading(lines[index]))) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).map(cleanLine);
}

export function getExperienceSectionMetrics(rawText) {
  const lines = findExperienceLines(rawText);
  return {
    sectionLineCount: lines.length,
    dateLineCount: lines.filter((line) => DATE_RANGE.test(line) || SINGLE_DATE.test(line)).length,
    roleCueLineCount: lines.filter((line) => ROLE_CUES.test(line)).length,
    employerCueLineCount: lines.filter((line) => EMPLOYER_CUES.test(line)).length,
    companyLikeLineCount: lines.filter(isCompanyLikeLine).length,
  };
}

function parseDateRange(line) {
  const range = line.match(DATE_RANGE);
  if (range) {
    return {
      startDate: range[1],
      endDate: range[2],
      isCurrent: /^(present|current|now)$/i.test(range[2]),
    };
  }
  const single = line.match(SINGLE_DATE);
  if (!single) return null;
  return { startDate: single[0], endDate: null, isCurrent: false };
}

function parseInlineTitleEmployer(line) {
  const cleaned = cleanLine(line);
  const at = cleaned.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (at && ROLE_CUES.test(at[1]) && EMPLOYER_CUES.test(at[2]))
    return { title: at[1].trim(), company: at[2].trim() };

  const split = cleaned.match(/^(.+?)\s*(?:\||•|–|—|\s-\s|,\s)(.+)$/);
  if (split && ROLE_CUES.test(split[1]) && EMPLOYER_CUES.test(split[2]))
    return { title: split[1].trim(), company: split[2].trim() };
  return null;
}

function isRoleLine(line) {
  return line.length >= 3 && line.length <= 120 && ROLE_CUES.test(line) && !DATE_RANGE.test(line) &&
    !(/\b(ward|department|unit)\b/i.test(line) && !/\b(nurse|nursing|officer)\b/i.test(line));
}

function isEmployerLine(line) {
  return line.length >= 3 && line.length <= 160 && EMPLOYER_CUES.test(line) && !DATE_RANGE.test(line) &&
    !/\b(managed|built|provided|worked|assisted|developed|created|delivered|supported|led|implemented|designed|maintained|improved)\b/i.test(line);
}

function isCompanyLikeLine(line) {
  return line.length >= 3 && line.length <= 140 && !DATE_RANGE.test(line) &&
    /(?:\b[A-Z][a-z]{2,}|\b[A-Z]{2,}\b)/.test(line) &&
    !/\b(ward|department|unit|responsibilities|duties|patients|skills|experience|present|current|managed|built|provided|responsible|worked|assisted|project|developed|created|delivered|supported|led|implemented|designed|maintained|improved)\b/i.test(line);
}

/**
 * Conservatively parse source-grounded role facts from a labeled experience section.
 * It only returns exact title/company text already present in the source.
 */
export function parseExperienceRoles(rawText) {
  const lines = findExperienceLines(rawText);
  if (!lines.length) return [];
  const roles = [];
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const dates = parseDateRange(lines[index]);
    if (!dates) continue;
    const before = lines.slice(Math.max(0, index - 4), index).filter(Boolean).reverse();
    const after = lines.slice(index + 1, index + 4).filter(Boolean);
    const nearby = [...before, ...after];

    let parsed = null;
    for (const line of nearby) {
      parsed = parseInlineTitleEmployer(line);
      if (parsed) break;
    }

    if (!parsed) {
      const title = nearby.find(isRoleLine);
      const titleLineIndex = title ? lines.indexOf(title, Math.max(0, index - 4)) : -1;
      const candidates = nearby.filter((line) => line !== title && !DATE_RANGE.test(line));
      const company = candidates.find(isEmployerLine) ||
        candidates.filter(isCompanyLikeLine).sort((left, right) => {
          const leftIndex = lines.indexOf(left, Math.max(0, index - 4));
          const rightIndex = lines.indexOf(right, Math.max(0, index - 4));
          return Math.abs(leftIndex - titleLineIndex) - Math.abs(rightIndex - titleLineIndex);
        })[0];
      if (title && company) parsed = { title, company };
    }
    if (!parsed || parsed.title === parsed.company) continue;

    const key = [parsed.title, parsed.company, dates.startDate, dates.endDate]
      .map(normalizeHeading)
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    roles.push({
      title: parsed.title,
      company: parsed.company,
      startDate: dates.startDate,
      endDate: dates.endDate,
      isCurrent: dates.isCurrent,
      achievements: [],
    });
  }

  // Some Indian fresher and clinical resumes omit employment dates. Preserve
  // only adjacent title/company lines that are still source-grounded; dates
  // remain unknown rather than being inferred.
  for (let index = 0; index < lines.length; index += 1) {
    const title = lines[index];
    if (!isRoleLine(title)) continue;
    const adjacent = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3))
      .filter((line) => line && line !== title && !DATE_RANGE.test(line) && !SINGLE_DATE.test(line) && !isRoleLine(line));
    const company = adjacent.find(isEmployerLine) || adjacent.filter(isCompanyLikeLine)[0];
    if (!company) continue;
    if (roles.some((role) => normalizeHeading(role.title) === normalizeHeading(title) &&
      normalizeHeading(role.company) === normalizeHeading(company))) continue;
    const nearbyDates = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4))
      .map(parseDateRange).find(Boolean);
    const role = {
      title,
      company,
      startDate: nearbyDates?.startDate || "",
      endDate: nearbyDates?.endDate || "",
      isCurrent: Boolean(nearbyDates?.isCurrent),
      achievements: [],
    };
    const key = [role.title, role.company, role.startDate, role.endDate].map(normalizeHeading).join("|");
    if (!seen.has(key)) {
      seen.add(key);
      roles.push(role);
    }
  }
  return roles.slice(0, 30);
}
