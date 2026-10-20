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
