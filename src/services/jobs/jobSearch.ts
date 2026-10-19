import { ROLE_SUGGESTIONS } from "../profileSuggestionCatalog.js";

const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "that",
  "this",
  "are",
  "you",
  "our",
  "your",
  "will",
  "role",
  "job",
  "work",
]);

const BASE_SKILL_VOCABULARY = [
  "javascript",
  "typescript",
  "python",
  "java",
  "golang",
  "rust",
  "react",
  "nextjs",
  "nodejs",
  "express",
  "mongodb",
  "postgresql",
  "mysql",
  "redis",
  "docker",
  "kubernetes",
  "aws",
  "azure",
  "gcp",
  "graphql",
  "tailwind",
  "nursing",
  "nurse",
  "registered",
  "clinical",
  "icu",
  "patient",
  "healthcare",
  "hospital",
  "pharmacy",
  "pharmacist",
  "accountant",
  "accounting",
  "finance",
  "bookkeeping",
  "audit",
  "taxation",
  "teacher",
  "teaching",
  "education",
  "curriculum",
  "logistics",
  "warehouse",
  "supply",
  "delivery",
  "operations",
  "marketing",
  "sales",
  "recruiter",
  "recruitment",
  "human",
  "resources",
  "customer",
  "support",
  "designer",
  "product",
  "frontend",
  "backend",
  "fullstack",
  "software",
  "engineer",
  "developer",
  "analyst",
  "data",
  "machine",
  "learning",
  "security",
  "cybersecurity",
  "devops",
  "platform",
  "mobile",
  "android",
  "ios",
  "electrician",
  "electrical",
  "civil",
  "mechanical",
  "construction",
  "hospitality",
  "chef",
  "cook",
];

const DEFAULT_VOCABULARY = (() => {
  const words = new Set(BASE_SKILL_VOCABULARY);
  for (const role of ROLE_SUGGESTIONS) {
    for (const text of [role.label, ...(role.aliases || [])]) {
      const tokens = String(text)
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}+#.]+/gu);
      if (tokens) {
        for (const token of tokens) {
          if (token.length >= 3 && !STOP_WORDS.has(token)) words.add(token);
        }
      }
    }
  }
  return [...words];
})();

export function tokenizeSearchText(value: unknown = ""): string[] {
  const matches =
    String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}+#.]+/gu) || [];
  return matches.filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

export interface JobForSearchLike {
  _id?: unknown;
  jobId?: string;
  title?: string;
  company?: string;
  tags?: string[];
  occupation?: string;
  searchTokens?: string[];
  postedDateKnown?: boolean;
  postedAt?: Date | string | null;
  structuredLocation?: {
    city?: string;
    countryCode?: string;
  };
  features?: {
    titleTokens?: string[];
    companyTokens?: string[];
    skills?: string[];
  };
  relevanceScore?: number;
}

/**
 * Build compact, deduplicated search tokens for a hot Job document.
 * Orders title tokens first, then company, then skills/tags/occupation/location.
 */
export function buildSearchTokens(job: JobForSearchLike = {}, maxTokens = 40): string[] {
  const titleTokens = job.features?.titleTokens?.length
    ? job.features.titleTokens
    : tokenizeSearchText(job.title);
  const companyTokens = job.features?.companyTokens?.length
    ? job.features.companyTokens
    : tokenizeSearchText(job.company);
  const skillTokens = (job.features?.skills || []).flatMap((skill) => tokenizeSearchText(skill));
  const tagTokens = (job.tags || []).slice(0, 15).flatMap((tag) => tokenizeSearchText(tag));
  const occupationTokens = tokenizeSearchText(job.occupation);
  const locationTokens = tokenizeSearchText(
    `${job.structuredLocation?.city || ""} ${job.structuredLocation?.countryCode || ""}`,
  );
  const combined = new Set([
    ...titleTokens,
    ...companyTokens,
    ...skillTokens,
    ...tagTokens,
    ...occupationTokens,
    ...locationTokens,
  ]);
  return [...combined].filter((token) => token && token.length >= 2).slice(0, maxTokens);
}

