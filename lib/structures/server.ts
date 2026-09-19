import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { generateGoogleCloudJson, type GoogleCloudReferenceImage } from "@/lib/server/google-cloud-genai";
import { parseExifMetadata } from "@/lib/structures/exif";
import {
  buildOrderedFilename,
  compareStructureImages,
  coordinatesToLocalMeters,
  headingToCardinal,
  normalizeHeading,
  parseSpatialHints,
  safeFileSegment,
  slugifyStructure,
  type StructureCameraNodeRecord,
  type StructureImageRecord,
  type StructureRecord,
} from "@/lib/structures/spatial";

const MAX_IMAGE_BYTES = 35 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const GENERATED_BUCKET = process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";

export type StructurePlacementAnalysis = {
  canPlacePosition: boolean;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  pitch: number | null;
  fov: number | null;
  confidence: number;
  reason: string;
};

export type StructureVisionAnalysis = {
  sourceType: string | null;
  sceneType: string | null;
  sectorCandidate: string | null;
  camera: {
    heading: number | null;
    pitch: number | null;
    fovEstimate: number | null;
  };
  visibleSurfaces: string[];
  landmarks: Array<{ type: string; description: string }>;
  description: string;
  tags: string[];
  potentialConflicts: string[];
  confidence: number;
};

function clampConfidence(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(1, Math.max(0, number));
}

function finiteOrNull(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown, max = 160) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function strings(value: unknown, maxItems = 24, maxLength = 90) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim().slice(0, maxLength))
    .slice(0, maxItems))];
}

function sanitizeAnalysis(raw: unknown): StructureVisionAnalysis {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const camera = record.camera && typeof record.camera === "object"
    ? record.camera as Record<string, unknown>
    : {};
  const landmarks = Array.isArray(record.landmarks)
    ? record.landmarks
      .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        type: stringOrNull(item.type, 60) ?? "landmark",
        description: stringOrNull(item.description, 240) ?? "",
      }))
      .filter((item) => item.description)
      .slice(0, 20)
    : [];

  return {
    sourceType: stringOrNull(record.sourceType, 60),
    sceneType: stringOrNull(record.sceneType, 60),
    sectorCandidate: stringOrNull(record.sectorCandidate, 100),
    camera: {
      heading: finiteOrNull(camera.heading),
      pitch: finiteOrNull(camera.pitch),
      fovEstimate: finiteOrNull(camera.fovEstimate),
    },
    visibleSurfaces: strings(record.visibleSurfaces),
    landmarks,
    description: stringOrNull(record.description, 700) ?? "Referencia espacial sin descripción automática.",
    tags: strings(record.tags, 24, 60),
    potentialConflicts: strings(record.potentialConflicts, 12, 180),
    confidence: clampConfidence(record.confidence),
  };
}

function sanitizePlacement(raw: unknown): StructurePlacementAnalysis {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const latitude = finiteOrNull(record.latitude);
  const longitude = finiteOrNull(record.longitude);
  const rawHeading = finiteOrNull(record.heading);
  const confidence = clampConfidence(record.confidence);
  const canPlacePosition = Boolean(record.canPlacePosition)
    && latitude != null
    && longitude != null
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;

  return {
    canPlacePosition,
    latitude: canPlacePosition ? latitude : null,
    longitude: canPlacePosition ? longitude : null,
    heading: rawHeading == null ? null : normalizeHeading(rawHeading),
    pitch: finiteOrNull(record.pitch),
    fov: finiteOrNull(record.fov),
    confidence,
    reason: stringOrNull(record.reason, 700) ?? "Sin explicación de colocación.",
  };
}

