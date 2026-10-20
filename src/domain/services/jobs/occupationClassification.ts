import { ROLE_SUGGESTIONS } from "../profile/profileSuggestionCatalog.js";
import { ONET_SUBSET } from "./referenceData/index.js";

export const OCCUPATION_FEATURES_VERSION = 8;

const normalize = (value = ""): string =>
  String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

interface RoleRule {
  role: { family: string; label: string };
  alias: string;
}

const ROLE_RULES: RoleRule[] = ROLE_SUGGESTIONS.flatMap((role) =>
  [role.label, ...(role.aliases || [])].map((alias) => ({
    role: { family: role.family, label: role.label },
    alias: normalize(alias),
  })),
).sort((left, right) => right.alias.length - left.alias.length);

interface CategoryRule {
  family: string;
  label: string;
  aliases: string[];
}

const SOURCE_CATEGORY_RULES: CategoryRule[] = [
  {
    family: "software",
    label: "Software Engineer",
    aliases: [
      "software",
      "software engineering",
      "software development",
      "information technology",
      "information technology it",
      "devops",
      "platform engineering",
      "web development",
      "informatique",
      "développement logiciel",
      "softwareentwicklung",
      "systemutveckling",
      "desarrollo de software",
    ],
  },
  {
    family: "nursing",
    label: "Staff Nurse",
    aliases: [
      "nursing",
      "nurse",
      "healthcare nursing",
      "clinical care",
      "nursing clinical care",
      "soins infirmiers",
      "infirmier",
      "infirmière",
      "krankenpflege",
      "pflegefachkraft",
      "sjuksköterska",
      "sjukskoterska",
      "enfermería",
      "enfermeria",
      "enfermagem",
    ],
  },
  {
    family: "healthcare",
    label: "Healthcare Professional",
    aliases: [
      "healthcare",
      "health care",
      "medical",
      "pharmacy",
      "pharmacist",
      "physiotherapy",
      "laboratory",
      "santé",
      "sante",
      "médecine",
      "medecine",
      "gesundheitswesen",
      "hälso sjukvård",
      "halsa sjukvard",
      "salud",
      "saúde",
      "saude",
    ],
  },
  {
    family: "education",
    label: "Teacher",
    aliases: [
      "education",
      "education e learning",
      "teaching",
      "teacher",
      "academic",
      "enseignement",
      "éducation",
      "education",
      "lehrkraft",
      "bildung",
      "lärare",
      "larare",
      "docencia",
      "educación",
      "educacion",
    ],
  },
  {
    family: "accounting-finance",
    label: "Accountant",
    aliases: [
      "accounting",
      "finance",
      "finance accounting",
      "bookkeeping",
      "audit",
      "comptabilité",
      "comptabilite",
      "finance comptabilité",
      "buchhaltung",
      "rechnungswesen",
      "redovisning",
      "bokföring",
      "bokforing",
      "contabilidad",
      "contabilidade",
    ],
  },
  {
    family: "sales",
    label: "Sales Executive",
    aliases: [
      "sales",
      "business development",
      "sales business development",
      "account executive",
      "vente",
      "ventes",
      "vertrieb",
      "försäljning",
      "forsaljning",
      "ventas",
      "vendas",
    ],
  },
  {
    family: "delivery-logistics",
    label: "Delivery Executive",
    aliases: [
      "delivery",
      "logistics",
      "warehouse",
      "transport",
      "courier",
      "logistique",
      "transport et logistique",
      "logistik",
      "lager",
      "logística",
      "logistica",
      "transporte",
    ],
  },
  {
    family: "customer-support",
    label: "Customer Support",
    aliases: [
      "customer service",
      "customer support",
      "customer support success",
      "call center",
      "contact centre",
      "service client",
      "kundservice",
      "kundenservice",
      "atención al cliente",
      "atencion al cliente",
      "atendimento ao cliente",
    ],
  },
  {
    family: "electrical-trades",
    label: "Electrician",
    aliases: ["electrician", "electrical", "maintenance trades"],
  },
  {
    family: "food-hospitality",
    label: "Cook / Chef",
    aliases: [
      "hospitality",
      "food service",
      "chef",
      "cook",
      "restaurant",
      "hôtellerie restauration",
      "hotellerie restauration",
      "gastronomie",
      "besöksnäring",
      "besoksnaring",
      "hostelería",
      "hosteleria",
      "hotelaria",
    ],
  },
  {
    family: "engineering",
    label: "Civil Engineer",
    aliases: [
      "civil engineering",
      "construction engineering",
      "structural engineering",
      "génie civil",
      "genie civil",
      "bauingenieurwesen",
      "byggteknik",
      "ingeniería civil",
      "engenharia civil",
    ],
  },
  {
    family: "design",
    label: "Product Designer",
    aliases: ["web ui ux design", "graphic design", "user experience", "ux design"],
  },
  {
    family: "business",
    label: "Business Analyst",
    aliases: ["business analysis", "business analyst", "analytics"],
  },
  {
    family: "human-resources",
    label: "HR / Recruiter",
    aliases: [
      "human resources",
      "recruitment",
      "talent acquisition",
      "ressources humaines",
      "recrutement",
      "personalwesen",
      "rekrutierung",
      "human resources",
      "rekrytering",
      "recursos humanos",
      "recrutamento",
    ],
  },
  {
    family: "marketing",
    label: "Marketing Executive",
    aliases: [
      "marketing",
      "digital marketing",
      "marketing sales",
      "seo",
      "content marketing",
      "marketing digital",
      "marketing numérique",
      "marketing numerique",
      "marknadsföring",
      "marknadsforing",
      "mercadotecnia",
      "marketing digital",
    ],
  },
  {
    family: "operations",
    label: "Operations Associate",
    aliases: [
      "operations",
      "product operations",
      "administration",
      "office support",
      "project management",
      "opérations",
      "operations",
      "verwaltung",
      "betrieb",
      "verksamhetsutveckling",
      "operaciones",
      "operações",
      "operacoes",
    ],
  },
  {
    family: "security",
    label: "Security Guard",
    aliases: [
      "security",
      "cybersecurity",
      "safety and security",
      "sécurité",
      "securite",
      "sicherheit",
      "säkerhet",
      "sakerhet",
      "seguridad",
      "segurança",
      "seguranca",
    ],
  },
  {
    family: "construction-trades",
    label: "Construction Worker",
    aliases: [
      "construction",
      "carpentry",
      "plumbing",
      "welding",
      "skilled trades",
      "bâtiment",
      "batiment",
      "construction bâtiment",
      "bauwesen",
      "snickeri",
      "construcción",
      "construcao",
      "construção",
    ],
  },
];

