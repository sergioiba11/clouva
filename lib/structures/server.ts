import "server-only";

import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { parseExifMetadata } from "@/lib/structures/exif";
import {
  buildOrderedFilename,
  compareStructureImages,
  coordinatesToLocalMeters,
  headingToCardinal,
  parseSpatialHints,
  safeFileSegment,
  slugifyStructure,
  type StructureImageRecord,
  type StructureRecord,
} from "@/lib/structures/spatial";

const MAX_IMAGE_BYTES = 35 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const GENERATED_BUCKET = process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";

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

function sourceExtension(mimeType: string, fileName: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/jpeg") return fileName.toLowerCase().endsWith(".jpeg") ? "jpeg" : "jpg";
  return "bin";
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada para CLOUVA Cloud.");
  const bytes = await downloadStructureImage(image.public_url);
  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.CLOUVA_STRUCTURES_VISION_MODEL ?? "gemini-2.5-flash";

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
    "CLOUVA STRUCTURES — análisis de evidencia espacial.",
    "La imagen pertenece a un proyecto de reconstrucción de un lugar físico real.",
    "No diseñes ni inventes arquitectura. Analizá solamente lo visible.",
    "Los datos determinísticos suministrados tienen prioridad y NO deben ser reemplazados por inferencias.",
    "Nunca inventes latitud ni longitud. Nunca afirmes un rumbo exacto si no puede inferirse razonablemente.",
    "Describí superficies útiles para reconstrucción: fachadas, paredes, techo, piso, puertas, ventanas, rejas, calles, veredas, patio, habitaciones, pasillos, escaleras y landmarks.",
    "Si parece captura de Street View, satélite, foto común o screenshot, indicarlo.",
    "Si detectás una contradicción visual potencial con otras épocas (por ejemplo cercos/rejas nuevos), solo describí el elemento; no decidas qué época es correcta.",
    `Datos determinísticos: ${JSON.stringify(deterministic)}`,
    "Respondé EXCLUSIVAMENTE JSON con esta forma:",
    JSON.stringify({
      sourceType: "street_view | photo | satellite | screenshot | unknown",
      sceneType: "exterior | interior | aerial | context | unknown",
      sectorCandidate: "texto corto o null",
      camera: { heading: null, pitch: null, fovEstimate: null },
      visibleSurfaces: ["fachada", "muro"],
      landmarks: [{ type: "corner", description: "..." }],
      description: "descripción concreta de lo visible y su utilidad espacial",
      tags: ["..."],
      potentialConflicts: ["..."],
      confidence: 0.8,
    }),
  ].join("\n\n");

  const response = await ai.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: image.mime_type, data: bytes.toString("base64") } },
      ],
    }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const text = (response.text ?? "").trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
  if (!text) throw new Error("CLOUVA Cloud no devolvió análisis.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
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
}) {
  const topDescriptions = args.images
    .slice()
    .sort((a, b) =>
      Number(b.manual_verified) - Number(a.manual_verified)
      || b.priority - a.priority
      || (b.confidence ?? 0) - (a.confidence ?? 0),
    )
    .slice(0, 24)
    .map((image) => ({
      id: image.id,
      sector: image.sector,
      direction: image.cardinal_direction,
      description: image.description,
      surfaces: image.visible_surfaces ?? [],
      verified: image.manual_verified,
    }));

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
    evidenceSummary: topDescriptions,
  };
}

export function pickRenderReferences(
  images: StructureImageRecord[],
  view: "front" | "corner" | "environment" | "aerial_oblique",
  limit = 8,
) {
  const score = (image: StructureImageRecord) => {
    let value = image.priority * 4 + (image.confidence ?? 0) * 10;
    if (image.manual_verified) value += 30;
    if (image.duplicate_of) value -= 8;
    const sector = (image.sector ?? "").toLowerCase();
    const description = (image.description ?? "").toLowerCase();
    const aerial = image.source_type === "satellite" || image.scene_type === "aerial";

    if (view === "front" && /frente|fachada.?principal/.test(`${sector} ${description}`)) value += 35;
    if (view === "corner" && /esquina|noreste|noroeste|sudeste|sudoeste/.test(`${sector} ${description}`)) value += 35;
    if (view === "environment" && (/contexto|parque|calle|entorno|barrio/.test(`${sector} ${description}`) || aerial)) value += 28;
    if (view === "aerial_oblique" && aerial) value += 40;
    if (view !== "aerial_oblique" && aerial) value -= 5;
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
  referenceDescriptions: Array<{ id: string; description: string | null; sector: string | null; direction: string | null }>;
}) {
  const viewInstruction = {
    front: "front principal / fachada principal, cámara humana a nivel de calle",
    corner: "esquina arquitectónica que revele simultáneamente dos caras reales del lugar",
    environment: "vista abierta del edificio dentro de su entorno real, conservando calles, veredas, parque y relaciones espaciales",
    aerial_oblique: "vista superior oblicua realista tipo maqueta fotográfica, útil para entender huella, techo, patio y contexto",
  }[args.view];

  return [
    "CLOUVA STRUCTURES — RECONSTRUCCIÓN VISUAL.",
    "THIS IS A RECONSTRUCTION TASK, NOT A DESIGN TASK.",
    "Las imágenes adjuntas son evidencia del MISMO lugar físico. No son inspiración.",
    "No rediseñes el edificio. No agregues arquitectura decorativa. No sustituyas materiales o elementos por equivalentes genéricos.",
    "Mantené huella, posición de paredes, geometría de techo, aberturas, proporciones relativas, cercos/rejas, veredas, calles, patio y entorno según la evidencia.",
    "Las reglas históricas explícitas tienen prioridad sobre elementos modernos cuando haya conflicto.",
    "Cuando una zona no esté documentada, completala solo con continuidad geométrica mínima; no introduzcas rasgos nuevos.",
    "La imagen final debe parecer una fotografía adicional del MISMO lugar real.",
    `Vista solicitada: ${viewInstruction}.`,
    `STRUCTURE IDENTITY PACK:\n${JSON.stringify(args.identityPack)}`,
    `Referencias seleccionadas para esta cámara:\n${JSON.stringify(args.referenceDescriptions)}`,
    "Sin rótulos técnicos, sin textos explicativos, sin flechas, sin marcas de agua.",
  ].join("\n\n");
}

export function safeDownloadName(name: string) {
  return safeFileSegment(name, "estructura");
}
