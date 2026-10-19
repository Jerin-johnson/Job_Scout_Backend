export const JOB_DETAIL_FIELDS = Object.freeze([
  "rawDescription",
  "requirements",
  "provenance",
] as const);
export const JOB_VECTOR_FIELDS = Object.freeze(["embedding", "embeddingMetadata"] as const);

export interface JobProvenanceItem {
  source?: string;
  sourceJobId?: string;
  canonicalUrl?: string;
  attributionText?: string;
  attributionUrl?: string;
  seenAt?: Date | null;
  [key: string]: unknown;
}

export function normalizeProvenanceList(list: unknown[] = []): JobProvenanceItem[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (!item || typeof item !== "object") return {};
    const { _id: _omittedId, ...rest } = item as Record<string, unknown>;
    if ("source" in rest || "sourceJobId" in rest || "canonicalUrl" in rest) {
      return {
        source: String(rest.source || ""),
        sourceJobId: String(rest.sourceJobId || ""),
        canonicalUrl: String(rest.canonicalUrl || ""),
        attributionText: String(rest.attributionText || ""),
        attributionUrl: String(rest.attributionUrl || ""),
        seenAt: rest.seenAt ? new Date(rest.seenAt as string | number | Date) : null,
      };
    }
    return rest as JobProvenanceItem;
  });
}

