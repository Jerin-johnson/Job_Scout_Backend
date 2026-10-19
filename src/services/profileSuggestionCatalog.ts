export interface RoleSuggestion {
  code: string;
  family: string;
  label: string;
  aliases: string[];
}

export interface PlaceSpecialOption {
  code: string;
  label: string;
  type: string;
  countryCode?: string;
}

export interface CountryAlias {
  code: string;
  label: string;
  aliases: string[];
}

export interface PlaceSuggestion {
  code: string;
  label: string;
  aliases: string[];
  subdivisionCode: string | null;
  district: string | null;
  countryCode: string;
  country: string;
  type?: string;
}

export const ROLE_SUGGESTIONS: readonly RoleSuggestion[] = Object.freeze([
  { code: "software-engineer", family: "software", label: "Software Engineer", aliases: ["software engineer", "software developer", "software engineering", "software deployment engineer", "backend engineer", "backend developer", "front end engineer", "frontend engineer", "full stack developer", "web developer", "programmer", "application developer", "systems engineer", "postgres engineer", "c++ engineer", "product engineer", "technical lead engineering", "chief technology officer", "field cto"] },
  { code: "devops-engineer", family: "software", label: "DevOps Engineer", aliases: ["devops engineer", "site reliability engineer", "sre", "platform engineer", "cloud engineer", "solutions architect", "partner solutions architect"] },
  { code: "data-analyst", family: "data", label: "Data Analyst", aliases: ["data analyst", "analytics analyst", "reporting analyst"] },
  { code: "business-analyst", family: "business", label: "Business Analyst", aliases: ["business analyst", "business systems analyst", "requirements analyst"] },
  { code: "data-engineer", family: "data", label: "Data Engineer", aliases: ["data engineer", "staff data engineer", "data scientist", "data science", "analytics engineer"] },
  { code: "product-designer", family: "design", label: "Product Designer", aliases: ["product designer", "product design director", "architectural designer", "ux designer", "ui designer", "user experience designer", "graphic designer"] },
  { code: "product-manager", family: "product", label: "Product Manager", aliases: ["product manager", "product owner"] },
  { code: "project-manager", family: "operations", label: "Project Manager", aliases: ["project manager", "program manager", "delivery manager", "project scheduler"] },
  { code: "marketing-executive", family: "marketing", label: "Marketing Executive", aliases: ["marketing executive", "digital marketer", "digital marketing", "marketing technology", "marketing manager", "marketing analyst", "marketing lead", "content lead", "content marketer", "performance marketing", "seo specialist"] },
  { code: "hr-recruiter", family: "human-resources", label: "HR / Recruiter", aliases: ["hr executive", "human resources executive", "recruiter", "talent acquisition specialist", "hr manager", "regional hr manager", "people operations", "hr technology"] },
  { code: "staff-nurse", family: "nursing", label: "Staff Nurse", aliases: ["staff nurse", "registered nurse", "rn", "nurse", "nursing"] },
  { code: "gnm-nurse", family: "nursing", label: "GNM Nurse", aliases: ["gnm", "general nursing and midwifery", "general nurse midwife"] },
  { code: "icu-nurse", family: "nursing", label: "ICU Nurse", aliases: ["icu nurse", "critical care nurse", "intensive care nurse", "ward nurse"] },
  { code: "nursing-officer", family: "nursing", label: "Nursing Officer", aliases: ["nursing officer", "nurse officer", "clinical nurse"] },
  { code: "nursing-assistant", family: "nursing", label: "Nursing Assistant", aliases: ["nursing assistant", "healthcare assistant", "patient care assistant", "caregiver"] },
  { code: "teacher", family: "education", label: "Teacher", aliases: ["teacher", "school teacher", "educator", "tutor", "lecturer", "instructor", "faculty"] },
  { code: "accountant", family: "accounting-finance", label: "Accountant", aliases: ["accountant", "accounting", "accounts executive", "bookkeeper", "auditor", "payroll accountant"] },
  { code: "sales-executive", family: "sales", label: "Sales Executive", aliases: ["sales executive", "sales representative", "account executive", "business development", "business development executive", "business development manager", "business development director", "sales manager", "sales engineer", "inside sales", "sales associate"] },
  { code: "delivery-executive", family: "delivery-logistics", label: "Delivery Executive", aliases: ["delivery", "delivery executive", "delivery associate", "courier", "delivery driver", "rider", "last mile delivery"] },
  { code: "customer-support", family: "customer-support", label: "Customer Support", aliases: ["customer support", "customer service", "customer success", "customer success manager", "client success", "client success manager", "support representative", "customer care executive", "call center agent", "contact centre agent"] },
  { code: "electrician", family: "electrical-trades", label: "Electrician", aliases: ["electrician", "electrical technician", "maintenance electrician", "wireman"] },
  { code: "cook-chef", family: "food-hospitality", label: "Cook / Chef", aliases: ["cook", "chef", "line cook", "commis chef", "head chef", "kitchen assistant"] },
  { code: "pharmacist", family: "healthcare", label: "Pharmacist", aliases: ["pharmacist", "clinical pharmacist", "pharmacy technician"] },
  { code: "physiotherapist", family: "healthcare", label: "Physiotherapist", aliases: ["physiotherapist", "physical therapist", "physio"] },
  { code: "lab-technologist", family: "healthcare", label: "Lab Technologist", aliases: ["lab technologist", "medical laboratory technician", "lab technician", "medical lab scientist"] },
  { code: "civil-engineer", family: "engineering", label: "Civil Engineer", aliases: ["civil engineer", "site engineer", "structural engineer", "construction engineer"] },
  { code: "operations-associate", family: "operations", label: "Operations Associate", aliases: ["operations associate", "operations executive", "business operations analyst", "operations engineer", "revenue operations", "sales operations", "flight operations"] },
  { code: "warehouse-associate", family: "delivery-logistics", label: "Warehouse Associate", aliases: ["warehouse associate", "warehouse worker", "picker packer", "inventory associate"] },
  { code: "driver", family: "transport", label: "Driver", aliases: ["driver", "chauffeur", "commercial driver", "truck driver"] },
  { code: "housekeeping", family: "facilities", label: "Housekeeping Associate", aliases: ["housekeeping", "housekeeper", "cleaner", "janitor"] },
  { code: "receptionist", family: "administration", label: "Receptionist", aliases: ["receptionist", "front desk executive", "front office assistant"] },
  { code: "administrative-assistant", family: "administration", label: "Administrative Assistant", aliases: ["administrative assistant", "admin assistant", "office assistant", "office administrator"] },
  { code: "security-guard", family: "security", label: "Security Guard", aliases: ["security guard", "security officer", "security supervisor"] },
  { code: "construction-worker", family: "construction-trades", label: "Construction Worker", aliases: ["construction worker", "mason", "carpenter", "plumber", "welder"] },
]);

