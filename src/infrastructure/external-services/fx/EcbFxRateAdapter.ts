import { FxRate } from "../../database/mongoose/models/FxRateModel.js";
import { env } from "../../../config/env.js";

const ECB_SERIES =
  "https://data-api.ecb.europa.eu/service/data/EXR/D.{currency}.EUR.SP00.A?format=csvdata&lastNObservations=1";
const CURRENCIES = ["USD", "INR", "GBP", "CAD", "AUD", "AED", "SAR", "EUR"] as const;
const SOURCE = "European Central Bank euro foreign exchange reference rates";

export interface RefreshRatesOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
}

export interface RefreshReferenceRatesOptions extends RefreshRatesOptions {
  source?: string;
}

export interface FxRateRecord {
  source?: string;
  date?: Date | string;
  ratesPerEur?: Record<string, number> | Map<string, number>;
  [key: string]: unknown;
}

export async function refreshEcbReferenceRates({
  fetchImpl = fetch,
  now = new Date(),
}: RefreshRatesOptions = {}): Promise<unknown> {
  const observations = await Promise.all(
    CURRENCIES.filter((code) => code !== "EUR").map(async (currency) => {
      const response = await fetchImpl(ECB_SERIES.replace("{currency}", currency), {
        signal: AbortSignal.timeout(8000),
        headers: { accept: "text/csv" },
      });
      if (!response.ok)
        throw new Error(`ECB rate request failed for ${currency}: ${response.status}`);
      const text = (await response.text()).slice(0, 100_000);
      const lines = text.trim().split(/\r?\n/);
      const headers = (lines.shift() || "").split(",");
      const row = (lines.at(-1) || "").split(",");
      const value = Number(row[headers.indexOf("OBS_VALUE")]);
      if (!Number.isFinite(value) || value <= 0)
        throw new Error(`ECB rate response invalid for ${currency}`);
      return [currency, value, row[headers.indexOf("TIME_PERIOD")]] as const;
    }),
  );
  const dates = observations
    .map(([, , date]) => date)
    .filter(Boolean)
    .sort();
  const ratesPerEur = Object.fromEntries([
    ["EUR", 1],
    ...observations.map(([code, value]) => [code, value]),
  ]);
  return FxRate.findOneAndUpdate(
    { key: "ecb-reference" },
    {
      $set: {
        source: SOURCE,
        date: dates.length ? new Date(dates.at(-1) as string) : now,
        ratesPerEur,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

const UNSUPPORTED_FX_SOURCE: Record<string, string> = {
  rbi: "RBI stopped publishing the live reference rate on 2018-07-09; FBIL took over on 2018-07-10.",
  fbil: "FBIL reference-rate usage is fee-liable; configure it only after a license and a supported feed are approved.",
};

/**
 * Source boundary for worker refreshes. ECB is the only enabled adapter today;
 * RBI/FBIL options fail explicitly until their feed and reuse terms are cleared.
 */
export async function refreshReferenceRates({
  source = env.FX_REFERENCE_SOURCE,
  ...options
}: RefreshReferenceRatesOptions = {}): Promise<unknown> {
  if (source === "ecb") return refreshEcbReferenceRates(options);
  const error = new Error(
    UNSUPPORTED_FX_SOURCE[source] || "Unsupported FX reference source.",
  ) as Error & {
    code?: string;
  };
  error.code = "FX_SOURCE_NOT_AVAILABLE";
  throw error;
}

export async function latestReferenceRates(
  source = env.FX_REFERENCE_SOURCE,
): Promise<FxRateRecord | null> {
  if (FxRate.db.readyState !== 1) return null;
  return FxRate.findOne({ key: `${source}-reference` })
    .select("source date ratesPerEur")
    .lean() as Promise<FxRateRecord | null>;
}

export const latestEcbReferenceRates = (): Promise<FxRateRecord | null> =>
  latestReferenceRates("ecb");

export function isFxRateStale(
  rate: { date?: Date | string } | null | undefined,
  { now = new Date(), maxAgeDays = 3 }: { now?: Date; maxAgeDays?: number } = {},
): boolean {
  if (!rate?.date) return true;
  return now.getTime() - new Date(rate.date).getTime() > maxAgeDays * 86400000;
}

export function convertAmount(
  amount: number | string | undefined | null,
  fromCurrency?: string,
  toCurrency?: string,
  ratesPerEur?: Record<string, number> | Map<string, number> | null,
): number | null {
  if (amount === undefined || amount === null) return null;
  const amountNumber = Number(amount);
  const rates =
    ratesPerEur instanceof Map
      ? Object.fromEntries(ratesPerEur)
      : (ratesPerEur as Record<string, number> | undefined) || {};
  const from = String(fromCurrency || "").toUpperCase();
  const to = String(toCurrency || "").toUpperCase();
  if (
    !Number.isFinite(amountNumber) ||
    amountNumber <= 0 ||
    typeof rates[from] !== "number" ||
    typeof rates[to] !== "number"
  ) {
    return null;
  }
  return (amountNumber / Number(rates[from])) * Number(rates[to]);
}
