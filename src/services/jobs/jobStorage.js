export const JOB_DETAIL_FIELDS = Object.freeze(["rawDescription", "requirements", "provenance"]);
export const JOB_VECTOR_FIELDS = Object.freeze(["embedding", "embeddingMetadata"]);

export function normalizeProvenanceList(list = []) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (!item || typeof item !== "object") return {};
    const { _id, ...rest } = item;
    if ("source" in rest || "sourceJobId" in rest || "canonicalUrl" in rest) {
      return {
        source: String(rest.source || ""),
        sourceJobId: String(rest.sourceJobId || ""),
        canonicalUrl: String(rest.canonicalUrl || ""),
        attributionText: String(rest.attributionText || ""),
        attributionUrl: String(rest.attributionUrl || ""),
        seenAt: rest.seenAt ? new Date(rest.seenAt) : null,
      };
    }
    return rest;
  });
}

function trimTokenArray(list, limit, maxLen = 32) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const clean = String(item || "").trim();
    if (!clean || clean.length > maxLen || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

export function compactHotFeatures(features) {
  if (!features || typeof features !== "object") return features;
  const slim = {
    version: features.version || 1,
    skills: trimTokenArray(features.skills, 8, 24),
    titleTokens: trimTokenArray(features.titleTokens, 6, 20),
    occupation: features.occupation || "unclassified",
    seniority: features.seniority || "mid",
    employmentType: features.employmentType || "unknown",
    workMode: features.workMode || "unknown",
  };
  if (features.experienceYears !== null && features.experienceYears !== undefined) {
    slim.experienceYears = features.experienceYears;
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

export function compactHotJobFields(job = {}) {
  const projected = { ...job };
  for (const field of JOB_DETAIL_FIELDS) delete projected[field];
  for (const field of JOB_VECTOR_FIELDS) delete projected[field];
  if (projected.features && typeof projected.features === "object") {
    projected.features = compactHotFeatures(projected.features);
  }
  if (Array.isArray(projected.tags)) {
    projected.tags = trimTokenArray(projected.tags, 4, 20);
  }
  if (Array.isArray(projected.searchTokens)) {
    projected.searchTokens = trimTokenArray(projected.searchTokens, 6, 20);
  }
  if (projected.eligibility && typeof projected.eligibility === "object") {
    const elig = {
      version: projected.eligibility.version || 1,
      remoteScope: projected.eligibility.remoteScope || "unknown",
      sponsorship: Boolean(projected.eligibility.sponsorship),
      workAuthorizationRequired: Boolean(projected.eligibility.workAuthorizationRequired),
      confidence: Number(projected.eligibility.confidence || 0),
    };
    if (Array.isArray(projected.eligibility.countries) && projected.eligibility.countries.length) {
      elig.countries = projected.eligibility.countries.slice(0, 6);
    }
    if (projected.eligibility.evidence) {
      elig.evidence = String(projected.eligibility.evidence).slice(0, 32);
    }
    projected.eligibility = elig;
  }
  if (projected.structuredLocation && typeof projected.structuredLocation === "object") {
    const loc = {
      countryCode: projected.structuredLocation.countryCode || "",
      remoteScope: projected.structuredLocation.remoteScope || "unknown",
    };
    if (projected.structuredLocation.region) loc.region = projected.structuredLocation.region;
    if (projected.structuredLocation.city) loc.city = projected.structuredLocation.city;
    if (
      Array.isArray(projected.structuredLocation.eligibleCountryCodes) &&
      projected.structuredLocation.eligibleCountryCodes.length
    ) {
      loc.eligibleCountryCodes = projected.structuredLocation.eligibleCountryCodes.slice(0, 6);
    }
    if (
      Array.isArray(projected.structuredLocation.workAuthorization) &&
      projected.structuredLocation.workAuthorization.length
    ) {
      loc.workAuthorization = projected.structuredLocation.workAuthorization.slice(0, 3);
    }
    projected.structuredLocation = loc;
  }
  if (projected.compensation && typeof projected.compensation === "object") {
    const comp = {
      payPeriod: projected.compensation.payPeriod || "unknown",
    };
    if (projected.compensation.originalText)
      comp.originalText = String(projected.compensation.originalText).slice(0, 60);
    if (projected.compensation.currency) comp.currency = projected.compensation.currency;
    if (projected.compensation.min !== null && projected.compensation.min !== undefined)
      comp.min = projected.compensation.min;
    if (projected.compensation.max !== null && projected.compensation.max !== undefined)
      comp.max = projected.compensation.max;
    if (
      projected.compensation.normalizedAnnualMin !== null &&
      projected.compensation.normalizedAnnualMin !== undefined
    ) {
      comp.normalizedAnnualMin = projected.compensation.normalizedAnnualMin;
    }
    if (
      projected.compensation.normalizedAnnualMax !== null &&
      projected.compensation.normalizedAnnualMax !== undefined
    ) {
      comp.normalizedAnnualMax = projected.compensation.normalizedAnnualMax;
    }
    if (projected.compensation.normalizedCurrency)
      comp.normalizedCurrency = projected.compensation.normalizedCurrency;
    projected.compensation = comp;
  }
  return projected;
}

export function splitJobForStorage(job) {
  const {
    rawDescription = "",
    requirements = [],
    provenance = [],
    embedding,
    embeddingMetadata,
    ...rest
  } = job;
  const catalog = compactHotJobFields(rest);
  return {
    catalog,
    details: {
      description: String(rawDescription || ""),
      requirements: Array.isArray(requirements) ? requirements : [],
      provenance: normalizeProvenanceList(provenance),
    },
    vector:
      Array.isArray(embedding) && embedding.length
        ? {
            vector: embedding,
            provider: embeddingMetadata?.provider || "legacy",
            model: embeddingMetadata?.model || "unknown",
            dimension: embeddingMetadata?.dimension || embedding.length,
          }
        : null,
  };
}

export function projectJobDetail(job, detail) {
  if (!job) return job;
  return {
    ...job,
    rawDescription: detail?.description ?? job.rawDescription ?? "",
    requirements: detail?.requirements ?? job.requirements ?? [],
    provenance: detail?.provenance
      ? normalizeProvenanceList(detail.provenance)
      : normalizeProvenanceList(job.provenance ?? []),
  };
}

export function encodeCatalogCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCatalogCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (
      !/^[a-f\d]{24}$/i.test(parsed.id) ||
      (parsed.postedAt !== null && !Number.isFinite(Date.parse(parsed.postedAt))) ||
      (parsed.relevanceScore !== undefined &&
        parsed.relevanceScore !== null &&
        !Number.isFinite(parsed.relevanceScore)) ||
      (parsed.asOfDay !== undefined && parsed.asOfDay !== null && !Number.isFinite(parsed.asOfDay))
    ) {
      throw new Error();
    }
    return parsed;
  } catch {
    const error = new Error("The job list cursor is invalid. Refresh the list and try again.");
    error.statusCode = 400;
    error.code = "INVALID_CATALOG_CURSOR";
    throw error;
  }
}
