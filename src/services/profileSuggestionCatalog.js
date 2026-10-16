export const ROLE_SUGGESTIONS = Object.freeze([
  { code: "software-engineer", label: "Software Engineer", aliases: ["software engineer", "software developer", "backend engineer", "frontend engineer", "full stack developer", "web developer", "programmer"] },
  { code: "staff-nurse", label: "Staff Nurse", aliases: ["staff nurse", "registered nurse", "rn", "nurse", "nursing"] },
  { code: "gnm-nurse", label: "GNM Nurse", aliases: ["gnm", "general nursing and midwifery"] },
  { code: "icu-nurse", label: "ICU Nurse", aliases: ["icu nurse", "critical care nurse", "ward nurse"] },
  { code: "teacher", label: "Teacher", aliases: ["teacher", "school teacher", "educator", "tutor", "lecturer"] },
  { code: "accountant", label: "Accountant", aliases: ["accountant", "accounts executive", "bookkeeper", "auditor"] },
  { code: "sales-executive", label: "Sales Executive", aliases: ["sales executive", "sales representative", "account executive", "business development executive"] },
  { code: "delivery-associate", label: "Delivery Associate", aliases: ["delivery", "delivery associate", "courier", "delivery driver"] },
  { code: "data-analyst", label: "Data Analyst", aliases: ["data analyst", "business analyst"] },
  { code: "customer-support", label: "Customer Support", aliases: ["customer support", "customer service", "support representative"] },
  { code: "nursing-assistant", label: "Nursing Assistant", aliases: ["nursing assistant", "healthcare assistant", "patient care assistant"] },
  { code: "pharmacist", label: "Pharmacist", aliases: ["pharmacist", "clinical pharmacist"] },
  { code: "physiotherapist", label: "Physiotherapist", aliases: ["physiotherapist", "physical therapist"] },
  { code: "lab-technologist", label: "Lab Technologist", aliases: ["lab technologist", "medical laboratory technician", "lab technician"] },
]);

export const PLACE_CATALOG_VERSION = "in-place-aliases-v2";
// ISO 3166-2 India principal state/UT codes used by this curated place list.
export const ISO_SUBDIVISION_CODES = Object.freeze(new Set([
  "IN-KL", "IN-DL", "IN-UP", "IN-HR", "IN-MH", "IN-TN", "IN-AP", "IN-KA",
  "IN-CT", "IN-JH", "IN-AS", "IN-RJ", "IN-PB", "IN-WB", "IN-TG", "IN-GJ",
  "IN-MP", "IN-BR", "IN-CH",
]));
export const PLACE_SPECIAL_OPTIONS = Object.freeze([
  { code: "remote", label: "Remote", type: "option" },
  { code: "anywhere-in-india", label: "Anywhere in India", type: "option", countryCode: "IN" },
]);
export const COUNTRY_ALIASES = Object.freeze([
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

const places = [
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

export const PLACE_SUGGESTIONS = Object.freeze(places.map(([label, aliases, subdivisionCode, code, country]) => ({
  code, label, aliases, subdivisionCode, district: label === "Kochi" ? "Ernakulam" : null, countryCode: country === "India" ? "IN" : country === "United Arab Emirates" ? "AE" : country === "Saudi Arabia" ? "SA" : country === "Qatar" ? "QA" : country === "Oman" ? "OM" : country === "Kuwait" ? "KW" : country === "Bahrain" ? "BH" : country === "United Kingdom" ? "GB" : country === "Ireland" ? "IE" : country === "Canada" ? "CA" : country === "Germany" ? "DE" : country === "Singapore" ? "SG" : country === "New Zealand" ? "NZ" : country === "United States" ? "US" : "AU",
  country,
})));

export function normalizeSuggestionQuery(value = "") {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function suggestRoles(query) {
  const q = normalizeSuggestionQuery(query);
  return ROLE_SUGGESTIONS.filter((role) => [role.label, ...role.aliases].some((item) => normalizeSuggestionQuery(item).includes(q))).slice(0, 12);
}

export function suggestPlaces(query) {
  const q = normalizeSuggestionQuery(query);
  const special = PLACE_SPECIAL_OPTIONS.filter((option) => normalizeSuggestionQuery(option.label) === q);
  const countryMatches = COUNTRY_ALIASES.filter((country) => [country.label, ...country.aliases]
    .some((item) => normalizeSuggestionQuery(item).includes(q)))
    .map((country) => ({ code: country.code.toLowerCase(), label: country.label, aliases: country.aliases, countryCode: country.code, country: country.label, type: "country" }));
  const placeMatches = PLACE_SUGGESTIONS.filter((place) => [place.label, place.country, ...place.aliases]
    .some((item) => normalizeSuggestionQuery(item).includes(q)));
  return [...special, ...placeMatches, ...countryMatches].slice(0, 15);
}

const AMBIGUOUS_PLACE_NAMES = new Set(["delhi", "punjab", "hyderabad"]);
const STATE_LABELS = new Map([
  ["IN-KL", "kerala"], ["IN-DL", "delhi"], ["IN-UP", "uttar pradesh"], ["IN-HR", "haryana"],
  ["IN-MH", "maharashtra"], ["IN-TN", "tamil nadu"], ["IN-AP", "andhra pradesh"],
  ["IN-KA", "karnataka"], ["IN-CT", "chhattisgarh"], ["IN-JH", "jharkhand"],
  ["IN-AS", "assam"], ["IN-RJ", "rajasthan"], ["IN-PB", "punjab"],
  ["IN-WB", "west bengal"], ["IN-TG", "telangana"], ["IN-GJ", "gujarat"],
  ["IN-MP", "madhya pradesh"], ["IN-BR", "bihar"], ["IN-CH", "chandigarh"],
]);

export function resolvePlacePair(query) {
  const [rawPlace, rawRegion, ...extra] = String(query || "").split(",").map((part) => part.trim());
  if (!rawRegion || extra.length) return { needsConfirmation: false, suggestions: suggestPlaces(query) };
  const normalizedPlace = normalizeSuggestionQuery(rawPlace);
  if (AMBIGUOUS_PLACE_NAMES.has(normalizedPlace)) {
    return { needsConfirmation: true, question: "Is this in India?", suggestions: suggestPlaces(rawPlace).filter((item) => item.countryCode === "IN") };
  }
  const region = normalizeSuggestionQuery(rawRegion);
  const matches = PLACE_SUGGESTIONS.filter((place) => {
    const placeNames = [place.label, ...place.aliases].map(normalizeSuggestionQuery);
    const subdivisionLabel = STATE_LABELS.get(place.subdivisionCode);
    const regionMatches = subdivisionLabel && subdivisionLabel === region;
    const countryMatches = normalizeSuggestionQuery(place.country) === region ||
      COUNTRY_ALIASES.some((country) => country.code === place.countryCode && [country.label, ...country.aliases].some((alias) => normalizeSuggestionQuery(alias) === region));
    return placeNames.includes(normalizedPlace) && (regionMatches || countryMatches);
  });
  return { needsConfirmation: false, suggestions: matches };
}
