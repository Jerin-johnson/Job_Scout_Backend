/**
 * Versioned provider/model catalog used by startup checks and usage metering.
 * Prices are USD per million tokens; null means the rate is not verified and
 * the model must not be enabled for production traffic.
 */
export const MODEL_PRICING_VERSION = "2026-10-15.1";

export interface RateEntry {
  effectiveFrom: string;
  effectiveTo: string | null;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  cachedInputUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
}

export interface ModelPricingEntry {
  provider: string;
  modelId: string;
  status: "active" | "retired";
  dataPolicyClass: string;
  rates: readonly RateEntry[];
}

export interface EffectiveModelRate extends RateEntry {
  pricingVersion: string;
  dataPolicyClass: string;
}

const geminiFlashLiteRates: [string, number, number, number | null][] = [
  ["gemini-2.5-flash-lite", 0.1, 0.4, 0.01],
  ["gemini-2.5-flash", 0.3, 2.5, 0.03],
  ["gemini-3.1-flash-lite", 0.25, 1.5, null],
  ["gemini-3.5-flash-lite", 0.3, 2.5, null],
];

const catalog: ModelPricingEntry[] = [
  ...geminiFlashLiteRates.map(([modelId, input, output, cachedInput]) => ({
    provider: "gemini",
    modelId,
    status: "active" as const,
    dataPolicyClass: "provider_tier_configured",
    rates: [
      {
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        inputUsdPerMillion: input,
        outputUsdPerMillion: output,
        cachedInputUsdPerMillion: cachedInput,
        cacheWriteUsdPerMillion: null,
      },
    ],
  })),
  ...["gemini-3.6-flash", "gemini-3.8-flash"].map((modelId) => ({
    provider: "gemini",
    modelId,
    status: "active" as const,
    dataPolicyClass: "provider_tier_configured",
    rates: [
      {
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2027-01-01T00:00:00.000Z",
        inputUsdPerMillion: 0.75,
        outputUsdPerMillion: 3.75,
        cachedInputUsdPerMillion: 0.075,
        cacheWriteUsdPerMillion: null,
      },
      {
        effectiveFrom: "2027-01-01T00:00:00.000Z",
        effectiveTo: null,
        inputUsdPerMillion: 1.5,
        outputUsdPerMillion: 7.5,
        cachedInputUsdPerMillion: 0.15,
        cacheWriteUsdPerMillion: null,
      },
    ],
  })),
  {
    provider: "groq",
    modelId: "openai/gpt-oss-20b",
    status: "active" as const,
    dataPolicyClass: "provider_tier_configured",
    rates: [
      {
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        inputUsdPerMillion: 0.075,
        outputUsdPerMillion: 0.3,
        cachedInputUsdPerMillion: 0.0375,
        cacheWriteUsdPerMillion: null,
      },
    ],
  },
  {
    provider: "groq",
    modelId: "openai/gpt-oss-120b",
    status: "active" as const,
    dataPolicyClass: "provider_tier_configured",
    rates: [
      {
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        inputUsdPerMillion: 0.15,
        outputUsdPerMillion: 0.6,
        cachedInputUsdPerMillion: 0.075,
        cacheWriteUsdPerMillion: null,
      },
    ],
  },
  {
    provider: "openai",
    modelId: "text-embedding-3-small",
    status: "active" as const,
    dataPolicyClass: "paid_api",
    rates: [
      {
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        inputUsdPerMillion: 0.02,
        outputUsdPerMillion: 0,
        cachedInputUsdPerMillion: null,
        cacheWriteUsdPerMillion: null,
      },
    ],
  },
  {
    provider: "voyage",
    modelId: "voyage-large-2-instruct",
    status: "active" as const,
    dataPolicyClass: "paid_api",
    rates: [
      {
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        inputUsdPerMillion: 0.12,
        outputUsdPerMillion: 0,
        cachedInputUsdPerMillion: null,
        cacheWriteUsdPerMillion: null,
      },
    ],
  },
  {
    provider: "anthropic",
    modelId: "claude-3-5-haiku-20241022",
    status: "retired" as const,
    dataPolicyClass: "paid_api",
    rates: [
      {
        effectiveFrom: "2024-10-22T00:00:00.000Z",
        effectiveTo: "2026-02-19T00:00:00.000Z",
        inputUsdPerMillion: 0.8,
        outputUsdPerMillion: 4,
        cachedInputUsdPerMillion: 0.08,
        cacheWriteUsdPerMillion: 1,
      },
    ],
  },
  {
    provider: "anthropic",
    modelId: "claude-3-5-sonnet-20241022",
    status: "retired" as const,
    dataPolicyClass: "paid_api",
    rates: [
      {
        effectiveFrom: "2024-10-22T00:00:00.000Z",
        effectiveTo: "2025-10-28T00:00:00.000Z",
        inputUsdPerMillion: 3,
        outputUsdPerMillion: 15,
        cachedInputUsdPerMillion: 0.3,
        cacheWriteUsdPerMillion: 3.75,
      },
    ],
  },
];

export const MODEL_PRICING_CATALOG: readonly ModelPricingEntry[] = Object.freeze(
  catalog.map((entry) =>
    Object.freeze({
      ...entry,
      rates: Object.freeze(entry.rates.map((rate) => Object.freeze(rate))),
    }),
  ),
);

export function findModelCatalogEntry(provider: string, modelId: string | null | undefined): ModelPricingEntry | null {
  if (!modelId) return null;
  return (
    MODEL_PRICING_CATALOG.find(
      (entry) => entry.provider === provider && entry.modelId === modelId,
    ) || null
  );
}

export function getModelRate(provider: string, modelId: string, at: Date | string = new Date()): EffectiveModelRate {
  const entry = findModelCatalogEntry(provider, modelId);
  if (!entry) throw new Error(`Unpriced or unknown model: ${provider}/${modelId}`);
  if (entry.status !== "active") throw new Error(`Retired model cannot be used: ${provider}/${modelId}`);
  const timestamp = new Date(at).getTime();
  const rate = entry.rates.find(
    (candidate) =>
      new Date(candidate.effectiveFrom).getTime() <= timestamp &&
      (candidate.effectiveTo === null ||
        candidate.effectiveTo === undefined ||
        timestamp < new Date(candidate.effectiveTo).getTime()),
  );
  if (
    !rate ||
    rate.inputUsdPerMillion === null ||
    rate.inputUsdPerMillion === undefined ||
    rate.outputUsdPerMillion === null ||
    rate.outputUsdPerMillion === undefined
  ) {
    throw new Error(`No effective price for model: ${provider}/${modelId}`);
  }
  return { ...rate, pricingVersion: MODEL_PRICING_VERSION, dataPolicyClass: entry.dataPolicyClass };
}

export function catalogModelStatus(
  provider: string,
  modelId: string | null | undefined,
  at: Date | string = new Date(),
): "priced" | "unpriced" | "retired" | "unknown" {
  if (!modelId) return "unknown";
  const entry = findModelCatalogEntry(provider, modelId);
  if (!entry) return "unknown";
  if (entry.status !== "active") return "retired";
  try {
    getModelRate(provider, modelId, at);
    return "priced";
  } catch {
    return "unpriced";
  }
}