export async function getOwnedStructure(admin: SupabaseClient, userId: string, structureId: string) {
  const { data, error } = await admin
    .from("structures")
    .select("*")
    .eq("id", structureId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error("No se pudo leer la estructura.");
  if (!data) throw new Error("Estructura no encontrada.");
  return data as unknown as StructureRecord;
}

export async function makeUniqueStructureSlug(admin: SupabaseClient, userId: string, name: string) {
  const base = slugifyStructure(name);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data, error } = await admin
      .from("structures")
      .select("id")
      .eq("owner_id", userId)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error("No se pudo validar el nombre de la estructura.");
    if (!data) return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function ingestStructureImage(args: {
  admin: SupabaseClient;
  userId: string;
  structure: StructureRecord;
  batchId: string | null;
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  originalPath?: string | null;
}) {
  if (!ALLOWED_IMAGE_MIME.has(args.mimeType)) throw new Error(`Formato no soportado: ${args.fileName}`);
  if (!args.bytes.length || args.bytes.length > MAX_IMAGE_BYTES) throw new Error(`${args.fileName} supera el tamaño permitido.`);

  const metadata = await sharp(args.bytes, { failOn: "warning" }).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`${args.fileName} no es una imagen válida.`);

  const sha256 = createHash("sha256").update(args.bytes).digest("hex");
  const exif = parseExifMetadata(metadata.exif);
  const { data: duplicate } = await args.admin
    .from("structure_images")
    .select("id")
    .eq("structure_id", args.structure.id)
    .eq("sha256", sha256)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const hints = parseSpatialHints(args.fileName, args.originalPath);
  const latitude = exif.latitude ?? hints.latitude;
  const longitude = exif.longitude ?? hints.longitude;
  const heading = exif.gpsHeading ?? hints.heading;
  const cardinal = headingToCardinal(heading) ?? hints.cardinal;
  const spatialSource = exif.latitude != null || exif.longitude != null || exif.gpsHeading != null
    ? "exif"
    : hints.latitude != null || hints.longitude != null || hints.heading != null
      ? "filename"
      : "unplaced";
  let originLatitude = args.structure.origin_latitude ?? args.structure.latitude;
  let originLongitude = args.structure.origin_longitude ?? args.structure.longitude;

  if (
    originLatitude == null
    && originLongitude == null
    && latitude != null
    && longitude != null
  ) {
    originLatitude = latitude;
    originLongitude = longitude;
    await args.admin
      .from("structures")
      .update({
        origin_latitude: originLatitude,
        origin_longitude: originLongitude,
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.structure.id)
      .eq("owner_id", args.userId);
  }

  const local = (
    originLatitude != null
    && originLongitude != null
    && latitude != null
    && longitude != null
  ) ? coordinatesToLocalMeters(
    { latitude: originLatitude, longitude: originLongitude },
    { latitude, longitude },
  ) : null;

  const uploaded = await uploadGeneratedMediaObject({
    bytes: args.bytes,
    mimeType: args.mimeType,
    pathPrefix: `structures/${args.userId}/${args.structure.id}/source`,
  });

  const { data, error } = await args.admin
    .from("structure_images")
    .insert({
      structure_id: args.structure.id,
      batch_id: args.batchId,
      storage_path: uploaded.objectPath,
      public_url: uploaded.url,
      original_filename: args.fileName,
      original_path: args.originalPath ?? args.fileName,
      width: metadata.width,
      height: metadata.height,
      mime_type: args.mimeType,
      byte_size: args.bytes.length,
      sha256,
      source_type: hints.sourceType,
      latitude,
      longitude,
      altitude: exif.altitude,
      heading,
      local_x: local?.x ?? null,
      local_y: local?.y ?? null,
      cardinal_direction: cardinal,
      sector: hints.sector,
      scene_type: hints.sceneType,
      description: hints.description,
      metadata: {
        deterministic: {
          source: "filename+image-header",
          width: metadata.width,
          height: metadata.height,
          format: metadata.format ?? null,
          hasEmbeddedExif: Boolean(metadata.exif?.length),
          exif: {
            orientation: exif.orientation,
            dateTimeOriginal: exif.dateTimeOriginal,
            latitude: exif.latitude,
            longitude: exif.longitude,
            altitude: exif.altitude,
            gpsHeading: exif.gpsHeading,
          },
          parsedSpatialHints: hints,
          spatialTruthPriority: exif.latitude != null || exif.longitude != null || exif.gpsHeading != null ? "exif" : "filename",
        },
      },
      duplicate_of: duplicate?.id ?? null,
      analysis_status: "metadata_ready",
      spatial_source: spatialSource,
      placement_status: local != null && heading != null ? "placed" : "unplaced",
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(`No se pudo registrar ${args.fileName}.`);
  const image = data as unknown as StructureImageRecord;
  await syncCameraNode(args.admin, image);
  return image;
}

export async function rebuildStructureImageOrder(admin: SupabaseClient, structureId: string) {
  const { data, error } = await admin
    .from("structure_images")
    .select("*")
    .eq("structure_id", structureId);
  if (error) throw new Error("No se pudo ordenar la evidencia.");
  const rows = (data ?? []) as unknown as StructureImageRecord[];
  rows.sort(compareStructureImages);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const ordered = buildOrderedFilename(index + 1, row);
    if (row.ordered_filename === ordered) continue;
    await admin
      .from("structure_images")
      .update({ ordered_filename: ordered, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("structure_id", structureId);
  }
  return rows.length;
}

export async function downloadStructureImage(url: string, maxBytes = MAX_IMAGE_BYTES) {
  const parsed = new URL(url);
  const expectedPrefix = `/${GENERATED_BUCKET}/`;
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "storage.googleapis.com"
    || !parsed.pathname.startsWith(expectedPrefix)
  ) {
    throw new Error("La referencia no pertenece al almacenamiento de CLOUVA.");
  }
  const response = await fetch(parsed, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("No se pudo recuperar la referencia.");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("La referencia supera el tamaño permitido.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error("La referencia no es válida.");
  return bytes;
}

export async function analyzeStructureImageWithCloud(image: StructureImageRecord) {
  const bytes = await downloadStructureImage(image.public_url);
  const model = process.env.GOOGLE_CLOUD_STRUCTURES_VISION_MODEL
    ?? process.env.CLOUVA_STRUCTURES_VISION_MODEL
    ?? "gemini-2.5-flash";

  const deterministic = {
    filename: image.original_filename,
    originalPath: image.original_path,
    latitude: image.latitude,
    longitude: image.longitude,
    heading: image.heading,
    cardinalDirection: image.cardinal_direction,
    sector: image.sector,
    sceneType: image.scene_type,
  };

  const prompt = [
    "CLOUVA STRUCTURES — análisis de evidencia espacial sobre Google Cloud Vertex AI.",
    "La imagen pertenece a un proyecto de reconstrucción de un lugar físico real.",
    "No diseñes ni inventes arquitectura. Analizá solamente lo visible.",
    "Los datos determinísticos suministrados tienen prioridad y NO deben ser reemplazados por inferencias.",
    "Nunca inventes latitud ni longitud. Nunca afirmes un rumbo exacto si no puede inferirse razonablemente.",
    "Describí superficies útiles para reconstrucción: fachadas, paredes, techo, piso, puertas, ventanas, rejas, calles, veredas, patio, habitaciones, pasillos, escaleras y landmarks.",
    "Si parece captura de Street View, satélite, foto común o screenshot, indicarlo.",
    "Si detectás una contradicción visual potencial con otras épocas (por ejemplo cercos/rejas nuevos), solo describí el elemento; no decidas qué época es correcta.",
    `Datos determinísticos: ${JSON.stringify(deterministic)}`,
  ].join("\n\n");

  const generated = await generateGoogleCloudJson({
    model,
    prompt,
    referenceImages: [{
      mimeType: image.mime_type,
      data: bytes.toString("base64"),
    }],
    responseJsonSchema: {
      type: "object",
      properties: {
        sourceType: { type: ["string", "null"] },
        sceneType: { type: ["string", "null"] },
        sectorCandidate: { type: ["string", "null"] },
        camera: {
          type: "object",
          properties: {
            heading: { type: ["number", "null"] },
            pitch: { type: ["number", "null"] },
            fovEstimate: { type: ["number", "null"] },
          },
          required: ["heading", "pitch", "fovEstimate"],
        },
        visibleSurfaces: { type: "array", items: { type: "string" } },
        landmarks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              description: { type: "string" },
            },
            required: ["type", "description"],
          },
        },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        potentialConflicts: { type: "array", items: { type: "string" } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: [
        "sourceType",
        "sceneType",
        "sectorCandidate",
        "camera",
        "visibleSurfaces",
        "landmarks",
        "description",
        "tags",
        "potentialConflicts",
        "confidence",
      ],
    },
    temperature: 0.1,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(generated.text);
  } catch {
    throw new Error("CLOUVA Cloud devolvió un análisis que no es JSON válido.");
  }
  return sanitizeAnalysis(parsed);
}

function inferSurfaceType(label: string) {
  const text = label.toLowerCase();
  if (/fachada/.test(text)) return "facade";
  if (/muro|pared/.test(text)) return "wall";
  if (/techo/.test(text)) return "roof";
  if (/piso|suelo/.test(text)) return "floor";
  if (/puerta|entrada/.test(text)) return "door";
  if (/ventana/.test(text)) return "window";
  if (/reja|cerca|cerco/.test(text)) return "fence";
  if (/calle/.test(text)) return "street";
  if (/vereda/.test(text)) return "sidewalk";
  if (/patio|cancha/.test(text)) return "yard";
  if (/aula|habitacion|salon/.test(text)) return "room";
  if (/pasillo/.test(text)) return "corridor";
  if (/escalera/.test(text)) return "stairs";
  return "landmark";
}

export async function syncCameraNode(admin: SupabaseClient, image: StructureImageRecord) {
  const payload = {
    structure_id: image.structure_id,
    image_id: image.id,
    latitude: image.latitude,
    longitude: image.longitude,
    altitude: image.altitude,
    local_x: image.local_x,
    local_y: image.local_y,
    local_z: image.local_z,
    heading: image.heading,
    pitch: image.pitch,
    roll: image.roll,
    fov: image.fov,
    confidence: image.confidence,
    spatial_source: image.spatial_source ?? "unplaced",
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("structure_camera_nodes")
    .upsert(payload, { onConflict: "image_id" });
  if (error) throw new Error("No se pudo actualizar el nodo de cámara.");
}

export async function applyStructureAnalysis(
  admin: SupabaseClient,
  structure: StructureRecord,
  image: StructureImageRecord,
  analysis: StructureVisionAnalysis,
) {
  const heading = image.heading ?? analysis.camera.heading;
  const nextStatus = image.manual_verified
    ? "verified"
    : analysis.confidence < 0.58 ? "needs_review" : "analyzed";
  const nextVisible = analysis.visibleSurfaces.length
    ? analysis.visibleSurfaces
    : (image.visible_surfaces ?? []);
  const update = {
    source_type: image.source_type !== "unknown" ? image.source_type : (analysis.sourceType ?? "unknown"),
    scene_type: image.scene_type || analysis.sceneType || "unknown",
    sector: image.sector || analysis.sectorCandidate,
    heading,
    pitch: image.pitch ?? analysis.camera.pitch,
    fov: image.fov ?? analysis.camera.fovEstimate,
    cardinal_direction: image.cardinal_direction || headingToCardinal(heading),
    visible_surfaces: nextVisible,
    tags: analysis.tags,
    description: analysis.description || image.description,
    confidence: analysis.confidence,
    analysis: analysis as unknown as Record<string, unknown>,
    analysis_status: nextStatus,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("structure_images")
    .update(update)
    .eq("id", image.id)
    .eq("structure_id", structure.id)
    .select("*")
    .single();
  if (error || !data) throw new Error("No se pudo guardar el análisis espacial.");

  const updated = data as unknown as StructureImageRecord;
  await syncCameraNode(admin, updated);

  for (const surfaceName of nextVisible) {
    const slug = slugifyStructure(surfaceName);
    const { data: surface, error: surfaceError } = await admin
      .from("structure_surfaces")
      .upsert({
        structure_id: structure.id,
        slug,
        name: surfaceName,
        type: inferSurfaceType(surfaceName),
        confidence: analysis.confidence,
        updated_at: new Date().toISOString(),
      }, { onConflict: "structure_id,slug" })
      .select("id")
      .single();
    if (surfaceError || !surface) continue;
    await admin
      .from("structure_image_surface_links")
      .upsert({
        structure_id: structure.id,
        image_id: image.id,
        surface_id: surface.id,
        confidence: analysis.confidence,
        source: image.manual_verified ? "manual" : "analysis",
      }, { onConflict: "image_id,surface_id" });
  }

  return updated;
}


async function compactPlacementImage(image: StructureImageRecord) {
  const bytes = await downloadStructureImage(image.public_url);
  const prepared = await sharp(bytes)
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return { mimeType: "image/jpeg", data: prepared.toString("base64") };
}

export async function inferStructurePlacementWithCloud(args: {
  admin: SupabaseClient;
  structure: StructureRecord;
  image: StructureImageRecord;
}) {
  const { data: anchorRows, error: anchorsError } = await args.admin
    .from("structure_images")
    .select("*")
    .eq("structure_id", args.structure.id)
    .neq("id", args.image.id)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .order("manual_verified", { ascending: false })
    .order("priority", { ascending: false })
    .limit(12);
  if (anchorsError) throw new Error("No se pudieron preparar las referencias de ubicación.");

  const anchors = (anchorRows ?? []) as unknown as StructureImageRecord[];
  const scoredAnchors = anchors
    .slice()
    .sort((a, b) => {
      const sameSectorA = a.sector && args.image.sector && a.sector === args.image.sector ? 20 : 0;
      const sameSectorB = b.sector && args.image.sector && b.sector === args.image.sector ? 20 : 0;
      return (sameSectorB + Number(b.manual_verified) * 30 + b.priority + (b.confidence ?? 0) * 5)
        - (sameSectorA + Number(a.manual_verified) * 30 + a.priority + (a.confidence ?? 0) * 5);
    })
    .slice(0, 3);

  const targetMedia = await compactPlacementImage(args.image);
  const preparedAnchors = (await Promise.all(scoredAnchors.map(async (anchor) => {
    try {
      return { anchor, media: await compactPlacementImage(anchor) };
    } catch {
      return null;
    }
  }))).filter((item): item is { anchor: StructureImageRecord; media: GoogleCloudReferenceImage } => Boolean(item));

  const prompt = [
    "CLOUVA STRUCTURES — COLOCACIÓN ESPACIAL DE CÁMARA sobre Google Cloud Vertex AI.",
    "Referencia visual 1 es la captura objetivo.",
    "Referencias visuales 2 en adelante son anchors geolocalizados del MISMO lugar físico, en el mismo orden que el array Anchors.",
    "La captura puede ser Google Street View/Maps y mostrar minimapa, brújula, nombre de calle, dirección, pin, muñequito o interfaz de navegación.",
    "Ubicá la CÁMARA / MUÑEQUITO que produjo la captura y determiná hacia dónde mira.",
    "NO reconstruyas el edificio. NO inventes coordenadas.",
    "Solo devolvé latitud/longitud si están visibles/legibles o si pueden triangularse razonablemente con los anchors suministrados.",
    "Si no hay base suficiente para posición absoluta, canPlacePosition=false y latitude/longitude=null.",
    "El heading puede estimarse por brújula, orientación de Street View, calles o comparación con anchors. Si no alcanza, devolver null.",
    "Los datos duros existentes del objetivo tienen prioridad.",
    `Proyecto: ${JSON.stringify({
      name: args.structure.name,
      location: args.structure.location_name,
      originLatitude: args.structure.origin_latitude,
      originLongitude: args.structure.origin_longitude,
    })}`,
    `Objetivo: ${JSON.stringify({
      filename: args.image.original_filename,
      originalPath: args.image.original_path,
      latitude: args.image.latitude,
      longitude: args.image.longitude,
      heading: args.image.heading,
      sector: args.image.sector,
      description: args.image.description,
      source: args.image.spatial_source,
    })}`,
    `Anchors: ${JSON.stringify(preparedAnchors.map(({ anchor }) => ({
      id: anchor.id,
      latitude: anchor.latitude,
      longitude: anchor.longitude,
      heading: anchor.heading,
      sector: anchor.sector,
      description: anchor.description,
      verified: anchor.manual_verified,
      source: anchor.spatial_source,
    })))}`,
  ].join("\n\n");

  const model = process.env.GOOGLE_CLOUD_STRUCTURES_VISION_MODEL
    ?? process.env.CLOUVA_STRUCTURES_VISION_MODEL
    ?? "gemini-2.5-flash";

  const generated = await generateGoogleCloudJson({
    model,
    prompt,
    referenceImages: [
      targetMedia,
      ...preparedAnchors.map((item) => item.media),
    ],
    responseJsonSchema: {
      type: "object",
      properties: {
        canPlacePosition: { type: "boolean" },
        latitude: { type: ["number", "null"] },
        longitude: { type: ["number", "null"] },
        heading: { type: ["number", "null"] },
        pitch: { type: ["number", "null"] },
        fov: { type: ["number", "null"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string" },
      },
      required: [
        "canPlacePosition",
        "latitude",
        "longitude",
        "heading",
        "pitch",
        "fov",
        "confidence",
        "reason",
      ],
    },
    temperature: 0.05,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(generated.text);
  } catch {
    throw new Error("CLOUVA Cloud devolvió una colocación que no es JSON válido.");
  }
  return sanitizePlacement(parsed);
}

function placementMetadata(
  current: Record<string, unknown> | null,
  payload: Record<string, unknown>,
) {
  return {
    ...(current ?? {}),
    placement: {
      ...((current?.placement && typeof current.placement === "object")
        ? current.placement as Record<string, unknown>
        : {}),
      ...payload,
    },
  };
}

export async function placeStructureImage(args: {
  admin: SupabaseClient;
  userId: string;
  structure: StructureRecord;
  image: StructureImageRecord;
  allowCloud?: boolean;
}) {
  const image = args.image;

  if (image.manual_verified || image.spatial_source === "manual") {
    await syncCameraNode(args.admin, image);
    return { image, usedCloud: false, needsReview: false };
  }

  let latitude = image.latitude;
  let longitude = image.longitude;
  let heading = image.heading;
  let pitch = image.pitch;
  let fov = image.fov;
  let confidence = image.confidence;
  let source = image.spatial_source ?? "unplaced";
  let cloud: StructurePlacementAnalysis | null = null;
  const missingPosition = latitude == null || longitude == null;
  const missingDirection = heading == null;

  if ((missingPosition || missingDirection) && args.allowCloud !== false) {
    cloud = await inferStructurePlacementWithCloud({
      admin: args.admin,
      structure: args.structure,
      image,
    });
    if (missingPosition && cloud.canPlacePosition) {
      latitude = cloud.latitude;
      longitude = cloud.longitude;
      source = "inferred_cloud";
    }
    if (missingDirection && cloud.heading != null) {
      heading = cloud.heading;
      if (source === "unplaced") source = "inferred_cloud";
    }
    if (pitch == null && cloud.pitch != null) pitch = cloud.pitch;
    if (fov == null && cloud.fov != null) fov = cloud.fov;
    confidence = cloud.confidence;
  }

  let originLatitude = args.structure.origin_latitude ?? args.structure.latitude;
  let originLongitude = args.structure.origin_longitude ?? args.structure.longitude;

  if (
    originLatitude == null
    && originLongitude == null
    && latitude != null
    && longitude != null
    && source !== "inferred_cloud"
  ) {
    originLatitude = latitude;
    originLongitude = longitude;
    await args.admin
      .from("structures")
      .update({
        origin_latitude: originLatitude,
        origin_longitude: originLongitude,
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.structure.id)
      .eq("owner_id", args.userId);
  }

  const local = (
    originLatitude != null
    && originLongitude != null
    && latitude != null
    && longitude != null
  ) ? coordinatesToLocalMeters(
    { latitude: originLatitude, longitude: originLongitude },
    { latitude, longitude },
  ) : null;

  const hasPosition = local != null;
  const needsReview = hasPosition && (
    heading == null
    || (source === "inferred_cloud" && (confidence ?? 0) < 0.58)
  );
  const placementStatus = hasPosition
    ? (needsReview ? "needs_review" : "placed")
    : cloud ? "blocked" : "unplaced";
  const metadata = placementMetadata(image.metadata, {
    placedAt: new Date().toISOString(),
    spatialSource: source,
    cloudUsed: Boolean(cloud),
    confidence: confidence ?? null,
    needsReview,
    reason: cloud?.reason ?? "Ubicación calculada desde metadatos determinísticos.",
    positionSource: image.latitude != null && image.longitude != null ? image.spatial_source : (cloud?.canPlacePosition ? "inferred_cloud" : null),
    headingSource: image.heading != null ? image.spatial_source : (cloud?.heading != null ? "inferred_cloud" : null),
  });

  const { data, error } = await args.admin
    .from("structure_images")
    .update({
      latitude,
      longitude,
      heading,
      pitch,
      fov,
      local_x: local?.x ?? null,
      local_y: local?.y ?? null,
      local_z: image.altitude ?? image.local_z,
      cardinal_direction: headingToCardinal(heading),
      confidence,
      spatial_source: source,
      placement_status: placementStatus,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", image.id)
    .eq("structure_id", args.structure.id)
    .select("*")
    .single();
  if (error || !data) throw new Error("No se pudo guardar la colocación de cámara.");

  const updated = data as unknown as StructureImageRecord;
  await syncCameraNode(args.admin, updated);
  return { image: updated, usedCloud: Boolean(cloud), needsReview };
}

export function normalizeRuleList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function compactStructureIdentityPack(args: {
  structure: StructureRecord;
  rules: string[];
  surfaces: Array<{ name: string; type: string; orientation?: number | null }>;
  images: StructureImageRecord[];
  cameraNodes?: StructureCameraNodeRecord[];
}) {
  const topDescriptions = args.images
    .slice()
    .sort((a, b) =>
      Number(b.manual_verified) - Number(a.manual_verified)
      || b.priority - a.priority
      || (b.confidence ?? 0) - (a.confidence ?? 0),
    )
    .slice(0, 32)
    .map((image) => ({
      id: image.id,
      sector: image.sector,
      direction: image.cardinal_direction,
      description: image.description,
      surfaces: image.visible_surfaces ?? [],
      verified: image.manual_verified,
      sourceType: image.source_type,
      sceneType: image.scene_type,
    }));

  const cameraGraph = (args.cameraNodes ?? [])
    .map((node) => ({
      imageId: node.image_id,
      x: finiteOrNull(node.local_x),
      y: finiteOrNull(node.local_y),
      z: finiteOrNull(node.local_z),
      heading: finiteOrNull(node.heading),
      pitch: finiteOrNull(node.pitch),
      fov: finiteOrNull(node.fov),
      source: node.spatial_source,
    }))
    .filter((node) => node.x != null && node.y != null);

  const xs = cameraGraph.map((node) => node.x as number);
  const ys = cameraGraph.map((node) => node.y as number);
  const spatialBounds = xs.length && ys.length
    ? {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        spanX: Math.max(...xs) - Math.min(...xs),
        spanY: Math.max(...ys) - Math.min(...ys),
      }
    : null;

  return {
    project: {
      id: args.structure.id,
      name: args.structure.name,
      type: args.structure.structure_type,
      location: args.structure.location_name,
      description: args.structure.description,
      historicalNotes: args.structure.historical_notes,
      blockout: args.structure.blockout ?? {},
    },
    reconstructionRules: args.rules,
    surfaces: args.surfaces.slice(0, 80),
    spatial: {
      coordinateSystem: "local meters; +X east/right, +Y north/up in plan",
      cameraCount: cameraGraph.length,
      bounds: spatialBounds,
      cameras: cameraGraph.slice(0, 120),
    },
    evidenceSummary: topDescriptions,
  };
}

export function pickRenderReferences(
  images: StructureImageRecord[],
  view: "front" | "corner" | "environment" | "aerial_oblique",
  limit = 8,
) {
  const score = (image: StructureImageRecord) => {
    let value = image.priority * 3 + (image.confidence ?? 0) * 8;
    if (image.manual_verified) value += 24;
    if (image.duplicate_of) value -= 12;

    const sector = (image.sector ?? "").toLowerCase();
    const description = (image.description ?? "").toLowerCase();
    const text = `${sector} ${description}`;
    const aerial = image.source_type === "satellite" || image.scene_type === "aerial";
    const buildingEvidence = /escuela|edificio|fachada|muro|reja|perimetro|techo|patio|acceso|escalera|porton|ventana|aula/.test(text);
    const contextHeavy = /parque|barrio|viviendas|horizonte|lote abierto|plaza|arbolado/.test(text) && !buildingEvidence;

    if (view === "front") {
      if (/frente|fachada.?principal/.test(text)) value += 55;
      if (buildingEvidence) value += 32;
      if (contextHeavy) value -= 34;
      if (aerial) value -= 45;
    }

    if (view === "corner") {
      if (/esquina|noreste|noroeste|sudeste|sudoeste/.test(text)) value += 48;
      if (buildingEvidence) value += 28;
      if (contextHeavy) value -= 24;
      if (aerial) value -= 35;
    }

    if (view === "environment") {
      if (/contexto|parque|calle|entorno|barrio|plaza|vereda/.test(text)) value += 36;
      if (buildingEvidence) value += 16;
      if (aerial) value += 6;
    }

    if (view === "aerial_oblique") {
      if (aerial) value += 90;
      else value -= 22;
      if (/predio|techo|patio|huella|mapa|satelit/.test(text)) value += 24;
    }

    return value;
  };

  const seenHashes = new Set<string>();
  return images
    .slice()
    .sort((a, b) => score(b) - score(a))
    .filter((image) => {
      if (seenHashes.has(image.sha256)) return false;
      seenHashes.add(image.sha256);
      return true;
    })
    .slice(0, Math.max(1, Math.min(10, limit)));
}

export function renderPrompt(args: {
  identityPack: Record<string, unknown>;
  view: "front" | "corner" | "environment" | "aerial_oblique";
  referenceDescriptions: Array<{
    id: string;
    description: string | null;
    sector: string | null;
    direction: string | null;
    localX?: number | null;
    localY?: number | null;
    heading?: number | null;
  }>;
  hasCanonicalAnchor?: boolean;
}) {
  const viewInstruction = {
    front: "fachada principal real, cámara humana a nivel de calle; mostrar el edificio y su frente, no una toma de contexto vacía",
    corner: "esquina arquitectónica real que revele simultáneamente dos caras del MISMO edificio",
    environment: "vista abierta del MISMO edificio dentro de su entorno real, conservando calles, veredas, parque y distancias relativas",
    aerial_oblique: "vista superior oblicua limpia del MISMO edificio, preservando huella, techo, patio y contexto real",
  }[args.view];

  return [
    "CLOUVA STRUCTURES — RECONSTRUCCIÓN MULTIVISTA DE UN ÚNICO LUGAR REAL.",
    "THIS IS A RECONSTRUCTION TASK, NOT A DESIGN TASK AND NOT A SCREENSHOT REPRODUCTION TASK.",
    "Todas las imágenes adjuntas son evidencia del MISMO lugar físico. Deben fusionarse en UNA sola geometría canónica coherente.",
    "El paquete spatial.cameras contiene posiciones relativas y headings de cámaras reales en metros. Usalo para resolver qué cara del lugar aparece en cada evidencia y mantener consistencia espacial.",
    "La evidencia satelital/aérea define principalmente huella, techo, patio y relaciones de planta. La evidencia a nivel de calle define fachadas, aberturas, muros, rejas, materiales y altura aparente.",
    "Las referencias pueden ser capturas de Google Maps/Street View o del navegador. TODO elemento de interfaz es ruido de evidencia: NO reproduzcas pestañas, barra de direcciones, paneles, minimapas, brújulas, botones, pins, etiquetas, textos, cursores, marcas de agua ni controles de Google.",
    "La salida debe ser una fotografía limpia del mundo físico reconstruido, como si una cámara real nueva hubiera fotografiado el lugar sin interfaz superpuesta.",
    "No copies una referencia completa. No devuelvas una captura de pantalla. Recompone el lugar usando simultáneamente varias evidencias.",
    "No rediseñes el edificio. No agregues arquitectura decorativa. No sustituyas materiales o elementos por equivalentes genéricos.",
    "Mantené huella, posición relativa de paredes, geometría de techo, aberturas, proporciones, cercos/rejas, veredas, calles, patio y entorno según la evidencia.",
    "Si distintas evidencias chocan: prioridad 1 = datos manualmente verificados; prioridad 2 = huella/satélite y geometría repetida por varias vistas; prioridad 3 = evidencia individual.",
    "Cuando una zona no esté documentada, completala solo con continuidad geométrica mínima. No inventes alas, pisos, ventanas o techos nuevos.",
    args.hasCanonicalAnchor
      ? "La PRIMERA imagen adjunta es el ANCLA CANÓNICA de la reconstrucción de este mismo job. Conservá estrictamente su huella, volumetría, techo y organización general; las demás referencias aportan detalle fotográfico."
      : "No hay ancla canónica previa para esta vista: derivá la geometría únicamente del identity pack espacial y de las evidencias.",
    `Vista solicitada: ${viewInstruction}.`,
    `STRUCTURE IDENTITY PACK:\n${JSON.stringify(args.identityPack)}`,
    `Referencias seleccionadas para esta cámara:\n${JSON.stringify(args.referenceDescriptions)}`,
    "Salida: solo imagen fotorrealista limpia del lugar reconstruido. Sin rótulos técnicos, sin texto explicativo, sin UI, sin marcos de navegador.",
  ].join("\n\n");
}

export function safeDownloadName(name: string) {
  return safeFileSegment(name, "estructura");
}
