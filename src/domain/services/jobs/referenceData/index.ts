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

export interface GeoNamesPlace {
  geonameId: number;
  name: string;
  aliases?: string[];
  region?: string;
  subdivisionCode?: string;
  countryCode: string;
}

export interface GeoNamesSubset {
  metadata: Record<string, unknown>;
  places: GeoNamesPlace[];
}

export interface OnetSubset {
  metadata: Record<string, unknown>;
  occupations?: Array<Record<string, unknown>>;
  skills?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ResolvedGeoNamesPlace {
  geonameId: number;
  city: string;
  region?: string;
  subdivisionCode?: string;
  countryCode: string;
}

const require = createRequire(import.meta.url);
export const ONET_SUBSET: OnetSubset = Object.freeze(require("./onetSubset.json"));
export const GEONAMES_SUBSET: GeoNamesSubset = Object.freeze(require("./geonamesSubset.json"));

const normalizePlaceText = (value: unknown = ""): string =>
  String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

interface GeoNamesIndexEntry {
  alias: string;
  place: GeoNamesPlace;
}

const GEONAMES_INDEX: GeoNamesIndexEntry[] = GEONAMES_SUBSET.places
  .flatMap((place) => {
    const terms = [place.name, ...(place.aliases || [])];
    return terms.map((term) => ({
      alias: normalizePlaceText(term),
      place,
    }));
  })
  .filter((entry) => entry.alias.length >= 3)
  .sort((a, b) => b.alias.length - a.alias.length);

export function getReferenceDataAttributions(): Array<Record<string, unknown>> {
  return [ONET_SUBSET.metadata, GEONAMES_SUBSET.metadata];
}

export function lookupGeoNamesPlace(locationText = ""): ResolvedGeoNamesPlace | null {
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
