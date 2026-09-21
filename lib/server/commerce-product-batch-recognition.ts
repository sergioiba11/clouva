import "server-only";

import { downloadGeneratedMediaObject } from "@/lib/gcs-media";
import {
  generateGoogleCloudJson,
  GoogleCloudGenAIError,
} from "@/lib/server/google-cloud-genai";
import { validateCommerceIdentifier, type CommerceIdentifierType } from "@/lib/commerce/identifiers";

const MAX_BATCH_IMAGES = 80;
const GROUPING_CHUNK_SIZE = 8;

type StoredBatchImage = {
  sourceIndex: number;
  storagePath: string;
  mimeType: string;
};

class CommerceBatchGroupingParseError extends Error {
  constructor(message = "Vertex AI devolvió un agrupamiento que no se pudo interpretar.") {
    super(message);
    this.name = "CommerceBatchGroupingParseError";
  }
}

function parseGroupingJson(value: string) {
  const trimmed = value.trim();
  const unfenced = trimmed
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    const firstObject = unfenced.indexOf("{");
    const lastObject = unfenced.lastIndexOf("}");
    if (firstObject >= 0 && lastObject > firstObject) {
      try {
        return JSON.parse(unfenced.slice(firstObject, lastObject + 1)) as unknown;
      } catch {}
    }
    throw new CommerceBatchGroupingParseError();
  }
}

export type CommerceBatchImageRole = {
  sourceIndex: number;
  role: "Frente" | "Atrás" | "Detalle";
};

export type CommerceBatchVisibleIdentifier = {
  value: string;
  type: CommerceIdentifierType;
  source: "box" | "product" | "unknown";
  confidence: number;
};

export type CommerceBatchGroup = {
  groupKey: string;
  name: string;
  brand: string;
  model: string;
  packageKind: "box" | "retail_package" | "loose_product" | "unknown";
  identifier: { value: string; type: CommerceIdentifierType } | null;
  visibleIdentifiers: CommerceBatchVisibleIdentifier[];
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
          packageKind: {
            type: "string",
            enum: ["box", "retail_package", "loose_product", "unknown"],
          },
          identifierValue: { type: "string" },
          identifierType: {
            type: "string",
            enum: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku"],
          },
          visibleIdentifiers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: { type: "string" },
                type: {
                  type: "string",
                  enum: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku"],
                },
                source: { type: "string", enum: ["box", "product", "unknown"] },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["value", "type", "source", "confidence"],
            },
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
          "groupKey", "name", "brand", "model", "packageKind", "identifierValue", "identifierType",
          "visibleIdentifiers", "confidence", "needsReview", "images",
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
  // En carga masiva, un código exacto sí puede unir fotos del mismo objeto entre chunks.
  // Sin código no fusionamos por apariencia/nombre: dos cajas iguales pueden ser unidades físicas distintas.
  return identifier ? `code:${identifier.replace(/\s/g, "").toUpperCase()}` : "";
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
  const visibleIdentifiers = (Array.isArray(item.visibleIdentifiers) ? item.visibleIdentifiers : []).flatMap((raw) => {
    const code = record(raw);
    const value = text(code.value, 512);
    const type = text(code.type, 32) as CommerceIdentifierType;
    if (!value || !supported.has(type)) return [];
    const source = code.source === "box" ? "box" : code.source === "product" ? "product" : "unknown";
    return [{
      value,
      type,
      source,
      confidence: number01(code.confidence),
    } satisfies CommerceBatchVisibleIdentifier];
  });
  const primaryCandidate = identifierValue && supported.has(identifierType)
    ? { value: identifierValue, type: identifierType }
    : visibleIdentifiers[0]
      ? { value: visibleIdentifiers[0].value, type: visibleIdentifiers[0].type }
      : null;
  const primary = primaryCandidate
    ? (() => {
        const validation = validateCommerceIdentifier(primaryCandidate.type, primaryCandidate.value);
        return validation.valid ? { value: validation.value, type: primaryCandidate.type } : null;
      })()
    : null;
  const packageKind = item.packageKind === "box"
    ? "box"
    : item.packageKind === "retail_package"
      ? "retail_package"
      : item.packageKind === "loose_product"
        ? "loose_product"
        : "unknown";

  return {
    groupKey: text(item.groupKey, 96) || fallbackKey,
    name: text(item.name, 180),
    brand: text(item.brand, 120),
    model: text(item.model, 120),
    packageKind,
    identifier: primary,
    visibleIdentifiers,
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
    "OBJETIVO: separar las fotos por unidad física/producto exacto y reconocer también sus cajas y códigos.",
    "Una caja, packaging retail o producto suelto puede ser el objeto principal del grupo. No descartes una caja por no mostrar el producto fuera del envase.",
    "Agrupá juntas las vistas del MISMO objeto físico cuando packaging, marcas, daños, etiquetas, fondo, modelo y/o código lo confirmen.",
    "REGLA FUERTE: dos cajas o productos visualmente iguales con códigos completos distintos son DOS grupos distintos. Nunca los fusiones.",
    "REGLA FUERTE: si una unidad no tiene código visible, igual debe tener su propio grupo; no inventes un código.",
    "Si hay varias cajas iguales sin código, mantenelas separadas salvo que la evidencia visual demuestre que son fotos del mismo objeto físico.",
    "Si una foto muestra el frente de una caja y otra su etiqueta/barcode, agrupá ambas solo cuando correspondan a la misma caja.",
    "NO agrupes artículos distintos solo porque sean de la misma marca, modelo o categoría.",
    "packageKind debe ser box para caja/cartón de mercadería, retail_package para blister/envase comercial, loose_product para producto suelto y unknown si no se puede determinar.",
    "Leé TODOS los códigos visibles y completos en visibleIdentifiers. source=box si el código está impreso/pegado en la caja, product si está en el producto o su packaging directo.",
    "identifierValue/identifierType representan el código principal más confiable. Si no hay ninguno inequívoco, dejá identifierValue vacío.",
    "EAN/UPC requieren lectura completa. Para un barcode lineal alfanumérico claramente legible que no sea EAN/UPC, usá code_128.",
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
    maxOutputTokens: 6000,
  });

  const parsed = parseGroupingJson(generated.text);

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
      packageKind: "unknown",
      identifier: null,
      visibleIdentifiers: [],
      confidence: 0,
      needsReview: true,
      images: [{ sourceIndex, role: "Frente" }],
    });
  }

  return groups;
}

