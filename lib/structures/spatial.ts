export type CardinalDirection = "N" | "NE" | "E" | "SE" | "S" | "SO" | "O" | "NO";\nexport type SpatialSource = "unplaced" | "exif" | "filename" | "manual" | "inferred_cloud";

export type StructureRecord = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  structure_type: string;
  description: string | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  origin_latitude: number | null;
  origin_longitude: number | null;
  historical_notes: string | null;
  reconstruction_rules: string[] | null;
  blockout: Record<string, unknown> | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type StructureImageRecord = {
  id: string;
  structure_id: string;
  batch_id: string | null;
  storage_path: string;
  public_url: string;
  original_filename: string;
  original_path: string | null;
  ordered_filename: string | null;
  width: number | null;
  height: number | null;
  mime_type: string;
  byte_size: number;
  sha256: string;
  perceptual_hash: string | null;
  source_type: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  fov: number | null;
  local_x: number | null;
  local_y: number | null;
  local_z: number | null;
  cardinal_direction: string | null;
  sector: string | null;
  scene_type: string | null;
  description: string | null;
  visible_surfaces: string[] | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  analysis: Record<string, unknown> | null;
  confidence: number | null;
  priority: number;
  manual_verified: boolean;
  duplicate_of: string | null;
  analysis_status: string;
  created_at: string;
  updated_at: string;
};

export type StructureSurfaceRecord = {
  id: string;
  structure_id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  type: string;
  geometry: Record<string, unknown> | null;
  orientation: number | null;
  materials: unknown[] | null;
  notes: string | null;
  confidence: number | null;
};

export type StructureCameraNodeRecord = {
  id: string;
  structure_id: string;
  image_id: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  local_x: number | null;
  local_y: number | null;
  local_z: number | null;
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  fov: number | null;
  target_x: number | null;
  target_y: number | null;
  target_z: number | null;
  confidence: number | null;
};

export type StructureRuleRecord = {
  id: string;
  structure_id: string;
  rule: string;
  priority: number;
  active: boolean;
};

const CARDINALS: CardinalDirection[] = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const EARTH_RADIUS_METERS = 6_378_137;

export function slugifyStructure(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "estructura";
}

export function safeFileSegment(value: string, fallback = "imagen") {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 150) || fallback;
}

export function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

export function headingToCardinal(value: number | null | undefined): CardinalDirection | null {
  if (value == null || !Number.isFinite(value)) return null;
  const index = Math.round(normalizeHeading(value) / 45) % 8;
  return CARDINALS[index];
}

export function canonicalSectorFromText(raw: string | null | undefined) {
  const text = (raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!text) return null;
  if (/mapa|aereo|aerial|satelit|topolog/.test(text)) return "mapas_aereos_y_topologia";
  if (/interior|pasillo|aula|salon|hall|bano|baño/.test(text)) return "interiores";
  if (/patio|cancha/.test(text)) return "patio";
  if (/histor|archivo|antigu|antes/.test(text)) return "referencias_historicas";
  if (/contexto|barrio|entorno|manzana/.test(text)) return "contexto";
  if (/noreste|north.?east|\bne\b/.test(text)) return "noreste";
  if (/sudeste|sureste|south.?east|\bse\b/.test(text)) return "sudeste";
  if (/sudoeste|south.?west|\bso\b|\bsw\b/.test(text)) return "sudoeste";
  if (/noroeste|north.?west|\bno\b|\bnw\b/.test(text)) return "noroeste";
  if (/\bnorte\b|\bnorth\b/.test(text)) return "norte";
  if (/\beste\b|\beast\b/.test(text)) return "este";
  if (/\bsur\b|\bsouth\b/.test(text)) return "sur";
  if (/\boeste\b|\bwest\b/.test(text)) return "oeste";
  if (/frente|fachada.?principal/.test(text)) return "frente_principal";
  return null;
}

function filenameDescription(raw: string) {
  const base = raw.replace(/\.[^.]+$/, "");
  const stripped = base
    .replace(/^NS\d+__?/i, "")
    .replace(/LAT-?\d+(?:\.\d+)?/gi, "")
    .replace(/LON-?\d+(?:\.\d+)?/gi, "")
    .replace(/H(?:NA|[-+]?\d+(?:\.\d+)?)(?:_[A-Z]+)?/gi, "")
    .replace(/_+/g, " ")
    .trim();
  return stripped || base;
}

