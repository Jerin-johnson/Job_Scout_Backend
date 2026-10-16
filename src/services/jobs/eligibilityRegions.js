// Versioned, deliberately small ISO 3166-1 alpha-2 groups used by rules-first
// eligibility parsing. Keep this bounded to common hiring-region labels.
export const ELIGIBILITY_REGION_CONFIG_VERSION = 2;
export const ELIGIBILITY_REGIONS = Object.freeze({
  EU: Object.freeze(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]),
  EMEA: Object.freeze(["AL", "DZ", "AD", "AO", "AM", "AT", "AZ", "BH", "BE", "BJ", "BW", "BG", "BF", "BI", "CM", "CV", "CF", "TD", "KM", "CG", "CD", "CI", "HR", "CY", "CZ", "DK", "DJ", "EG", "GQ", "ER", "EE", "SZ", "ET", "FI", "FR", "GA", "GM", "GE", "DE", "GH", "GR", "GN", "GW", "HU", "IS", "IN", "IR", "IQ", "IE", "IL", "IT", "JO", "KE", "KW", "LV", "LB", "LS", "LR", "LY", "LI", "LT", "LU", "MG", "MW", "ML", "MT", "MR", "MU", "MC", "MA", "MZ", "NA", "NL", "NE", "NG", "NO", "OM", "PK", "PS", "PL", "PT", "QA", "RO", "RW", "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SK", "SI", "SO", "ZA", "ES", "SD", "SE", "CH", "SY", "TZ", "TG", "TN", "TR", "UG", "UA", "AE", "GB", "YE", "ZM", "ZW"]),
  APAC: Object.freeze(["AF", "AU", "BD", "BT", "BN", "KH", "CN", "FJ", "IN", "ID", "JP", "KI", "KP", "KR", "LA", "MY", "MV", "MH", "FM", "MN", "MM", "NP", "NZ", "PK", "PW", "PG", "PH", "WS", "SG", "SB", "LK", "TH", "TL", "TO", "TV", "VU", "VN"]),
  LATAM: Object.freeze(["AR", "BO", "BR", "CL", "CO", "CR", "CU", "DO", "EC", "SV", "GT", "HT", "HN", "MX", "NI", "PA", "PY", "PE", "UY", "VE"]),
  NA: Object.freeze(["CA", "US", "MX"]),
  AS: Object.freeze(["AF", "AM", "AZ", "BH", "BD", "BT", "BN", "KH", "CN", "CY", "GE", "IN", "ID", "IR", "IQ", "IL", "JP", "JO", "KZ", "KW", "KG", "LA", "LB", "MY", "MV", "MN", "MM", "NP", "KP", "OM", "PK", "PS", "PH", "QA", "SA", "SG", "KR", "LK", "SY", "TW", "TJ", "TH", "TL", "TR", "TM", "AE", "UZ", "VN", "YE"]),
  AF: Object.freeze(["DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CG", "CD", "CI", "DJ", "EG", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "MA", "MZ", "NA", "NE", "NG", "RW", "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN", "UG", "ZM", "ZW"]),
});

export const ELIGIBILITY_REGION_ALIASES = Object.freeze({
  "europe": "EU", "european union": "EU", "eu": "EU", "emea": "EMEA",
  "asia pacific": "APAC", "asia-pacific": "APAC", "apac": "APAC",
  "latin america": "LATAM", "latam": "LATAM", "north america": "NA",
  "asia": "AS", "africa": "AF",
});