/**
 * Bounded Damerau-Levenshtein distance (supports adjacent transpositions and single edits).
 */
export function boundedEditDistance(left: string, right: string, maxDistance = 2): number {
  if (left === right) return 0;
  const lenLeft = left.length;
  const lenRight = right.length;
  if (Math.abs(lenLeft - lenRight) > maxDistance) return maxDistance + 1;

  const prevPrev = new Array<number>(lenRight + 1).fill(0);
  const prev = Array.from({ length: lenRight + 1 }, (_, idx) => idx);
  const curr = new Array<number>(lenRight + 1).fill(0);

  for (let i = 1; i <= lenLeft; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lenRight; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      let val = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        val = Math.min(val, prevPrev[j - 2] + 1);
      }
      curr[j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= lenRight; j += 1) {
      prevPrev[j] = prev[j];
      prev[j] = curr[j];
    }
  }
  return prev[lenRight];
}

export interface TokenGroup {
  original: string;
  exact: string;
  typos: string[];
  all: string[];
}

export interface ExpandedQuerySpec {
  normalizedQuery: string;
  tokens: string[];
  tokenGroups: TokenGroup[];
  typoCorrections: Record<string, string>;
}

/**
 * Expand query tokens with affordable typo tolerance against the known role/skill vocabulary.
 */
export function expandQueryTokensWithTypos(
  rawQuery = "",
  extraVocabulary: string[] = [],
): ExpandedQuerySpec {
  const tokens = [...new Set(tokenizeSearchText(rawQuery))].slice(0, 8);
  if (!tokens.length) {
    return {
      normalizedQuery: "",
      tokens: [],
      tokenGroups: [],
      typoCorrections: {},
    };
  }
  const vocab = extraVocabulary.length
    ? [...new Set([...DEFAULT_VOCABULARY, ...extraVocabulary])]
    : DEFAULT_VOCABULARY;
  const vocabSet = new Set(vocab);
  const typoCorrections: Record<string, string> = {};
  const tokenGroups: TokenGroup[] = tokens.map((token) => {
    if (token.length < 4 || vocabSet.has(token)) {
      return { original: token, exact: token, typos: [], all: [token] };
    }
    const maxDist = token.length >= 8 ? 2 : 1;
    const candidates: Array<{ word: string; dist: number; lengthDiff: number }> = [];
    for (const word of vocab) {
      if (word[0] !== token[0] && word[1] !== token[0]) continue;
      if (Math.abs(word.length - token.length) > maxDist) continue;
      const dist = boundedEditDistance(token, word, maxDist);
      if (dist > 0 && dist <= maxDist) {
        candidates.push({ word, dist, lengthDiff: Math.abs(word.length - token.length) });
      }
    }
    candidates.sort(
      (a, b) => a.dist - b.dist || a.lengthDiff - b.lengthDiff || a.word.localeCompare(b.word),
    );
    const typos = candidates.slice(0, 3).map((item) => item.word);
    if (typos.length) typoCorrections[token] = typos[0];
    return {
      original: token,
      exact: token,
      typos,
      all: [token, ...typos],
    };
  });

  return {
    normalizedQuery: tokens.join(" "),
    tokens,
    tokenGroups,
    typoCorrections,
  };
}

export interface RelevanceScoreResult {
  relevanceScore: number;
  lexicalScore: number;
  recencyScore: number;
}

/**
 * Deterministic relevance + recency scoring for catalog search.
 * Uses quantized reference day (UTC midnight) so scores remain stable across cursor pages.
 */
