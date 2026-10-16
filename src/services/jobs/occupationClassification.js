import { ROLE_SUGGESTIONS } from "../profileSuggestionCatalog.js";

export const OCCUPATION_FEATURES_VERSION = 6;

const normalize = (value = "") => String(value).normalize("NFKD").toLowerCase()
  .replace(/[^\p{L}\p{N}+#.]+/gu, " ").trim().replace(/\s+/g, " ");

const ROLE_RULES = ROLE_SUGGESTIONS.flatMap((role) => [role.label, ...role.aliases]
  .map((alias) => ({ role, alias: normalize(alias) })))
  .sort((left, right) => right.alias.length - left.alias.length);

const SOURCE_CATEGORY_RULES = [
  { family: "software", label: "Software Engineer", aliases: ["software", "software engineering", "software development", "information technology", "information technology it", "devops", "platform engineering", "web development"] },
  { family: "nursing", label: "Staff Nurse", aliases: ["nursing", "nurse", "healthcare nursing", "clinical care", "nursing clinical care"] },
  { family: "healthcare", label: "Healthcare Professional", aliases: ["healthcare", "health care", "medical", "pharmacy", "pharmacist", "physiotherapy", "laboratory"] },
  { family: "education", label: "Teacher", aliases: ["education", "education e learning", "teaching", "teacher", "academic"] },
  { family: "accounting-finance", label: "Accountant", aliases: ["accounting", "finance", "finance accounting", "bookkeeping", "audit"] },
  { family: "sales", label: "Sales Executive", aliases: ["sales", "business development", "sales business development", "account executive"] },
  { family: "delivery-logistics", label: "Delivery Executive", aliases: ["delivery", "logistics", "warehouse", "transport", "courier"] },
  { family: "customer-support", label: "Customer Support", aliases: ["customer service", "customer support", "customer support success", "call center", "contact centre"] },
  { family: "electrical-trades", label: "Electrician", aliases: ["electrician", "electrical", "maintenance trades"] },
  { family: "food-hospitality", label: "Cook / Chef", aliases: ["hospitality", "food service", "chef", "cook", "restaurant"] },
  { family: "engineering", label: "Civil Engineer", aliases: ["civil engineering", "construction engineering", "structural engineering"] },
  { family: "design", label: "Product Designer", aliases: ["web ui ux design", "graphic design", "user experience", "ux design"] },
  { family: "business", label: "Business Analyst", aliases: ["business analysis", "business analyst", "analytics"] },
  { family: "human-resources", label: "HR / Recruiter", aliases: ["human resources", "recruitment", "talent acquisition"] },
  { family: "marketing", label: "Marketing Executive", aliases: ["marketing", "digital marketing", "marketing sales", "seo", "content marketing"] },
  { family: "operations", label: "Operations Associate", aliases: ["operations", "product operations", "administration", "office support", "project management"] },
  { family: "security", label: "Security Guard", aliases: ["security", "cybersecurity", "safety and security"] },
  { family: "construction-trades", label: "Construction Worker", aliases: ["construction", "carpentry", "plumbing", "welding", "skilled trades"] },
];

function titleCase(value) {
  return normalize(value).replace(/\b([\p{L}\p{N}])/gu, (letter) => letter.toLocaleUpperCase());
}

function matchRoleTitle(title) {
  const normalizedTitle = normalize(title);
  if (!normalizedTitle) return null;
  return ROLE_RULES.find(({ alias }) => ` ${normalizedTitle} `.includes(` ${alias} `))?.role || null;
}

function matchCategory(values = []) {
  const candidates = values.map((value) => normalize(String(value).split(":").at(-1))).filter(Boolean);
  return SOURCE_CATEGORY_RULES.find((rule) => rule.aliases.some((alias) =>
    candidates.some((candidate) => candidate === normalize(alias)))) || null;
}

export function classifyJobOccupation(job = {}) {
  const titleMatch = matchRoleTitle(job.title);
  if (titleMatch) return {
    occupation: titleMatch.family,
    occupationConfidence: 0.95,
    normalizedTitle: titleMatch.label,
    occupationFeaturesVersion: OCCUPATION_FEATURES_VERSION,
  };

  const categoryMatch = matchCategory([
    job.sourceCategory,
    job.category,
    ...(Array.isArray(job.categories) ? job.categories : []),
    ...(Array.isArray(job.occupationCodes) ? job.occupationCodes : []),
  ]);
  const tagCategoryMatch = categoryMatch || matchCategory(Array.isArray(job.tags) ? job.tags : []);
  const normalizedTitle = titleCase(job.title || "");
  if (tagCategoryMatch) return {
    occupation: tagCategoryMatch.family,
    occupationConfidence: 0.78,
    normalizedTitle: tagCategoryMatch.label,
    occupationFeaturesVersion: OCCUPATION_FEATURES_VERSION,
  };
  return {
    occupation: "unclassified",
    occupationConfidence: 0,
    normalizedTitle,
    occupationFeaturesVersion: OCCUPATION_FEATURES_VERSION,
  };
}