function trimTokenArray(list: unknown, limit: number, maxLen = 32): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const clean = String(item || "").trim();
    if (!clean || clean.length > maxLen || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

export interface HotFeaturesSlim {
  version: number;
  skills: string[];
  titleTokens: string[];
  occupation: string;
  seniority: string;
  employmentType: string;
  workMode: string;
  experienceYears?: number | null;
  requiredSkills?: string[];
  preferredSkills?: string[];
  companyTokens?: string[];
  education?: string[];
  licenses?: string[];
  eligibilityHints?: string[];
}

export function compactHotFeatures(features: Record<string, unknown> | null | undefined): unknown {
  if (!features || typeof features !== "object") return features;
  const slim: HotFeaturesSlim = {
    version: Number(features.version) || 1,
    skills: trimTokenArray(features.skills, 8, 24),
    titleTokens: trimTokenArray(features.titleTokens, 6, 20),
    occupation: String(features.occupation || "unclassified"),
    seniority: String(features.seniority || "mid"),
    employmentType: String(features.employmentType || "unknown"),
    workMode: String(features.workMode || "unknown"),
  };
  if (features.experienceYears !== null && features.experienceYears !== undefined) {
    slim.experienceYears = Number(features.experienceYears);
  }
  const requiredSkills = trimTokenArray(features.requiredSkills, 4, 24);
  if (requiredSkills.length) slim.requiredSkills = requiredSkills;
  const preferredSkills = trimTokenArray(features.preferredSkills, 3, 24);
  if (preferredSkills.length) slim.preferredSkills = preferredSkills;
  const companyTokens = trimTokenArray(features.companyTokens, 2, 18);
  if (companyTokens.length) slim.companyTokens = companyTokens;
  const education = trimTokenArray(features.education, 2, 16);
  if (education.length) slim.education = education;
  const licenses = trimTokenArray(features.licenses, 3, 24);
  if (licenses.length) slim.licenses = licenses;
  const eligibilityHints = trimTokenArray(features.eligibilityHints, 2, 20);
  if (eligibilityHints.length) slim.eligibilityHints = eligibilityHints;
  return slim;
}

export function compactHotJobFields(job: Record<string, unknown> = {}): Record<string, unknown> {
  const projected = { ...job };
  for (const field of JOB_DETAIL_FIELDS) delete projected[field];
  for (const field of JOB_VECTOR_FIELDS) delete projected[field];
  if (projected.features && typeof projected.features === "object") {
    projected.features = compactHotFeatures(projected.features as Record<string, unknown>);
  }
  if (Array.isArray(projected.tags)) {
    projected.tags = trimTokenArray(projected.tags, 4, 20);
  }
  if (Array.isArray(projected.searchTokens)) {
    projected.searchTokens = trimTokenArray(projected.searchTokens, 6, 20);
  }
  if (projected.eligibility && typeof projected.eligibility === "object") {
    const origElig = projected.eligibility as Record<string, unknown>;
    const elig: Record<string, unknown> = {
      version: origElig.version || 1,
      remoteScope: origElig.remoteScope || "unknown",
      sponsorship: Boolean(origElig.sponsorship),
      workAuthorizationRequired: Boolean(origElig.workAuthorizationRequired),
      confidence: Number(origElig.confidence || 0),
    };
    if (Array.isArray(origElig.countries) && origElig.countries.length) {
      elig.countries = origElig.countries.slice(0, 6);
    }
    if (origElig.evidence) {
      elig.evidence = String(origElig.evidence).slice(0, 32);
    }
    projected.eligibility = elig;
  }
  if (projected.structuredLocation && typeof projected.structuredLocation === "object") {
    const origLoc = projected.structuredLocation as Record<string, unknown>;
    const loc: Record<string, unknown> = {
      countryCode: origLoc.countryCode || "",
      remoteScope: origLoc.remoteScope || "unknown",
    };
    if (origLoc.region) loc.region = origLoc.region;
    if (origLoc.city) loc.city = origLoc.city;
    if (Array.isArray(origLoc.eligibleCountryCodes) && origLoc.eligibleCountryCodes.length) {
      loc.eligibleCountryCodes = origLoc.eligibleCountryCodes.slice(0, 6);
    }
    if (Array.isArray(origLoc.workAuthorization) && origLoc.workAuthorization.length) {
      loc.workAuthorization = origLoc.workAuthorization.slice(0, 3);
    }
    projected.structuredLocation = loc;
  }
  if (projected.compensation && typeof projected.compensation === "object") {
    const origComp = projected.compensation as Record<string, unknown>;
    const comp: Record<string, unknown> = {
      payPeriod: origComp.payPeriod || "unknown",
    };
    if (origComp.originalText)
      comp.originalText = String(origComp.originalText).slice(0, 60);
    if (origComp.currency) comp.currency = origComp.currency;
    if (origComp.min !== null && origComp.min !== undefined)
      comp.min = origComp.min;
    if (origComp.max !== null && origComp.max !== undefined)
      comp.max = origComp.max;
    if (
      origComp.normalizedAnnualMin !== null &&
      origComp.normalizedAnnualMin !== undefined
    ) {
      comp.normalizedAnnualMin = origComp.normalizedAnnualMin;
    }
    if (
      origComp.normalizedAnnualMax !== null &&
      origComp.normalizedAnnualMax !== undefined
    ) {
      comp.normalizedAnnualMax = origComp.normalizedAnnualMax;
    }
    if (origComp.normalizedCurrency)
      comp.normalizedCurrency = origComp.normalizedCurrency;
    projected.compensation = comp;
  }
  return projected;
}

export interface SplitJobResult {
  catalog: Record<string, unknown>;
  details: {
    description: string;
    requirements: unknown[];
    provenance: JobProvenanceItem[];
  };
  vector: {
    vector: number[];
    provider: string;
    model: string;
    dimension: number;
  } | null;
}

export function splitJobForStorage(job: Record<string, unknown>): SplitJobResult {
  const {
    rawDescription = "",
    requirements = [],
    provenance = [],
    embedding,
    embeddingMetadata,
    ...rest
  } = job;
  const catalog = compactHotJobFields(rest);
  const embMetadata = embeddingMetadata as Record<string, unknown> | undefined;
  const embArray = Array.isArray(embedding) ? (embedding as number[]) : [];
  return {
    catalog,
    details: {
      description: String(rawDescription || ""),
      requirements: Array.isArray(requirements) ? requirements : [],
      provenance: normalizeProvenanceList(Array.isArray(provenance) ? provenance : []),
    },
    vector:
      embArray.length > 0
        ? {
            vector: embArray,
            provider: String(embMetadata?.provider || "legacy"),
            model: String(embMetadata?.model || "unknown"),
            dimension: Number(embMetadata?.dimension) || embArray.length,
          }
        : null,
  };
}

export function projectJobDetail<T extends Record<string, unknown>>(
  job: T | null | undefined,
  detail?: { description?: string; requirements?: unknown[]; provenance?: unknown[] } | null,
): T | (T & { rawDescription: string; requirements: unknown[]; provenance: JobProvenanceItem[] }) {
  if (!job) return job as unknown as T;
  return {
    ...job,
    rawDescription: detail?.description ?? (job.rawDescription as string) ?? "",
    requirements: detail?.requirements ?? (job.requirements as unknown[]) ?? [],
    provenance: detail?.provenance
      ? normalizeProvenanceList(detail.provenance)
      : normalizeProvenanceList((job.provenance as unknown[]) ?? []),
  };
}

export interface CatalogCursor {
  id: string;
  postedAt?: string | null;
  relevanceScore?: number | null;
  asOfDay?: number | null;
  [key: string]: unknown;
}

export function encodeCatalogCursor(value: CatalogCursor): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCatalogCursor(value: string | null | undefined): CatalogCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8")) as CatalogCursor;
    if (
      !/^[a-f\d]{24}$/i.test(parsed.id) ||
      (parsed.postedAt !== null && parsed.postedAt !== undefined && !Number.isFinite(Date.parse(parsed.postedAt))) ||
      (parsed.relevanceScore !== undefined &&
        parsed.relevanceScore !== null &&
        !Number.isFinite(parsed.relevanceScore)) ||
      (parsed.asOfDay !== undefined && parsed.asOfDay !== null && !Number.isFinite(parsed.asOfDay))
    ) {
      throw new Error();
    }
    return parsed;
  } catch {
    const error = new Error("The job list cursor is invalid. Refresh the list and try again.") as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = 400;
    error.code = "INVALID_CATALOG_CURSOR";
    throw error;
  }
}