export function scoreCatalogSearchRelevance(
  job: JobForSearchLike = {},
  querySpec?: ExpandedQuerySpec | null,
  asOfDayMs: number | null = null,
): RelevanceScoreResult {
  const referenceMs =
    typeof asOfDayMs === "number" && Number.isFinite(asOfDayMs) && asOfDayMs > 0
      ? asOfDayMs
      : Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());

  const postedAtMs =
    job.postedDateKnown !== false && job.postedAt ? Date.parse(String(job.postedAt)) : Number.NaN;
  const ageDays = Number.isFinite(postedAtMs)
    ? Math.max(0, (referenceMs - postedAtMs) / 86400000)
    : 30;
  const recencyScore = Number.isFinite(postedAtMs)
    ? Math.round(15 * Math.max(0, 1 - ageDays / 30))
    : 3;

  if (!querySpec || !querySpec.tokenGroups?.length) {
    return {
      relevanceScore: recencyScore,
      lexicalScore: 0,
      recencyScore,
    };
  }

  const titleTokens = new Set(
    job.features?.titleTokens?.length ? job.features.titleTokens : tokenizeSearchText(job.title),
  );
  const companyTokens = new Set(
    job.features?.companyTokens?.length
      ? job.features.companyTokens
      : tokenizeSearchText(job.company),
  );
  const skillTokens = new Set([
    ...(job.features?.skills || []).flatMap((skill) => tokenizeSearchText(skill)),
    ...(job.tags || []).flatMap((tag) => tokenizeSearchText(tag)),
  ]);
  const searchTokens = new Set(job.searchTokens || []);

  let lexicalScore = 0;
  for (const group of querySpec.tokenGroups) {
    if (titleTokens.has(group.exact)) {
      lexicalScore += 10;
    } else if (group.typos.some((typo) => titleTokens.has(typo))) {
      lexicalScore += 6;
    }

    if (skillTokens.has(group.exact)) {
      lexicalScore += 6;
    } else if (group.typos.some((typo) => skillTokens.has(typo))) {
      lexicalScore += 3;
    }

    if (companyTokens.has(group.exact)) {
      lexicalScore += 5;
    } else if (group.typos.some((typo) => companyTokens.has(typo))) {
      lexicalScore += 3;
    }

    if (
      !titleTokens.has(group.exact) &&
      !skillTokens.has(group.exact) &&
      !companyTokens.has(group.exact) &&
      (searchTokens.has(group.exact) || group.typos.some((typo) => searchTokens.has(typo)))
    ) {
      lexicalScore += 2;
    }
  }

  if (querySpec.normalizedQuery.includes(" ")) {
    const normalizedTitle = tokenizeSearchText(job.title).join(" ");
    if (normalizedTitle.includes(querySpec.normalizedQuery)) {
      lexicalScore += 15;
    }
  }

  return {
    relevanceScore: lexicalScore + recencyScore,
    lexicalScore,
    recencyScore,
  };
}

/**
 * Comparator for relevance sort: (relevanceScore DESC, postedAt DESC, _id ASC)
 */
export function compareJobsByRelevance(a: JobForSearchLike, b: JobForSearchLike): number {
  if ((b.relevanceScore || 0) !== (a.relevanceScore || 0)) {
    return (b.relevanceScore || 0) - (a.relevanceScore || 0);
  }
  const aPosted = a.postedAt ? new Date(a.postedAt).getTime() : -1;
  const bPosted = b.postedAt ? new Date(b.postedAt).getTime() : -1;
  if (bPosted !== aPosted) {
    return bPosted - aPosted;
  }
  return String(a._id || a.jobId).localeCompare(String(b._id || b.jobId));
}

export interface RelevanceCursorLike {
  relevanceScore?: number | null;
  postedAt?: Date | string | null;
  id?: string;
  [key: string]: unknown;
}

/**
 * Returns true if `job` strictly follows `cursor` in the relevance sort order.
 */
export function isAfterRelevanceCursor(
  job: JobForSearchLike,
  cursor: RelevanceCursorLike | null | undefined,
): boolean {
  if (!cursor || typeof cursor.relevanceScore !== "number") return true;
  const score = job.relevanceScore || 0;
  if (score < cursor.relevanceScore) return true;
  if (score > cursor.relevanceScore) return false;

  const jobPosted = job.postedAt ? new Date(job.postedAt).getTime() : -1;
  const cursorPosted = cursor.postedAt ? new Date(cursor.postedAt).getTime() : -1;
  if (jobPosted < cursorPosted) return true;
  if (jobPosted > cursorPosted) return false;

  return String(job._id || job.jobId) > String(cursor.id);
}