export const PLACE_CATALOG_VERSION = "in-place-aliases-v2";
// ISO 3166-2 India principal state/UT codes used by this curated place list.
export const ISO_SUBDIVISION_CODES: ReadonlySet<string> = Object.freeze(new Set([
  "IN-KL", "IN-DL", "IN-UP", "IN-HR", "IN-MH", "IN-TN", "IN-AP", "IN-KA",
  "IN-CT", "IN-JH", "IN-AS", "IN-RJ", "IN-PB", "IN-WB", "IN-TG", "IN-GJ",
  "IN-MP", "IN-BR", "IN-CH",
]));

export const PLACE_SPECIAL_OPTIONS: readonly PlaceSpecialOption[] = Object.freeze([
  { code: "remote", label: "Remote", type: "option" },
  { code: "anywhere-in-india", label: "Anywhere in India", type: "option", countryCode: "IN" },
  { code: "anywhere-in-world", label: "Anywhere in the world", type: "option" },
]);

export const COUNTRY_ALIASES: readonly CountryAlias[] = Object.freeze([
  { code: "AE", label: "United Arab Emirates", aliases: ["UAE"] },
  { code: "SA", label: "Saudi Arabia", aliases: ["KSA"] },
  { code: "GB", label: "United Kingdom", aliases: ["UK", "England"] },
  { code: "US", label: "United States", aliases: ["USA", "US"] },
  { code: "IN", label: "India", aliases: [] },
  { code: "QA", label: "Qatar", aliases: [] },
  { code: "KW", label: "Kuwait", aliases: [] },
  { code: "OM", label: "Oman", aliases: [] },
  { code: "BH", label: "Bahrain", aliases: [] },
  { code: "IE", label: "Ireland", aliases: [] },
  { code: "CA", label: "Canada", aliases: [] },
  { code: "AU", label: "Australia", aliases: [] },
  { code: "DE", label: "Germany", aliases: [] },
  { code: "SG", label: "Singapore", aliases: [] },
  { code: "NZ", label: "New Zealand", aliases: [] },
]);

