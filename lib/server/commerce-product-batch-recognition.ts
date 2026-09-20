import "server-only";

import { downloadGeneratedMediaObject } from "@/lib/gcs-media";
import {
  generateGoogleCloudJson,
  GoogleCloudGenAIError,
} from "@/lib/server/google-cloud-genai";
import type { CommerceIdentifierType } from "@/lib/commerce/identifiers";

const MAX_BATCH_IMAGES = 80;
const GROUPING_CHUNK_SIZE = 16;

type StoredBatchImage = {
  sourceIndex: number;
  storagePath: string;
  mimeType: string;
};

export type CommerceBatchImageRole = {
  sourceIndex: number;
  role: "Frente" | "Atrás" | "Detalle";
};

export type CommerceBatchGroup = {
  groupKey: string;
  name: string;
  brand: string;
  model: string;
  identifier: { value: string; type: CommerceIdentifierType } | null;
  confidence: number;
  needsReview: boolean;
  images: CommerceBatchImageRole[];
};

const GROUP_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          groupKey: { type: "string" },
          name: { type: "string" },
          brand: { type: "string" },
          model: { type: "string" },
          identifierValue: { type: "string" },
          identifierType: {
            type: "string",
            enum: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku"],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needsReview: { type: "boolean" },
          images: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sourceIndex: { type: "integer" },
                role: { type: "string", enum: ["Frente", "Atrás", "Detalle"] },
              },
              required: ["sourceIndex", "role"],
            },
          },
        },
        required: [
          "groupKey", "name", "brand", "model", "identifierValue", "identifierType",
          "confidence", "needsReview", "images",
        ],
      },
    },
    unassignedIndexes: {
      type: "array",
      items: { type: "integer" },
    },
  },
  required: ["groups", "unassignedIndexes"],
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function number01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function normalizeIdentity(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mergeKey(group: CommerceBatchGroup) {
  const identifier = group.identifier?.value?.trim();
  if (identifier) return `code:${identifier.replace(/\s/g, "").toUpperCase()}`;
  const brand = normalizeIdentity(group.brand);
  const model = normalizeIdentity(group.model);
  const name = normalizeIdentity(group.name);
  if (brand && model) return `brand-model:${brand}:${model}`;
  if (brand && name.length >= 8) return `brand-name:${brand}:${name}`;
  return "";
}

function normalizeRoles(images: CommerceBatchImageRole[]) {
  const sorted = [...images].sort((a, b) => a.sourceIndex - b.sourceIndex);
  let frontUsed = false;
  let backUsed = false;
  return sorted.map((image) => {
    if (image.role === "Frente" && !frontUsed) {
      frontUsed = true;
      return image;
    }
    if (image.role === "Atrás" && !backUsed) {
      backUsed = true;
      return image;
    }
    return { ...image, role: "Detalle" as const };
  }).map((image, index, all) => {
    if (!frontUsed && index === 0) {
      frontUsed = true;
      return { ...image, role: "Frente" as const };
    }
    return image;
  });
}

function sanitizeGroup(raw: unknown, allowedIndexes: Set<number>, fallbackKey: string): CommerceBatchGroup | null {
  const item = record(raw);
  const rawImages = Array.isArray(item.images) ? item.images : [];
  const images = rawImages.flatMap((value) => {
    const image = record(value);
    const sourceIndex = Number(image.sourceIndex);
    const role = image.role === "Atrás" ? "Atrás" : image.role === "Detalle" ? "Detalle" : "Frente";
    if (!Number.isInteger(sourceIndex) || !allowedIndexes.has(sourceIndex)) return [];
    return [{ sourceIndex, role } satisfies CommerceBatchImageRole];
  });
  const uniqueImages = Array.from(new Map(images.map((image) => [image.sourceIndex, image])).values());
  if (!uniqueImages.length) return null;

  const identifierValue = text(item.identifierValue, 512);
  const identifierType = text(item.identifierType, 32) as CommerceIdentifierType;
  const supported = new Set<CommerceIdentifierType>([
    "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku",
  ]);

  return {
    groupKey: text(item.groupKey, 96) || fallbackKey,
    name: text(item.name, 180),
    brand: text(item.brand, 120),
    model: text(item.model, 120),
    identifier: identifierValue && supported.has(identifierType)
      ? { value: identifierValue, type: identifierType }
      : null,
    confidence: number01(item.confidence),
    needsReview: item.needsReview === true,
    images: normalizeRoles(uniqueImages),
  };
}

async function analyzeChunk(args: {
  images: StoredBatchImage[];
  spotName: string;
  chunkNumber: number;
}) {
  const downloaded = await Promise.all(args.images.map(async (image) => {
    const stored = await downloadGeneratedMediaObject(image.storagePath);
    const mimeType = stored.mimeType.startsWith("image/") ? stored.mimeType : image.mimeType;
    return {
      sourceIndex: image.sourceIndex,
      mimeType,
      data: stored.bytes.toString("base64"),
    };
  }));

  const prompt = [
    "Sos el agrupador visual de mercadería de CLOUVA.",
    `Contexto: carga masiva para el Spot "${args.spotName}" en Argentina.`,
    "Recibís varias fotos que pueden representar productos físicos distintos, o varias vistas del mismo producto.",
    `Los índices disponibles en este bloque son: ${downloaded.map((image) => image.sourceIndex).join(", ")}.`,
    "OBJETIVO: separar las fotos por producto físico/SKU exacto.",
    "Agrupá juntas las vistas del mismo artículo cuando packaging, marca, modelo, variante y/o código lo confirmen.",
    "NO agrupes artículos distintos solo porque sean de la misma marca o categoría.",
    "Si dos fotos muestran el mismo envase desde ángulos distintos, deben estar en el mismo grupo.",
    "Si un código EAN/UPC/barcode es legible, usalo como evidencia fuerte de identidad.",
    "Cada índice debe aparecer exactamente una vez: dentro de un grupo o en unassignedIndexes.",
    "Para cada grupo elegí exactamente una imagen como Frente. Elegí como máximo una Atrás cuando exista una vista posterior clara. El resto debe ser Detalle.",
    "name, brand y model deben salir solo de texto/evidencia visible. Dejalos vacíos si no están confirmados.",
    "identifierValue debe estar vacío salvo que el código completo sea inequívoco carácter por carácter.",
    "needsReview=true cuando el agrupamiento no sea suficientemente seguro.",
    "No inventes precio, costo, stock ni disponibilidad.",
  ].join("\n");

  const generated = await generateGoogleCloudJson({
    model: process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
      ?? process.env.GEMINI_PRODUCT_VISION_MODEL
      ?? "gemini-2.5-flash",
    prompt,
    referenceImages: downloaded.map((image) => ({ mimeType: image.mimeType, data: image.data })),
    responseJsonSchema: GROUP_SCHEMA,
    temperature: 0.05,
    maxOutputTokens: 3500,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(generated.text);
  } catch {
    throw new Error("Vertex AI devolvió un agrupamiento que no se pudo interpretar.");
  }

  const root = record(parsed);
  const allowed = new Set(args.images.map((image) => image.sourceIndex));
  const groups = (Array.isArray(root.groups) ? root.groups : [])
    .map((group, index) => sanitizeGroup(group, allowed, `chunk-${args.chunkNumber}-group-${index + 1}`))
    .filter((group): group is CommerceBatchGroup => Boolean(group));

  const assigned = new Set(groups.flatMap((group) => group.images.map((image) => image.sourceIndex)));
  const unassigned = new Set<number>();
  for (const value of Array.isArray(root.unassignedIndexes) ? root.unassignedIndexes : []) {
    const index = Number(value);
    if (Number.isInteger(index) && allowed.has(index) && !assigned.has(index)) unassigned.add(index);
  }
  for (const index of allowed) {
    if (!assigned.has(index)) unassigned.add(index);
  }

  for (const sourceIndex of unassigned) {
    groups.push({
      groupKey: `single-${sourceIndex}`,
      name: "",
      brand: "",
      model: "",
      identifier: null,
      confidence: 0,
      needsReview: true,
      images: [{ sourceIndex, role: "Frente" }],
    });
  }

  return groups;
}

function mergeGroups(groups: CommerceBatchGroup[]) {
  const merged: CommerceBatchGroup[] = [];
  const byKey = new Map<string, CommerceBatchGroup>();

  for (const group of groups) {
    const key = mergeKey(group);
    if (!key) {
      merged.push(group);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      const copy = { ...group, images: [...group.images] };
      byKey.set(key, copy);
      merged.push(copy);
      continue;
    }

    const imageMap = new Map(existing.images.map((image) => [image.sourceIndex, image]));
    for (const image of group.images) imageMap.set(image.sourceIndex, image);
    existing.images = normalizeRoles(Array.from(imageMap.values()));
    existing.name = existing.name || group.name;
    existing.brand = existing.brand || group.brand;
    existing.model = existing.model || group.model;
    existing.identifier = existing.identifier || group.identifier;
    existing.confidence = Math.min(existing.confidence, group.confidence);
    existing.needsReview = existing.needsReview || group.needsReview;
  }

  return merged.map((group, index) => ({
    ...group,
    groupKey: `product-${String(index + 1).padStart(3, "0")}`,
    images: normalizeRoles(group.images),
  }));
}

export async function analyzeCommerceProductBatch(args: {
  images: StoredBatchImage[];
  spotName: string;
}): Promise<CommerceBatchGroup[]> {
  if (!args.images.length) throw new Error("El lote no tiene imágenes.");
  if (args.images.length > MAX_BATCH_IMAGES) {
    throw new Error(`Podés procesar hasta ${MAX_BATCH_IMAGES} imágenes por lote.`);
  }

  const groups: CommerceBatchGroup[] = [];
  for (let offset = 0, chunkNumber = 1; offset < args.images.length; offset += GROUPING_CHUNK_SIZE, chunkNumber += 1) {
    const chunk = args.images.slice(offset, offset + GROUPING_CHUNK_SIZE);
    try {
      groups.push(...await analyzeChunk({ images: chunk, spotName: args.spotName, chunkNumber }));
    } catch (error) {
      if (error instanceof GoogleCloudGenAIError) throw error;
      throw error;
    }
  }

  return mergeGroups(groups);
}
