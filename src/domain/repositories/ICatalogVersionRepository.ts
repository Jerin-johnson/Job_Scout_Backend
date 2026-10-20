export interface ICatalogVersionRepository {
  getCatalogVersion(): Promise<number>;
  bumpCatalogVersion(): Promise<number>;
}