type RawPlaceTuple = [string, string[], string | null, string, string];

const places: RawPlaceTuple[] = [
  ["Kollam", ["Quilon"], "IN-KL", "in-kerala-kollam", "India"],
  ["Pathanamthitta", [], "IN-KL", "in-kerala-pathanamthitta", "India"],
  ["Alappuzha", ["Alleppey"], "IN-KL", "in-kerala-alappuzha", "India"],
  ["Kottayam", [], "IN-KL", "in-kerala-kottayam", "India"],
  ["Idukki", [], "IN-KL", "in-kerala-idukki", "India"],
  ["Ernakulam", [], "IN-KL", "in-kerala-ernakulam", "India"],
  ["Kochi", ["Cochin"], "IN-KL", "in-kerala-kochi", "India"],
  ["Thrissur", ["Trichur"], "IN-KL", "in-kerala-thrissur", "India"],
  ["Palakkad", ["Palghat"], "IN-KL", "in-kerala-palakkad", "India"],
  ["Malappuram", [], "IN-KL", "in-kerala-malappuram", "India"],
  ["Kozhikode", ["Calicut"], "IN-KL", "in-kerala-kozhikode", "India"],
  ["Wayanad", [], "IN-KL", "in-kerala-wayanad", "India"],
  ["Kannur", ["Cannanore"], "IN-KL", "in-kerala-kannur", "India"],
  ["Kasaragod", [], "IN-KL", "in-kerala-kasaragod", "India"],
  ["New Delhi", ["Delhi"], "IN-DL", "in-delhi-new-delhi", "India"],
  ["Thiruvananthapuram", ["Trivandrum"], "IN-KL", "in-kerala-thiruvananthapuram", "India"],
  ["Noida", [], "IN-UP", "in-uttar-pradesh-noida", "India"],
  ["Greater Noida", [], "IN-UP", "in-uttar-pradesh-greater-noida", "India"],
  ["Ghaziabad", [], "IN-UP", "in-uttar-pradesh-ghaziabad", "India"],
  ["Faridabad", [], "IN-HR", "in-haryana-faridabad", "India"],
  ["Thane", [], "IN-MH", "in-maharashtra-thane", "India"],
  ["Navi Mumbai", [], "IN-MH", "in-maharashtra-navi-mumbai", "India"],
  ["Nashik", [], "IN-MH", "in-maharashtra-nashik", "India"],
  ["Kanpur", [], "IN-UP", "in-uttar-pradesh-kanpur", "India"],
  ["Madurai", [], "IN-TN", "in-tamil-nadu-madurai", "India"],
  ["Tiruchirappalli", ["Trichy"], "IN-TN", "in-tamil-nadu-tiruchirappalli", "India"],
  ["Salem", [], "IN-TN", "in-tamil-nadu-salem", "India"],
  ["Tiruppur", [], "IN-TN", "in-tamil-nadu-tiruppur", "India"],
  ["Vijayawada", [], "IN-AP", "in-andhra-pradesh-vijayawada", "India"],
  ["Guntur", [], "IN-AP", "in-andhra-pradesh-guntur", "India"],
  ["Hubballi", ["Hubli"], "IN-KA", "in-karnataka-hubballi", "India"],
  ["Belagavi", ["Belgaum"], "IN-KA", "in-karnataka-belagavi", "India"],
  ["Raipur", [], "IN-CT", "in-chhattisgarh-raipur", "India"],
  ["Ranchi", [], "IN-JH", "in-jharkhand-ranchi", "India"],
  ["Guwahati", [], "IN-AS", "in-assam-guwahati", "India"],
  ["Jodhpur", [], "IN-RJ", "in-rajasthan-jodhpur", "India"],
  ["Udaipur", [], "IN-RJ", "in-rajasthan-udaipur", "India"],
  ["Amritsar", [], "IN-PB", "in-punjab-amritsar", "India"],
  ["Ludhiana", [], "IN-PB", "in-punjab-ludhiana", "India"],
  ["Varanasi", [], "IN-UP", "in-uttar-pradesh-varanasi", "India"],
  ["Agra", [], "IN-UP", "in-uttar-pradesh-agra", "India"],
  ["Bengaluru", ["Bangalore"], "IN-KA", "in-karnataka-bengaluru", "India"],
  ["Mumbai", [], "IN-MH", "in-maharashtra-mumbai", "India"],
  ["Chennai", [], "IN-TN", "in-tamil-nadu-chennai", "India"],
  ["Kolkata", [], "IN-WB", "in-west-bengal-kolkata", "India"],
  ["Hyderabad", [], "IN-TG", "in-telangana-hyderabad", "India"],
  ["Pune", [], "IN-MH", "in-maharashtra-pune", "India"],
  ["Ahmedabad", [], "IN-GJ", "in-gujarat-ahmedabad", "India"],
  ["Jaipur", [], "IN-RJ", "in-rajasthan-jaipur", "India"],
  ["Lucknow", [], "IN-UP", "in-uttar-pradesh-lucknow", "India"],
  ["Indore", [], "IN-MP", "in-madhya-pradesh-indore", "India"],
  ["Coimbatore", [], "IN-TN", "in-tamil-nadu-coimbatore", "India"],
  ["Patna", [], "IN-BR", "in-bihar-patna", "India"],
  ["Chandigarh", [], "IN-CH", "in-chandigarh-chandigarh", "India"],
  ["Dubai", [], null, "ae-dubai", "United Arab Emirates"],
  ["Abu Dhabi", [], null, "ae-abu-dhabi", "United Arab Emirates"],
  ["Sharjah", [], null, "ae-sharjah", "United Arab Emirates"],
  ["Riyadh", [], null, "sa-riyadh", "Saudi Arabia"],
  ["Jeddah", [], null, "sa-jeddah", "Saudi Arabia"],
  ["Dammam", [], null, "sa-dammam", "Saudi Arabia"],
  ["Doha", [], null, "qa-doha", "Qatar"],
  ["Muscat", [], null, "om-muscat", "Oman"],
  ["Kuwait City", [], null, "kw-kuwait-city", "Kuwait"],
  ["Manama", [], null, "bh-manama", "Bahrain"],
  ["London", [], null, "gb-london", "United Kingdom"],
  ["Dublin", [], null, "ie-dublin", "Ireland"],
  ["Toronto", [], null, "ca-toronto", "Canada"],
  ["Sydney", [], null, "au-sydney", "Australia"],
  ["New York", [], null, "us-new-york", "United States"],
  ["Los Angeles", [], null, "us-los-angeles", "United States"],
  ["Singapore", [], null, "sg-singapore", "Singapore"],
  ["Berlin", [], null, "de-berlin", "Germany"],
  ["Auckland", [], null, "nz-auckland", "New Zealand"],
];

