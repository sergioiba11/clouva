export type FlowRegion =
  | "south-america"
  | "north-america"
  | "europe"
  | "africa"
  | "asia"
  | "oceania";

export const FLOW_REGION_ASSETS: Record<FlowRegion, string> = {
  "south-america": "brand/clouva-logo/shared/other/flows-region-south-america-es.png",
  "north-america": "brand/clouva-logo/shared/other/flows-region-north-america-en.png",
  europe: "brand/clouva-logo/shared/other/flows-region-europe-fr.png",
  africa: "brand/clouva-logo/shared/other/flows-region-africa-sw.png",
  asia: "brand/clouva-logo/shared/other/flows-region-asia-ja.png",
  oceania: "brand/clouva-logo/shared/other/flows-region-oceania-en.png",
};

export const FLOW_REGION_LABELS: Record<FlowRegion, string> = {
  "south-america": "Sudamérica",
  "north-america": "Norteamérica",
  europe: "Europa",
  africa: "África",
  asia: "Asia",
  oceania: "Oceanía",
};

const REGION_COUNTRIES: Record<FlowRegion, readonly string[]> = {
  "south-america": [
    "AR", "BO", "BR", "CL", "CO", "EC", "FK", "GF", "GY", "PY", "PE", "SR", "UY", "VE",
  ],
  "north-america": [
    "AG", "AI", "AW", "BS", "BB", "BZ", "BM", "BQ", "CA", "KY", "CR", "CU", "CW", "DM", "DO",
    "SV", "GL", "GD", "GP", "GT", "HT", "HN", "JM", "MQ", "MX", "MS", "NI", "PA", "PR", "BL", "KN",
    "LC", "MF", "PM", "VC", "SX", "TT", "TC", "US", "VG", "VI",
  ],
  europe: [
    "AX", "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE", "FO", "FI", "FR",
    "DE", "GI", "GR", "GG", "VA", "HU", "IS", "IE", "IM", "IT", "JE", "LV", "LI", "LT", "LU", "MT",
    "MD", "MC", "ME", "NL", "MK", "NO", "PL", "PT", "RO", "RU", "SM", "RS", "SK", "SI", "ES", "SJ",
    "SE", "CH", "UA", "GB",
  ],
  africa: [
    "DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CG", "CD", "CI", "DJ", "EG",
    "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML",
    "MR", "MU", "YT", "MA", "MZ", "NA", "NE", "NG", "RE", "RW", "SH", "ST", "SN", "SC", "SL", "SO",
    "ZA", "SS", "SD", "TZ", "TG", "TN", "UG", "EH", "ZM", "ZW",
  ],
  asia: [
    "AF", "AM", "AZ", "BH", "BD", "BT", "BN", "KH", "CN", "GE", "HK", "IN", "ID", "IR", "IQ", "IL",
    "JP", "JO", "KZ", "KW", "KG", "LA", "LB", "MO", "MY", "MV", "MN", "MM", "NP", "KP", "OM", "PK",
    "PS", "PH", "QA", "SA", "SG", "KR", "LK", "SY", "TW", "TJ", "TH", "TL", "TR", "TM", "AE", "UZ",
    "VN", "YE",
  ],
  oceania: [
    "AS", "AU", "CX", "CC", "CK", "FJ", "PF", "GU", "KI", "MH", "FM", "NR", "NC", "NZ", "NU", "NF",
    "MP", "PW", "PG", "PN", "WS", "SB", "TK", "TO", "TV", "UM", "VU", "WF",
  ],
};

const COUNTRY_TO_REGION = new Map<string, FlowRegion>();
for (const [region, codes] of Object.entries(REGION_COUNTRIES) as [FlowRegion, readonly string[]][]) {
  for (const code of codes) COUNTRY_TO_REGION.set(code, region);
}

export const FLOW_COUNTRY_CODES = Array.from(COUNTRY_TO_REGION.keys()).sort();

export function normalizeCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function resolveFlowRegion(countryCode: string | null | undefined): FlowRegion | null {
  const normalized = normalizeCountryCode(countryCode);
  return normalized ? COUNTRY_TO_REGION.get(normalized) ?? null : null;
}

export function resolveFlowLogoAsset(region: FlowRegion): string {
  return FLOW_REGION_ASSETS[region];
}

export function resolveFlowLogoAssetForCountry(countryCode: string | null | undefined): string | null {
  const region = resolveFlowRegion(countryCode);
  return region ? resolveFlowLogoAsset(region) : null;
}

export function flowRegionLabel(region: FlowRegion | null | undefined): string | null {
  return region ? FLOW_REGION_LABELS[region] : null;
}
