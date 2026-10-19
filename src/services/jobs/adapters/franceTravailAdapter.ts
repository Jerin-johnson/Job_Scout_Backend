import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") {
    const obj = value as { libelle?: unknown; label?: unknown; name?: unknown; value?: unknown; text?: unknown };
    return String(firstValue(obj.libelle, obj.label, obj.name, obj.value, obj.text) || "").trim();
  }
  return "";
}

function activeOffer(raw: Record<string, unknown> | null | undefined): boolean {
  if (raw?.active === false || raw?.isActive === false || raw?.deleted === true) return false;
  const state = String(firstValue(raw?.status, raw?.statut, raw?.state) || "").toLowerCase();
  return !["inactive", "deleted", "closed", "expired", "suspended", "pourvue"].includes(state);
}

function stripContactData(value: unknown): string {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[contact removed]")
    .replace(/(?:\+?\d[\d\s()./-]{7,}\d)/g, "[contact removed]");
}

export interface NormalizedFranceTravailOffer {
  sourceJobId: string;
  title: string;
  company: string;
  location: string;
  structuredLocation: { countryCode: string; remoteScope: string };
  remoteType: string;
  sourceUrl: string;
  canonicalUrl: string;
  postedAt: Date | null;
  rawDescription: string;
  sourceCategory: string;
  tags: string[];
  requirements: string[];
  salaryRange: { min: number; max: number; currency: string };
  compensation: { originalText: string; currency: string; payPeriod: string };
}

/** Normalize active France Travail search results only; contact fields are never copied. */
export function normalizeFranceTravailOffer(raw: Record<string, unknown> | null | undefined): NormalizedFranceTravailOffer | null {
  if (!activeOffer(raw)) return null;
  const id = firstValue(raw?.id, raw?.idOffre, raw?.sourceJobId);
  const title = text(firstValue(raw?.intitule, raw?.title));
  const rawEnt = raw?.entreprise as Record<string, unknown> | undefined;
  const rawComp = raw?.company as Record<string, unknown> | undefined;
  const company = text(firstValue(rawEnt?.nom, rawComp?.name, raw?.company, "Employer not disclosed"));
  if (id === undefined || !title) return null;
  const sourceJobId = String(id).trim();
  if (!sourceJobId) return null;

  const rawOrig = raw?.origineOffre as Record<string, unknown> | undefined;
  const sourceUrl = text(
    firstValue(
      rawOrig?.urlOrigine,
      raw?.urlOrigine,
      raw?.url,
      `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(sourceJobId)}`,
    ),
  );
  const lieu = raw?.lieuTravail as Record<string, unknown> | undefined;
  const rawLoc = raw?.location as Record<string, unknown> | undefined;
  const location = text(firstValue(lieu?.libelle, rawLoc?.label, raw?.location, "France"));
  const postedValue = firstValue(raw?.dateCreation, raw?.createdAt, raw?.publicationDate);
  const postedAt = postedValue ? new Date(String(postedValue)) : null;

  const competences = Array.isArray(raw?.competences)
    ? (raw?.competences as unknown[]).map((item) => text(item))
    : [];
  const categories = [raw?.romeLibelle, raw?.domaine, raw?.typeContratLibelle, ...competences]
    .flat()
    .map(text)
    .filter(Boolean);

  const rawTele = raw?.teletravail as Record<string, unknown> | undefined;
  const remote = String(firstValue(rawTele?.possibilite, raw?.telework, "")).toLowerCase();
  const rawSal = raw?.salaire as Record<string, unknown> | undefined;
  const rawSalObj = raw?.salary as Record<string, unknown> | undefined;
  const salaryText = text(firstValue(rawSal?.libelle, rawSalObj?.label));
  const description = stripContactData(firstValue(raw?.description, raw?.descriptionText, ""));

  return {
    sourceJobId,
    title,
    company,
    location: location.slice(0, 200),
    structuredLocation: { countryCode: "FR", remoteScope: "unknown" },
    remoteType: /oui|possible|hybrid|remote|télétravail/i.test(remote) ? "remote" : "onsite",
    sourceUrl,
    canonicalUrl: sourceUrl,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    rawDescription: sourceDescriptionText(description || `${title} at ${company}`),
    sourceCategory: categories.join(" / ").slice(0, 160),
    tags: categories.slice(0, 30),
    requirements: [],
    salaryRange: { min: 0, max: 0, currency: "" },
    compensation: { originalText: salaryText.slice(0, 200), currency: "", payPeriod: "unknown" },
  };
}