export const PLACE_SUGGESTIONS: readonly PlaceSuggestion[] = Object.freeze(places.map(([label, aliases, subdivisionCode, code, country]) => ({
  code, label, aliases, subdivisionCode, district: label === "Kochi" ? "Ernakulam" : null, countryCode: country === "India" ? "IN" : country === "United Arab Emirates" ? "AE" : country === "Saudi Arabia" ? "SA" : country === "Qatar" ? "QA" : country === "Oman" ? "OM" : country === "Kuwait" ? "KW" : country === "Bahrain" ? "BH" : country === "United Kingdom" ? "GB" : country === "Ireland" ? "IE" : country === "Canada" ? "CA" : country === "Germany" ? "DE" : country === "Singapore" ? "SG" : country === "New Zealand" ? "NZ" : country === "United States" ? "US" : "AU",
  country,
})));

export function normalizeSuggestionQuery(value = ""): string {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function suggestRoles(query?: string): RoleSuggestion[] {
  const q = normalizeSuggestionQuery(query);
  const direct = ROLE_SUGGESTIONS.filter((role) => [role.label, ...role.aliases].some((item) => normalizeSuggestionQuery(item).includes(q)));
  if (direct.length || q.length < 5) return direct.slice(0, 12);
  const distance = (left: string, right: string): number => {
    let row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      const next = [i];
      for (let j = 1; j <= right.length; j += 1) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
      row = next;
    }
    return row[right.length];
  };
  return ROLE_SUGGESTIONS.map((role) => ({ role, distance: Math.min(...[role.label, ...role.aliases].map((item) => distance(q, normalizeSuggestionQuery(item)))) }))
    .filter((item) => item.distance <= Math.max(1, Math.floor(q.length * 0.18)))
    .sort((a, b) => a.distance - b.distance).slice(0, 8).map(({ role }) => role);
}