export function parseSpatialHints(originalFilename: string, originalPath?: string | null) {
  const joined = [originalPath, originalFilename].filter(Boolean).join(" ");
  const latMatch = joined.match(/(?:^|[_\s])LAT(-?\d+(?:\.\d+)?)/i);
  const lonMatch = joined.match(/(?:^|[_\s])LON(-?\d+(?:\.\d+)?)/i);
  const headingMatch = joined.match(/(?:^|[_\s])H(-?\d+(?:\.\d+)?)(?:_([A-Z]{1,3}))?/i);
  const cardinalMatch = joined.match(/(?:^|[_\s])(N|NE|E|SE|S|SO|O|NO)(?:[_\s.]|$)/i);
  const latitude = latMatch ? Number(latMatch[1]) : null;
  const longitude = lonMatch ? Number(lonMatch[1]) : null;
  const heading = headingMatch ? normalizeHeading(Number(headingMatch[1])) : null;
  const explicitCardinal = (headingMatch?.[2] || cardinalMatch?.[1] || "").toUpperCase();
  const cardinal = CARDINALS.includes(explicitCardinal as CardinalDirection)
    ? explicitCardinal as CardinalDirection
    : headingToCardinal(heading);
  const sector = canonicalSectorFromText(joined);
  const sourceType = /street.?view|tierra del fuego|av del maestro|calle|street/i.test(joined)
    ? "street_view"
    : /satelit|mapa|aereo/i.test(joined)
      ? "satellite"
      : "unknown";
  const sceneType = sector === "interiores" ? "interior" : sourceType === "satellite" ? "aerial" : "exterior";

  return {
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    heading: Number.isFinite(heading) ? heading : null,
    cardinal,
    sector,
    sourceType,
    sceneType,
    description: filenameDescription(originalFilename),
  };
}

export function coordinatesToLocalMeters(
  origin: { latitude: number; longitude: number },
  point: { latitude: number; longitude: number },
) {
  const lat0 = origin.latitude * Math.PI / 180;
  const lat1 = point.latitude * Math.PI / 180;
  const lon0 = origin.longitude * Math.PI / 180;
  const lon1 = point.longitude * Math.PI / 180;
  const x = (lon1 - lon0) * Math.cos((lat0 + lat1) / 2) * EARTH_RADIUS_METERS;
  const y = (lat1 - lat0) * EARTH_RADIUS_METERS;
  return { x, y };
}

