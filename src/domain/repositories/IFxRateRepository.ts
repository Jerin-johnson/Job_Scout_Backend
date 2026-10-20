export interface FxRateRecord {
  source?: string;
  date?: Date | string;
  ratesPerEur?: Record<string, number> | Map<string, number>;
  [key: string]: unknown;
}

export interface IFxRateRepository {
  getLatestRates(source?: string): Promise<FxRateRecord | null>;
  upsertRates(
    sourceKey: string,
    sourceName: string,
    date: Date,
    ratesPerEur: Record<string, number>,
  ): Promise<unknown>;
}
