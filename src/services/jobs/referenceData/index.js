/**
 * Reference Data Subsets & CC BY 4.0 Attribution:
 *
 * 1. O*NET 29.0 Database Subset (`./onetSubset.json`):
 *    Includes data from the O*NET 29.0 Database by the U.S. Department of Labor,
 *    Employment and Training Administration (USDOL/ETA), used under the Creative
 *    Commons Attribution 4.0 International License (CC BY 4.0).
 *    O*NET is a trademark of USDOL/ETA. Source: https://www.onetcenter.org/database.html
 *
 * 2. GeoNames Gazetteer Subset (`./geonamesSubset.json`):
 *    Geographical names and administrative subdivisions derived from GeoNames
 *    (https://www.geonames.org/), licensed under the Creative Commons Attribution
 *    4.0 International License (CC BY 4.0).
 *
 * 3. ESCO: Explicitly deferred (not imported).
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const ONET_SUBSET = Object.freeze(require("./onetSubset.json"));
export const GEONAMES_SUBSET = Object.freeze(require("./geonamesSubset.json"));

const normalizePlaceText = (value = "") =>
  String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

const GEONAMES_INDEX = GEONAMES_SUBSET.places
  .flatMap((place) => {
    const terms = [place.name, ...(place.aliases || [])];
    return terms.map((term) => ({
      alias: normalizePlaceText(term),
      place,
    }));
  })
  .filter((entry) => entry.alias.length >= 3)
  .sort((a, b) => b.alias.length - a.alias.length);

export function getReferenceDataAttributions() {
  return [ONET_SUBSET.metadata, GEONAMES_SUBSET.metadata];
}

export function lookupGeoNamesPlace(locationText = "") {
  const normalized = normalizePlaceText(locationText);
  if (!normalized) return null;
  const padded = ` ${normalized} `;
  const found = GEONAMES_INDEX.find(({ alias }) => padded.includes(` ${alias} `));
  if (!found) return null;
  const { place } = found;
  return {
    geonameId: place.geonameId,
    city: place.name,
    region: place.region,
    subdivisionCode: place.subdivisionCode,
    countryCode: place.countryCode,
  };
}
