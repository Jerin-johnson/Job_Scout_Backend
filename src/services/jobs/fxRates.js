import { FxRate } from "../../models/FxRate.js";

const ECB_SERIES = "https://data-api.ecb.europa.eu/service/data/EXR/D.{currency}.EUR.SP00.A?format=csvdata&lastNObservations=1";
const CURRENCIES = ["USD", "INR", "GBP", "CAD", "AUD", "AED", "SAR", "EUR"];
const SOURCE = "European Central Bank euro foreign exchange reference rates";

export async function refreshEcbReferenceRates({ fetchImpl = fetch, now = new Date() } = {}) {
  const observations = await Promise.all(CURRENCIES.filter((code) => code !== "EUR").map(async (currency) => {
    const response = await fetchImpl(ECB_SERIES.replace("{currency}", currency), { signal: AbortSignal.timeout(8000), headers: { accept: "text/csv" } });
    if (!response.ok) throw new Error(`ECB rate request failed for ${currency}: ${response.status}`);
    const text = (await response.text()).slice(0, 100_000);
    const lines = text.trim().split(/\r?\n/);
    const headers = (lines.shift() || "").split(",");
    const row = (lines.at(-1) || "").split(",");
    const value = Number(row[headers.indexOf("OBS_VALUE")]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`ECB rate response invalid for ${currency}`);
    return [currency, value, row[headers.indexOf("TIME_PERIOD")]];
  }));
  const dates = observations.map(([, , date]) => date).filter(Boolean).sort();
  const ratesPerEur = Object.fromEntries([["EUR", 1], ...observations.map(([code, value]) => [code, value])]);
  return FxRate.findOneAndUpdate({ key: "ecb-reference" }, { $set: { source: SOURCE, date: dates.length ? new Date(dates.at(-1)) : now, ratesPerEur } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
}

export async function latestEcbReferenceRates() {
  if (FxRate.db.readyState !== 1) return null;
  return FxRate.findOne({ key: "ecb-reference" }).select("source date ratesPerEur").lean();
}

export function isFxRateStale(rate, { now = new Date(), maxAgeDays = 3 } = {}) {
  if (!rate?.date) return true;
  return now.getTime() - new Date(rate.date).getTime() > maxAgeDays * 86400000;
}

export function convertAmount(amount, fromCurrency, toCurrency, ratesPerEur) {
  const amountNumber = Number(amount);
  const rates = ratesPerEur instanceof Map ? Object.fromEntries(ratesPerEur) : ratesPerEur || {};
  const from = String(fromCurrency || "").toUpperCase();
  const to = String(toCurrency || "").toUpperCase();
  if (!Number.isFinite(amountNumber) || amountNumber <= 0 || !rates[from] || !rates[to]) return null;
  return amountNumber / Number(rates[from]) * Number(rates[to]);
}