const onetTitleRules: CategoryRule[] = (ONET_SUBSET.occupations || []).map((occ) => ({
  family: String(occ.family || "unclassified"),
  label: String(occ.label || ""),
  aliases: Array.isArray(occ.aliases) ? (occ.aliases as unknown[]).map(String) : [],
}));

const TITLE_RULES: CategoryRule[] = [
  ...onetTitleRules,
  { family: "software", label: "Software Engineer", aliases: ["analytics lead full stack"] },
  {
    family: "nursing",
    label: "Staff Nurse",
    aliases: [
      "infirmier",
      "infirmière",
      "infirmier diplômé",
      "infirmière diplômée",
      "pflegefachkraft",
      "gesundheits und krankenpfleger",
      "sjuksköterska",
      "sjukskoterska",
      "enfermero",
      "enfermera",
      "enfermeiro",
      "enfermeira",
    ],
  },
  {
    family: "accounting-finance",
    label: "Accountant",
    aliases: [
      "comptable",
      "expert comptable",
      "buchhalter",
      "bilanzbuchhalter",
      "redovisningsekonom",
      "revisor",
      "contable",
      "contador",
      "contabilista",
    ],
  },
  {
    family: "delivery-logistics",
    label: "Logistics Coordinator",
    aliases: [
      "coordinateur logistique",
      "coordinatrice logistique",
      "logistikkoordinator",
      "logistikkoordinator",
      "coordinador logístico",
      "coordenador de logística",
    ],
  },
  {
    family: "education",
    label: "Teacher",
    aliases: [
      "enseignant",
      "enseignante",
      "lehrer",
      "lehrerin",
      "förskollärare",
      "forskollare",
      "enseñante",
      "profesor",
      "profesora",
      "professor",
    ],
  },
  {
    family: "human-resources",
    label: "HR / Recruiter",
    aliases: [
      "recruteur",
      "recruteuse",
      "recruiter",
      "recruitment consultant",
      "recruitment coordinator",
      "personalreferent",
      "talent acquisition specialist",
      "recruiter",
    ],
  },
  {
    family: "food-hospitality",
    label: "Cook / Chef",
    aliases: [
      "cuisinier",
      "cuisinière",
      "koch",
      "köchin",
      "kok",
      "kock",
      "camarero",
      "camarera",
      "camarero de piso",
    ],
  },
  {
    family: "construction-trades",
    label: "Construction Worker",
    aliases: [
      "maçon",
      "macon",
      "maçonne",
      "zimmermann",
      "dachdecker",
      "plombier",
      "plombière",
      "svetsare",
      "snickare",
      "carpintero",
      "carpintera",
      "carpinteiro",
      "carpinteira",
    ],
  },
];