export function localMetersToCoordinates(
  origin: { latitude: number; longitude: number },
  local: { x: number; y: number },
) {
  const lat0 = origin.latitude * Math.PI / 180;
  const latitude = origin.latitude + (local.y / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const lat1 = latitude * Math.PI / 180;
  const cosine = Math.cos((lat0 + lat1) / 2);
  const safeCosine = Math.abs(cosine) < 1e-8 ? 1e-8 : cosine;
  const longitude = origin.longitude + (local.x / (EARTH_RADIUS_METERS * safeCosine)) * (180 / Math.PI);
  return { latitude, longitude };
}

export function placementState(image: Pick<
  StructureImageRecord,
  "local_x" | "local_y" | "spatial_source" | "manual_verified" | "confidence"
>) {
  if (image.manual_verified || image.spatial_source === "manual") return "verified_manual" as const;
  if (image.local_x == null || image.local_y == null || image.spatial_source === "unplaced") return "unplaced" as const;
  if (image.spatial_source === "inferred_cloud") {
    return (image.confidence ?? 0) < 0.58 ? "needs_review" as const : "placed_inferred" as const;
  }
  return "placed_metadata" as const;
}

export function compareStructureImages(
  a: Pick<StructureImageRecord, "latitude" | "longitude" | "heading" | "original_filename">,
  b: Pick<StructureImageRecord, "latitude" | "longitude" | "heading" | "original_filename">,
) {
  const aHasCoordinates = a.latitude != null && a.longitude != null;
  const bHasCoordinates = b.latitude != null && b.longitude != null;
  if (aHasCoordinates !== bHasCoordinates) return aHasCoordinates ? -1 : 1;

  if (a.latitude != null && b.latitude != null && a.latitude !== b.latitude) {
    return b.latitude - a.latitude;
  }
  if (a.longitude != null && b.longitude != null && a.longitude !== b.longitude) {
    return a.longitude - b.longitude;
  }
  if (a.heading != null && b.heading != null && a.heading !== b.heading) {
    return a.heading - b.heading;
  }
  if ((a.heading == null) !== (b.heading == null)) return a.heading == null ? 1 : -1;
  return a.original_filename.localeCompare(b.original_filename, "es");
}

export function buildOrderedFilename(index: number, image: Pick<
  StructureImageRecord,
  "original_filename" | "latitude" | "longitude" | "heading" | "cardinal_direction" | "description"
>) {
  const extension = image.original_filename.split(".").pop()?.toLowerCase() || "jpg";
  const prefix = `NS${String(index).padStart(3, "0")}`;
  const coords = image.latitude != null && image.longitude != null
    ? `__LAT${image.latitude.toFixed(7)}__LON${image.longitude.toFixed(7)}`
    : "";
  const heading = image.heading != null
    ? `__H${normalizeHeading(image.heading).toFixed(2)}_${image.cardinal_direction || headingToCardinal(image.heading) || "SIN_RUMBO"}`
    : `__HNA_${image.cardinal_direction || "SIN_RUMBO"}`;
  const description = safeFileSegment(image.description || image.original_filename.replace(/\.[^.]+$/, ""), "imagen");
  return `${prefix}${coords}${heading}__${description}.${extension}`;
}

export function sectorFolder(image: Pick<StructureImageRecord, "sector" | "cardinal_direction" | "scene_type" | "source_type">) {
  const sector = canonicalSectorFromText(image.sector);
  if (sector === "mapas_aereos_y_topologia" || image.source_type === "satellite" || image.scene_type === "aerial") {
    return "01_MAPAS_AEREOS_Y_TOPOLOGIA";
  }
  if (sector === "norte") return "02_NORTE";
  if (sector === "noreste") return "03_NORESTE";
  if (sector === "este") return "04_ESTE";
  if (sector === "sudeste") return "05_SUDESTE";
  if (sector === "sur") return "06_SUR";
  if (sector === "sudoeste") return "07_SUDOESTE";
  if (sector === "oeste") return "08_OESTE";
  if (sector === "noroeste") return "09_NOROESTE";
  if (sector === "patio") return "10_PATIO";
  if (sector === "interiores" || image.scene_type === "interior") return "11_INTERIORES";
  if (sector === "referencias_historicas") return "13_REFERENCIAS_HISTORICAS";
  if (sector === "contexto") return "12_CONTEXTO";

  const direction = (image.cardinal_direction || "").toUpperCase();
  const byDirection: Record<string, string> = {
    N: "02_NORTE", NE: "03_NORESTE", E: "04_ESTE", SE: "05_SUDESTE",
    S: "06_SUR", SO: "07_SUDOESTE", O: "08_OESTE", NO: "09_NOROESTE",
  };
  return byDirection[direction] ?? "12_CONTEXTO";
}

export function computeEvidenceCoverage(images: StructureImageRecord[]) {
  const total = images.length;
  const analyzed = images.filter((image) => ["analyzed", "verified", "needs_review"].includes(image.analysis_status)).length;
  const verified = images.filter((image) => image.manual_verified || image.analysis_status === "verified").length;
  const geolocated = images.filter((image) => image.latitude != null && image.longitude != null).length;
  const directions = new Set(
    images
      .filter((image) => image.scene_type !== "interior" && image.source_type !== "satellite")
      .map((image) => (image.cardinal_direction || headingToCardinal(image.heading)) as CardinalDirection | null)
      .filter((value): value is CardinalDirection => Boolean(value)),
  );
  const interiorImages = images.filter((image) => image.scene_type === "interior").length;
  const roofImages = images.filter((image) => (image.visible_surfaces ?? []).some((surface) => /techo|roof/i.test(surface))).length;
  const contextImages = images.filter((image) => {
    const sector = canonicalSectorFromText(image.sector);
    return sector === "contexto" || image.source_type === "satellite";
  }).length;

  const pct = (value: number, denominator: number) => denominator > 0 ? Math.round((value / denominator) * 100) : 0;
  return {
    total,
    analyzed: pct(analyzed, total),
    verified: pct(verified, total),
    geolocated: pct(geolocated, total),
    exteriorAngular: Math.round((directions.size / CARDINALS.length) * 100),
    representedDirections: [...directions],
    interiorEvidence: interiorImages,
    roofEvidence: roofImages,
    contextEvidence: contextImages,
  };
}

export function cornerEvidence(images: StructureImageRecord[], corner: "NE" | "SE" | "SO" | "NO") {
  const required: Record<typeof corner, CardinalDirection[]> = {
    NE: ["N", "E", "NE"],
    SE: ["S", "E", "SE"],
    SO: ["S", "O", "SO"],
    NO: ["N", "O", "NO"],
  };
  const directions = required[corner];
  const available = directions.filter((direction) =>
    images.some((image) => (image.cardinal_direction || headingToCardinal(image.heading)) === direction),
  );
  const missing = directions.filter((direction) => !available.includes(direction));
  const references = images
    .filter((image) => {
      const direction = image.cardinal_direction || headingToCardinal(image.heading);
      return direction != null && directions.includes(direction as CardinalDirection);
    })
    .sort((a, b) => (b.priority - a.priority) || ((b.confidence ?? 0) - (a.confidence ?? 0)));
  return { corner, available, missing, references };
}
