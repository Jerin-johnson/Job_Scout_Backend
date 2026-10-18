export const JOB_DETAIL_FIELDS = Object.freeze(["rawDescription", "requirements"]);
export const JOB_VECTOR_FIELDS = Object.freeze(["embedding", "embeddingMetadata"]);

export function splitJobForStorage(job) {
  const { rawDescription = "", requirements = [], embedding, embeddingMetadata, ...catalog } = job;
  return {
    catalog,
    details: { description: String(rawDescription || ""), requirements: Array.isArray(requirements) ? requirements : [] },
    vector: Array.isArray(embedding) && embedding.length
      ? { vector: embedding, provider: embeddingMetadata?.provider || "legacy", model: embeddingMetadata?.model || "unknown", dimension: embeddingMetadata?.dimension || embedding.length }
      : null,
  };
}

export function projectJobDetail(job, detail) {
  if (!job) return job;
  return {
    ...job,
    rawDescription: detail?.description ?? job.rawDescription ?? "",
    requirements: detail?.requirements ?? job.requirements ?? [],
  };
}

export function encodeCatalogCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCatalogCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!/^[a-f\d]{24}$/i.test(parsed.id) || (parsed.postedAt !== null && !Number.isFinite(Date.parse(parsed.postedAt)))) throw new Error();
    return parsed;
  } catch {
    const error = new Error("The job list cursor is invalid. Refresh the list and try again.");
    error.statusCode = 400;
    error.code = "INVALID_CATALOG_CURSOR";
    throw error;
  }
}