interface NormalizedRule {
  family: string;
  label: string;
  alias: string;
}

const NORMALIZED_TITLE_RULES: NormalizedRule[] = TITLE_RULES.flatMap((rule) =>
  rule.aliases.map((alias) => ({ ...rule, alias: normalize(alias) })),
).sort((left, right) => right.alias.length - left.alias.length);

function titleCase(value: string): string {
  return normalize(value).replace(/\b([\p{L}\p{N}])/gu, (letter) => letter.toLocaleUpperCase());
}

function matchRoleTitle(title: string | undefined): { family: string; label: string } | null {
  const normalizedTitle = normalize(title);
  if (!normalizedTitle) return null;
  const roleRule = ROLE_RULES.find(({ alias }) => ` ${normalizedTitle} `.includes(` ${alias} `));
  const addedRule = NORMALIZED_TITLE_RULES.find(({ alias }) =>
    ` ${normalizedTitle} `.includes(` ${alias} `),
  );
  if (roleRule && addedRule) {
    return addedRule.alias.length > roleRule.alias.length
      ? { family: addedRule.family, label: addedRule.label }
      : roleRule.role;
  }
  if (roleRule) return roleRule.role;
  if (addedRule) return { family: addedRule.family, label: addedRule.label };
  return null;
}

function matchCategory(values: unknown[] = []): CategoryRule | null {
  const candidates = values
    .map((value) =>
      normalize(
        String(value || "")
          .split(":")
          .at(-1),
      ),
    )
    .filter(Boolean);
  return (
    SOURCE_CATEGORY_RULES.find((rule) =>
      rule.aliases.some((alias) => {
        const normalizedAlias = normalize(alias);
        return candidates.some(
          (candidate) =>
            candidate === normalizedAlias || ` ${candidate} `.includes(` ${normalizedAlias} `),
        );
      }),
    ) || null
  );
}

export interface JobForClassificationLike {
  title?: string;
  sourceCategory?: string;
  category?: string;
  categories?: string[];
  occupationCodes?: string[];
  tags?: string[];
}

export interface JobOccupationClassification {
  occupation: string;
  occupationConfidence: number;
  normalizedTitle: string;
  occupationFeaturesVersion: number;
}

export function classifyJobOccupation(
  job: JobForClassificationLike = {},
): JobOccupationClassification {
  const titleMatch = matchRoleTitle(job.title);
  if (titleMatch)
    return {
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
  if (tagCategoryMatch)
    return {
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
