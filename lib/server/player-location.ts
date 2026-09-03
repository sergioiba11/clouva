import { geocodeLocation, normalizeLocationText, type GeocodedLocation } from "./geocoding";

export class PlayerLocationError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 422, code = "PLAYER_LOCATION_INVALID") {
    super(message);
    this.name = "PlayerLocationError";
    this.status = status;
    this.code = code;
  }
}

type GeocodeFn = (query: string) => Promise<GeocodedLocation | null>;

export async function resolvePlayerLocationChange({
  requestedLocation,
  currentLocation,
  currentLatitude,
  currentLongitude,
  geocode = geocodeLocation,
}: {
  requestedLocation: unknown;
  currentLocation: string | null;
  currentLatitude: number | null;
  currentLongitude: number | null;
  geocode?: GeocodeFn;
}) {
  if (requestedLocation !== null && typeof requestedLocation !== "string") {
    throw new PlayerLocationError("La ubicación debe ser una localidad válida.", 400, "PLAYER_LOCATION_TYPE");
  }

  const nextLocation = typeof requestedLocation === "string" ? normalizeLocationText(requestedLocation) : "";
  if (!nextLocation) {
    return { location: null, latitude: null, longitude: null };
  }

  const currentCleaned = currentLocation ? normalizeLocationText(currentLocation) : "";
  const hasCoordinates = Number.isFinite(currentLatitude) && Number.isFinite(currentLongitude);
  if (nextLocation === currentCleaned && hasCoordinates) {
    return { location: nextLocation };
  }

  let resolved: GeocodedLocation | null;
  try {
    resolved = await geocode(nextLocation);
  } catch {
    throw new PlayerLocationError(
      "No pudimos verificar esa ubicación ahora. Reintentá en unos minutos.",
      502,
      "PLAYER_LOCATION_PROVIDER_ERROR",
    );
  }

  if (!resolved) {
    throw new PlayerLocationError(
      "No encontramos esa ubicación. Probá con ciudad, provincia/estado y país.",
      422,
      "PLAYER_LOCATION_NOT_FOUND",
    );
  }

  return {
    location: nextLocation,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
  };
}
