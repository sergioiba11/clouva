import "server-only";

import sharp from "sharp";
import {
  computeEvidenceCoverage,
  safeFileSegment,
  sectorFolder,
  type StructureCameraNodeRecord,
  type StructureImageRecord,
  type StructureRecord,
  type StructureRuleRecord,
  type StructureSurfaceRecord,
} from "@/lib/structures/spatial";
import { buildZip } from "@/lib/structures/zip";

function jsonBytes(value: unknown) {
  return Buffer.from(JSON.stringify(value, null, 2), "utf8");
}

function textBytes(value: string) {
  return Buffer.from(value, "utf8");
}

function csvCell(value: unknown) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildManifestCsv(images: StructureImageRecord[]) {
  const columns = [
    "id", "ordered_filename", "original_filename", "original_path", "latitude", "longitude",
    "altitude", "heading", "cardinal_direction", "pitch", "fov", "local_x", "local_y", "local_z",
    "source_type", "scene_type", "sector", "description", "visible_surfaces", "tags",
    "confidence", "priority", "manual_verified", "spatial_source", "placement_status", "duplicate_of", "analysis_status", "storage_path",
  ] as const;
  return [
    columns.join(","),
    ...images.map((image) => columns.map((column) => csvCell(image[column])).join(",")),
  ].join("\n");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function buildContactSheets(args: {
  images: StructureImageRecord[];
  bytesByImageId: Map<string, Buffer>;
}) {
  const perSheet = 20;
  const columns = 4;
  const rows = 5;
  const cellWidth = 320;
  const cellHeight = 235;
  const thumbWidth = 300;
  const thumbHeight = 178;
  const canvasWidth = columns * cellWidth;
  const canvasHeight = rows * cellHeight;
  const sheets: Buffer[] = [];

  for (let start = 0; start < args.images.length; start += perSheet) {
    const page = args.images.slice(start, start + perSheet);
    const composites: Array<{ input: Buffer; left: number; top: number }> = [];

    for (let index = 0; index < page.length; index += 1) {
      const image = page[index];
      const bytes = args.bytesByImageId.get(image.id);
      if (!bytes) continue;
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = col * cellWidth + 10;
      const y = row * cellHeight + 10;
      const thumb = await sharp(bytes)
        .rotate()
        .resize(thumbWidth, thumbHeight, { fit: "cover", position: "centre" })
        .jpeg({ quality: 78 })
        .toBuffer();
      composites.push({ input: thumb, left: x, top: y });

      const label = [
        image.ordered_filename?.split("__").at(0) ?? `IMG${start + index + 1}`,
        image.cardinal_direction ?? "SIN RUMBO",
        image.sector ?? image.scene_type ?? "sin sector",
      ].join(" · ").slice(0, 58);
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${thumbWidth}" height="38">
          <rect width="100%" height="100%" fill="#09070d"/>
          <text x="8" y="16" fill="#ffffff" font-size="12" font-family="Arial, sans-serif">${escapeXml(label)}</text>
          <text x="8" y="31" fill="#b8a9cc" font-size="10" font-family="Arial, sans-serif">${escapeXml((image.description ?? "").slice(0, 62))}</text>
        </svg>`,
      );
      composites.push({ input: svg, left: x, top: y + thumbHeight });
    }

    const sheet = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 3,
        background: "#05030a",
      },
    })
      .composite(composites)
      .jpeg({ quality: 86 })
      .toBuffer();
    sheets.push(sheet);
  }
  return sheets;
}

export function buildGeoJson(cameras: StructureCameraNodeRecord[], images: StructureImageRecord[]) {
  const byId = new Map(images.map((image) => [image.id, image]));
  return {
    type: "FeatureCollection",
    features: cameras
      .filter((camera) => camera.latitude != null && camera.longitude != null)
      .map((camera) => {
        const image = byId.get(camera.image_id);
        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [camera.longitude, camera.latitude, camera.altitude ?? 0],
          },
          properties: {
            imageId: camera.image_id,
            filename: image?.ordered_filename ?? image?.original_filename ?? null,
            heading: camera.heading,
            pitch: camera.pitch,
            fov: camera.fov,
            sector: image?.sector ?? null,
            description: image?.description ?? null,
            confidence: camera.confidence,
            spatialSource: image?.spatial_source ?? camera.spatial_source ?? null,
            placementStatus: image?.placement_status ?? null,
          },
        };
      }),
  };
}

export async function buildStructureExportZip(args: {
  structure: StructureRecord;
  images: StructureImageRecord[];
  surfaces: StructureSurfaceRecord[];
  cameras: StructureCameraNodeRecord[];
  rules: StructureRuleRecord[];
  links: Array<Record<string, unknown>>;
  bytesByImageId: Map<string, Buffer>;
}) {
  const activeRules = [
    ...((Array.isArray(args.structure.reconstruction_rules) ? args.structure.reconstruction_rules : []) as string[]),
    ...args.rules.filter((rule) => rule.active).map((rule) => rule.rule),
  ].filter((value, index, all) => value && all.indexOf(value) === index);

  const conflicts = args.images.flatMap((image) => {
    const analysis = image.analysis && typeof image.analysis === "object" ? image.analysis : {};
    const raw = (analysis as Record<string, unknown>).potentialConflicts;
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === "string").map((message) => ({ imageId: image.id, message }))
      : [];
  });

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: {
      id: args.structure.id,
      name: args.structure.name,
      type: args.structure.structure_type,
      description: args.structure.description,
      locationName: args.structure.location_name,
      historicalNotes: args.structure.historical_notes,
      blockout: args.structure.blockout ?? {},
    },
    origin: {
      latitude: args.structure.origin_latitude,
      longitude: args.structure.origin_longitude,
    },
    rules: activeRules,
    surfaces: args.surfaces,
    cameraNodes: args.cameras,
    images: args.images,
    relationships: args.links,
    coverage: computeEvidenceCoverage(args.images),
    conflicts,
  };

  const root = `${safeFileSegment(args.structure.name, "Proyecto")}_BASE_3D`;
  const entries: Array<{ name: string; bytes: Buffer }> = [];
  const control = `${root}/00_CONTROL_E_INDICES`;

  entries.push(
    { name: `${control}/MANIFEST_BASE_3D.json`, bytes: jsonBytes(manifest) },
    { name: `${control}/MANIFEST_BASE_3D.csv`, bytes: textBytes(buildManifestCsv(args.images)) },
    { name: `${control}/PUNTOS_CAMARA.geojson`, bytes: jsonBytes(buildGeoJson(args.cameras, args.images)) },
    {
      name: `${control}/REGLAS_RECONSTRUCCION.txt`,
      bytes: textBytes(activeRules.length ? activeRules.map((rule, index) => `${index + 1}. ${rule}`).join("\n") : "Sin reglas de reconstrucción explícitas."),
    },
  );

  const duplicates = args.images.filter((image) => image.duplicate_of);
  entries.push({
    name: `${control}/DUPLICADOS_EXACTOS.txt`,
    bytes: textBytes(
      duplicates.length
        ? duplicates.map((image) => `${image.ordered_filename ?? image.original_filename} -> ${image.duplicate_of}`).join("\n")
        : "No se detectaron duplicados exactos por SHA-256.",
    ),
  });

  const sectorCounts = new Map<string, number>();
  for (const image of args.images) {
    const folder = sectorFolder(image);
    sectorCounts.set(folder, (sectorCounts.get(folder) ?? 0) + 1);
  }
  entries.push({
    name: `${control}/RESUMEN_SECTORES.txt`,
    bytes: textBytes([...sectorCounts.entries()].sort().map(([sector, count]) => `${sector}: ${count}`).join("\n")),
  });

  entries.push({
    name: `${control}/LEEME_PRIMERO_BASE_3D.txt`,
    bytes: textBytes([
      `CLOUVA STRUCTURES — ${args.structure.name}`,
      "",
      "Esta base trata cada imagen como evidencia espacial.",
      "El orden NS prioriza cámaras de norte a sur cuando existen coordenadas reales.",
      "Los datos manualmente verificados tienen prioridad sobre la inferencia visual.",
      "No se inventan coordenadas faltantes.",
      "",
      "Reglas activas:",
      ...(activeRules.length ? activeRules.map((rule) => `- ${rule}`) : ["- Sin reglas explícitas."]),
      "",
      "Archivos principales:",
      "- MANIFEST_BASE_3D.json: grafo y metadatos completos.",
      "- MANIFEST_BASE_3D.csv: índice tabular de imágenes.",
      "- PUNTOS_CAMARA.geojson: cámaras con coordenadas disponibles.",
      "- CONTACT_SHEET_###.jpg: índice visual.",
    ].join("\n")),
  });

  const sheets = await buildContactSheets({ images: args.images, bytesByImageId: args.bytesByImageId });
  sheets.forEach((sheet, index) => {
    entries.push({
      name: `${control}/CONTACT_SHEET_${String(index + 1).padStart(3, "0")}.jpg`,
      bytes: sheet,
    });
  });

  for (const image of args.images) {
    const bytes = args.bytesByImageId.get(image.id);
    if (!bytes) continue;
    entries.push({
      name: `${root}/${sectorFolder(image)}/${image.ordered_filename ?? image.original_filename}`,
      bytes,
    });
  }

  return {
    fileName: `${root}.zip`,
    zip: buildZip(entries),
    manifest,
  };
}
