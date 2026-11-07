export enum ComplianceRegion {
  US = 'us',
  EU = 'eu',
  UK = 'uk',
  ASIA_PACIFIC = 'asia_pacific',
  GLOBAL = 'global',
}

/**
 * ISO 3166-1 alpha-2 → compliance region mapping (issue #92).
 *
 * KYC records store country codes (`DE`, `JP`, ...), not `ComplianceRegion`
 * values, so `getConfigForRegion()` must translate. Codes not listed here
 * fall back to GLOBAL (with a warn at the service layer).
 */
export const REGION_BY_COUNTRY: Readonly<Record<string, ComplianceRegion>> = {
  // United States
  US: ComplianceRegion.US,

  // EU / EEA
  AT: ComplianceRegion.EU,
  BE: ComplianceRegion.EU,
  BG: ComplianceRegion.EU,
  HR: ComplianceRegion.EU,
  CY: ComplianceRegion.EU,
  CZ: ComplianceRegion.EU,
  DK: ComplianceRegion.EU,
  EE: ComplianceRegion.EU,
  FI: ComplianceRegion.EU,
  FR: ComplianceRegion.EU,
  DE: ComplianceRegion.EU,
  GR: ComplianceRegion.EU,
  HU: ComplianceRegion.EU,
  IE: ComplianceRegion.EU,
  IT: ComplianceRegion.EU,
  LV: ComplianceRegion.EU,
  LT: ComplianceRegion.EU,
  LU: ComplianceRegion.EU,
  MT: ComplianceRegion.EU,
  NL: ComplianceRegion.EU,
  PL: ComplianceRegion.EU,
  PT: ComplianceRegion.EU,
  RO: ComplianceRegion.EU,
  SK: ComplianceRegion.EU,
  SI: ComplianceRegion.EU,
  ES: ComplianceRegion.EU,
  SE: ComplianceRegion.EU,
  NO: ComplianceRegion.EU,
  IS: ComplianceRegion.EU,
  LI: ComplianceRegion.EU,
  // Pseudo-code used by legacy records/tests; not an ISO country.
  EU: ComplianceRegion.EU,

  // United Kingdom (GB is ISO; UK is the commonly used alias)
  GB: ComplianceRegion.UK,
  UK: ComplianceRegion.UK,

  // Asia-Pacific
  JP: ComplianceRegion.ASIA_PACIFIC,
  CN: ComplianceRegion.ASIA_PACIFIC,
  HK: ComplianceRegion.ASIA_PACIFIC,
  TW: ComplianceRegion.ASIA_PACIFIC,
  SG: ComplianceRegion.ASIA_PACIFIC,
  KR: ComplianceRegion.ASIA_PACIFIC,
  AU: ComplianceRegion.ASIA_PACIFIC,
  NZ: ComplianceRegion.ASIA_PACIFIC,
  IN: ComplianceRegion.ASIA_PACIFIC,
  ID: ComplianceRegion.ASIA_PACIFIC,
  MY: ComplianceRegion.ASIA_PACIFIC,
  TH: ComplianceRegion.ASIA_PACIFIC,
  VN: ComplianceRegion.ASIA_PACIFIC,
  PH: ComplianceRegion.ASIA_PACIFIC,
  KH: ComplianceRegion.ASIA_PACIFIC,
  LA: ComplianceRegion.ASIA_PACIFIC,
  MM: ComplianceRegion.ASIA_PACIFIC,
  BN: ComplianceRegion.ASIA_PACIFIC,
  KP: ComplianceRegion.ASIA_PACIFIC,
};

/** Resolves an ISO country code or ComplianceRegion alias to a region. */
export function resolveComplianceRegion(
  region?: string | null,
): ComplianceRegion {
  if (!region) {
    return ComplianceRegion.GLOBAL;
  }
  const trimmed = region.trim();
  if (trimmed.length === 0) {
    return ComplianceRegion.GLOBAL;
  }
  const lower = trimmed.toLowerCase() as ComplianceRegion;
  if (Object.values(ComplianceRegion).includes(lower)) {
    return lower;
  }
  return REGION_BY_COUNTRY[trimmed.toUpperCase()] ?? ComplianceRegion.GLOBAL;
}

/** True when the value needs no fallback warning (already maps cleanly). */
export function isKnownComplianceRegionInput(region?: string | null): boolean {
  if (!region) {
    return true;
  }
  const trimmed = region.trim();
  if (trimmed.length === 0) {
    return true;
  }
  const lower = trimmed.toLowerCase() as ComplianceRegion;
  if (Object.values(ComplianceRegion).includes(lower)) {
    return true;
  }
  return trimmed.toUpperCase() in REGION_BY_COUNTRY;
}