async function analyzeChunkWithFallback(args: {
  images: StoredBatchImage[];
  spotName: string;
  chunkNumber: number;
}): Promise<CommerceBatchGroup[]> {
  try {
    return await analyzeChunk(args);
  } catch (error) {
    if (error instanceof GoogleCloudGenAIError) throw error;

    // Structured output can still be truncated by the model on visually dense
    // batches. Split only the failing chunk instead of aborting the whole import.
    if (error instanceof CommerceBatchGroupingParseError && args.images.length > 2) {
      const middle = Math.ceil(args.images.length / 2);
      const left = args.images.slice(0, middle);
      const right = args.images.slice(middle);
      const [leftGroups, rightGroups] = await Promise.all([
        analyzeChunkWithFallback({
          images: left,
          spotName: args.spotName,
          chunkNumber: args.chunkNumber * 10 + 1,
        }),
        analyzeChunkWithFallback({
          images: right,
          spotName: args.spotName,
          chunkNumber: args.chunkNumber * 10 + 2,
        }),
      ]);
      return [...leftGroups, ...rightGroups];
    }

    // Never lose an entire 60+ photo batch because structured grouping failed
    // for one tiny fragment. Canonical per-product recognition still runs later.
    if (error instanceof CommerceBatchGroupingParseError) {
      return args.images.map((image) => ({
        groupKey: `single-${image.sourceIndex}`,
        name: "",
        brand: "",
        model: "",
        packageKind: "unknown" as const,
        identifier: null,
        visibleIdentifiers: [],
        confidence: 0,
        needsReview: true,
        images: [{ sourceIndex: image.sourceIndex, role: "Frente" as const }],
      }));
    }

    throw error;
  }
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
    existing.packageKind = existing.packageKind !== "unknown" ? existing.packageKind : group.packageKind;
    existing.identifier = existing.identifier || group.identifier;
    const codeMap = new Map(
      [...existing.visibleIdentifiers, ...group.visibleIdentifiers]
        .map((code) => [`${code.type}:${code.value.replace(/\s/g, "").toUpperCase()}`, code] as const),
    );
    existing.visibleIdentifiers = Array.from(codeMap.values());
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
    groups.push(...await analyzeChunkWithFallback({
      images: chunk,
      spotName: args.spotName,
      chunkNumber,
    }));
  }

  return mergeGroups(groups);
}