export interface FranceTravailAdapterOptions {
  tokenUrl?: string;
  offersUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  pageSize?: number | string;
  [key: string]: unknown;
}

export class FranceTravailAdapter extends BaseJobAdapter {
  tokenUrl: string;
  offersUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  pageSize: number;
  tokenCache: { value: string; expiresAt: number } | null;

  constructor(options: FranceTravailAdapterOptions = {}) {
    super({
      key: "france-travail",
      displayName: "France Travail",
      intervalMs: 6 * 60 * 60 * 1000,
      timeoutMs: 12000,
      maxRetries: 1,
      capabilities: {
        paging: true,
        oauth2: true,
        activeOffersOnly: true,
        fields: ["title", "company", "location", "contract", "description", "salaryText", "postedAt", "sourceUrl"],
      },
      ...options,
    });
    this.tokenUrl = options.tokenUrl || process.env.FRANCE_TRAVAIL_TOKEN_URL || "";
    this.offersUrl = options.offersUrl || process.env.FRANCE_TRAVAIL_OFFERS_URL || "";
    this.clientId = options.clientId || process.env.FRANCE_TRAVAIL_CLIENT_ID || "";
    this.clientSecret = options.clientSecret || process.env.FRANCE_TRAVAIL_CLIENT_SECRET || "";
    this.scope = options.scope || "";
    this.pageSize = Math.max(1, Math.min(150, Number(options.pageSize) || 150));
    this.tokenCache = null;
  }

  async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30000) return this.tokenCache.value;
    if (!this.tokenUrl || !this.clientId || !this.clientSecret) {
      const error = new Error("France Travail OAuth credentials are not configured.") as Error & { code?: string };
      error.code = "FRANCE_TRAVAIL_OAUTH_NOT_CONFIGURED";
      throw error;
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    if (this.scope) body.set("scope", this.scope);
    const result = await this.requestJson<{ access_token?: string; expires_in?: number | string }>(this.tokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const token = result.data?.access_token;
    if (!token || typeof token !== "string") {
      const error = new Error("France Travail OAuth returned no access token.") as Error & { code?: string };
      error.code = "FRANCE_TRAVAIL_OAUTH_TOKEN_INVALID";
      throw error;
    }
    const lifetime = Math.max(60, Number(result.data?.expires_in) || 3600) * 1000;
    this.tokenCache = { value: token, expiresAt: Date.now() + lifetime };
    return token;
  }

  async fetchPage({
    cursor,
    demandTerm,
  }: {
    cursor?: string | null;
    demandTerm?: string;
  } = {}): Promise<{
    jobs: NormalizedFranceTravailOffer[];
    inactiveIds?: string[];
    cursor: string | null;
    done: boolean;
    etag?: string | null;
    lastModified?: string | null;
  }> {
    if (!this.offersUrl) {
      const error = new Error("France Travail offers URL is not configured.") as Error & { code?: string };
      error.code = "FRANCE_TRAVAIL_OFFERS_URL_MISSING";
      throw error;
    }
    const token = await this.getAccessToken();
    const start = Math.max(0, Number(cursor) || 0);
    const url = new URL(this.offersUrl);
    if (demandTerm) url.searchParams.set("motsCles", String(demandTerm).slice(0, 100));
    const end = start + this.pageSize - 1;
    const result = await this.requestJson<
      | Array<Record<string, unknown>>
      | {
          resultats?: Array<Record<string, unknown>>;
          offres?: Array<Record<string, unknown>>;
          results?: Array<Record<string, unknown>>;
          _embedded?: { results?: Array<Record<string, unknown>> };
        }
    >(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Range: `${start}-${end}`, Accept: "application/json" },
    });
    const data = result.data;
    const offers = Array.isArray(data)
      ? data
      : data?.resultats || data?.offres || data?.results || data?._embedded?.results || [];
    const jobs = offers.map(normalizeFranceTravailOffer).filter((j): j is NormalizedFranceTravailOffer => j !== null);
    const done = offers.length < this.pageSize;
    return {
      jobs,
      inactiveIds: [],
      cursor: done ? null : String(start + offers.length),
      done,
      etag: result.etag,
      lastModified: result.lastModified,
    };
  }
}

export default FranceTravailAdapter;
