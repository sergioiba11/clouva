export type GeocodedLocation = {
  latitude: number;
  longitude: number;
  displayName: string;
  locality: string | null;
  region: string | null;
  country: string | null;
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
};

const DEFAULT_GEOCODING_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const DEFAULT_USER_AGENT = "CLOUVA/1.0 (+https://clouva.com.ar)";

export function normalizeLocationText(value: string) {
  return value.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim().slice(0, 500);
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || null;
}

export async function geocodeLocation(query: string): Promise<GeocodedLocation | null> {
  const cleaned = normalizeLocationText(query);
  if (!cleaned) return null;

  const endpoint = process.env.CLOUVA_GEOCODING_ENDPOINT?.trim() || DEFAULT_GEOCODING_ENDPOINT;
  const url = new URL(endpoint);
  url.searchParams.set("q", cleaned);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": process.env.CLOUVA_GEOCODING_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
        Referer: "https://clouva.com.ar/",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Geocoding provider returned ${response.status}.`);
    }

    const results = await response.json() as NominatimResult[];
    const item = Array.isArray(results) ? results[0] : null;
    if (!item) return null;

    const latitude = Number(item.lat);
    const longitude = Number(item.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

    const address = item.address || {};
    return {
      latitude,
      longitude,
      displayName: normalizeLocationText(item.display_name || cleaned),
      locality: firstNonEmpty(address.city, address.town, address.village, address.municipality, address.hamlet),
      region: firstNonEmpty(address.state, address.region, address.province),
      country: firstNonEmpty(address.country),
    };
  } finally {
    clearTimeout(timeout);
  }
}