export function suggestPlaces(query?: string): Array<PlaceSpecialOption | PlaceSuggestion> {
  const q = normalizeSuggestionQuery(query);
  const special = PLACE_SPECIAL_OPTIONS.filter((option) => normalizeSuggestionQuery(option.label) === q);
  const countryMatches: PlaceSuggestion[] = COUNTRY_ALIASES.filter((country) => [country.label, ...country.aliases]
    .some((item) => normalizeSuggestionQuery(item).includes(q)))
    .map((country) => ({ code: country.code.toLowerCase(), label: country.label, aliases: country.aliases, subdivisionCode: null, district: null, countryCode: country.code, country: country.label, type: "country" }));
  const placeMatches = PLACE_SUGGESTIONS.filter((place) => [place.label, place.country, ...place.aliases]
    .some((item) => normalizeSuggestionQuery(item).includes(q)));
  return [...special, ...placeMatches, ...countryMatches].slice(0, 15);
}

const AMBIGUOUS_PLACE_NAMES = new Set(["delhi", "punjab", "hyderabad"]);
const STATE_LABELS = new Map<string, string>([
  ["IN-KL", "kerala"], ["IN-DL", "delhi"], ["IN-UP", "uttar pradesh"], ["IN-HR", "haryana"],
  ["IN-MH", "maharashtra"], ["IN-TN", "tamil nadu"], ["IN-AP", "andhra pradesh"],
  ["IN-KA", "karnataka"], ["IN-CT", "chhattisgarh"], ["IN-JH", "jharkhand"],
  ["IN-AS", "assam"], ["IN-RJ", "rajasthan"], ["IN-PB", "punjab"],
  ["IN-WB", "west bengal"], ["IN-TG", "telangana"], ["IN-GJ", "gujarat"],
  ["IN-MP", "madhya pradesh"], ["IN-BR", "bihar"], ["IN-CH", "chandigarh"],
]);

export function resolvePlacePair(query?: string): {
  needsConfirmation: boolean;
  question?: string;
  suggestions: Array<PlaceSpecialOption | PlaceSuggestion>;
} {
  const [rawPlace, rawRegion, ...extra] = String(query || "").split(",").map((part) => part.trim());
  if (!rawRegion || extra.length) return { needsConfirmation: false, suggestions: suggestPlaces(query) };
  const normalizedPlace = normalizeSuggestionQuery(rawPlace);
  if (AMBIGUOUS_PLACE_NAMES.has(normalizedPlace)) {
    return { needsConfirmation: true, question: "Is this in India?", suggestions: suggestPlaces(rawPlace).filter((item) => item.countryCode === "IN") };
  }
  const region = normalizeSuggestionQuery(rawRegion);
  const matches = PLACE_SUGGESTIONS.filter((place) => {
    const placeNames = [place.label, ...place.aliases].map(normalizeSuggestionQuery);
    const subdivisionLabel = place.subdivisionCode ? STATE_LABELS.get(place.subdivisionCode) : undefined;
    const regionMatches = Boolean(subdivisionLabel && subdivisionLabel === region);
    const countryMatches = normalizeSuggestionQuery(place.country) === region ||
      COUNTRY_ALIASES.some((country) => country.code === place.countryCode && [country.label, ...country.aliases].some((alias) => normalizeSuggestionQuery(alias) === region));
    return placeNames.includes(normalizedPlace) && (regionMatches || countryMatches);
  });
  return { needsConfirmation: false, suggestions: matches };
}
