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
  unitCount: number;
  identifier: { value: string; type: CommerceIdentifierType } | null;
  visibleIdentifiers: CommerceBatchVisibleIdentifier[];
  confidence: number;
  needsReview: boolean;
  images: CommerceBatchImageRole[];
};

export type CommerceBatchAnalysisProgress = {
  stage: "grouping" | "consolidating" | "refining" | "done";
  completed: number;
  total: number;
  provisionalProducts: number;
  message: string;
  updatedAt: string;
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
          unitCount: { type: "integer", minimum: 1, maximum: 100 },
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
          "groupKey", "name", "brand", "model", "packageKind", "unitCount", "identifierValue", "identifierType",
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
    unitCount: Math.max(1, Math.min(100, Math.floor(Number(item.unitCount) || 1))),
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
    "OBJETIVO: separar las fotos por IDENTIDAD COMERCIAL exacta del producto/variante y reconocer sus cajas, unidades y códigos.",
    "Una caja, packaging retail o producto suelto puede ser el objeto principal del grupo. No descartes una caja por no mostrar el producto fuera del envase.",
    "Agrupá juntas TODAS las fotos del mismo producto/variante aunque sean frente, dorso, detalle o varias unidades idénticas.",
    "Si aparecen varias unidades físicas del mismo producto exacto, deben quedar en UN solo grupo y unitCount debe indicar cuántas unidades distintas hay.",
    "Varias fotos del mismo objeto físico siguen contando como UNA sola unidad. No sumes una unidad por foto.",
    "REGLA FUERTE: productos visualmente similares con códigos completos DISTINTOS son productos/variantes distintos. Nunca los fusiones.",
    "REGLA FUERTE: el mismo EAN/UPC/barcode repetido en varias cajas identifica la misma identidad comercial; agrupá esas cajas y contá sus unidades.",
    "Si una unidad no tiene código visible, igual puede agruparse con otra vista del mismo producto cuando marca, modelo, diseño, packaging y texto lo confirmen. No inventes un código.",
    "Si una foto muestra el frente y otra el dorso/barcode del mismo producto, deben quedar juntas.",
    "NO agrupes artículos distintos solo porque sean de la misma marca o categoría. Color, conector, capacidad, modelo o código distinto separan variantes.",
    "packageKind debe ser box para caja/cartón de mercadería, retail_package para blister/envase comercial, loose_product para producto suelto y unknown si no se puede determinar.",
    "unitCount es la cantidad de UNIDADES FÍSICAS del mismo producto que se ven representadas por ese grupo. Si una foto muestra 3 cajas iguales claramente separadas, unitCount=3. Si son varias fotos del mismo objeto o de las mismas 3 cajas, no sumes de nuevo. Si no podés contar con seguridad, usá 1 y needsReview=true.",
    "Leé TODOS los códigos visibles y completos en visibleIdentifiers. source=box si el código está impreso/pegado en la caja, product si está en el producto o su packaging directo.",
    "identifierValue/identifierType representan el código principal más confiable. Si no hay ninguno inequívoco, dejá identifierValue vacío.",
    "EAN/UPC requieren lectura completa. Para un barcode lineal alfanumérico claramente legible que no sea EAN/UPC, usá code_128.",
    "Cada índice debe aparecer exactamente una vez: dentro de un grupo o en unassignedIndexes.",
    "Usá unassignedIndexes SOLO para fotos de contexto general: mesa/caja con varios productos distintos mezclados, comprobantes, fotos borrosas o imágenes que no representan una sola identidad de producto. Esas fotos NO deben convertirse en un producto ficticio.",
    "Si una imagen muestra un solo producto pero no podés reconocer nombre/código, creá igualmente un grupo con campos vacíos y needsReview=true; no la mandes a unassignedIndexes.",
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
  const explicitContext = new Set<number>();
  for (const value of Array.isArray(root.unassignedIndexes) ? root.unassignedIndexes : []) {
    const index = Number(value);
    if (Number.isInteger(index) && allowed.has(index) && !assigned.has(index)) explicitContext.add(index);
  }

  // If the model simply forgot an index, keep it as a reviewable single item.
  // Explicit unassigned indexes are overview/context photos and must not inflate
  // the physical product count.
  for (const sourceIndex of allowed) {
    if (assigned.has(sourceIndex) || explicitContext.has(sourceIndex)) continue;
    groups.push({
      groupKey: `single-${sourceIndex}`,
      name: "",
      brand: "",
      model: "",
      packageKind: "unknown",
      unitCount: 1,
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
        unitCount: 1,
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

const CONSOLIDATION_SCHEMA = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          groupKeys: { type: "array", items: { type: "string" } },
          unitCount: { type: "integer", minimum: 1, maximum: 100 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needsReview: { type: "boolean" },
        },
        required: ["groupKeys", "unitCount", "confidence", "needsReview"],
      },
    },
  },
  required: ["clusters"],
} as const;

const REFINE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    brand: { type: "string" },
    model: { type: "string" },
    packageKind: { type: "string", enum: ["box", "retail_package", "loose_product", "unknown"] },
    unitCount: { type: "integer", minimum: 1, maximum: 100 },
    identifierValue: { type: "string" },
    identifierType: {
      type: "string",
      enum: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku"],
    },
    visibleIdentifiers: GROUP_SCHEMA.properties.groups.items.properties.visibleIdentifiers,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needsReview: { type: "boolean" },
    images: GROUP_SCHEMA.properties.groups.items.properties.images,
  },
  required: [
    "name", "brand", "model", "packageKind", "unitCount", "identifierValue", "identifierType",
    "visibleIdentifiers", "confidence", "needsReview", "images",
  ],
} as const;

function mergeClusterGroups(groups: CommerceBatchGroup[], unitCount: number, confidence: number, needsReview: boolean) {
  const coded = groups.find((group) => group.identifier);
  const preferred = coded ?? [...groups].sort((a, b) =>
    (b.name.length + b.brand.length + b.model.length) - (a.name.length + a.brand.length + a.model.length))[0];
  const imageMap = new Map<number, CommerceBatchImageRole>();
  for (const group of groups) for (const image of group.images) imageMap.set(image.sourceIndex, image);
  const codeMap = new Map<string, CommerceBatchVisibleIdentifier>();
  for (const group of groups) {
    for (const code of group.visibleIdentifiers) {
      codeMap.set(`${code.type}:${code.value.replace(/\s/g, "").toUpperCase()}`, code);
    }
  }
  return {
    groupKey: preferred.groupKey,
    name: preferred.name || groups.find((group) => group.name)?.name || "",
    brand: preferred.brand || groups.find((group) => group.brand)?.brand || "",
    model: preferred.model || groups.find((group) => group.model)?.model || "",
    packageKind: preferred.packageKind !== "unknown"
      ? preferred.packageKind
      : groups.find((group) => group.packageKind !== "unknown")?.packageKind ?? "unknown",
    unitCount: Math.max(1, Math.min(100, Math.floor(unitCount || 1))),
    identifier: coded?.identifier ?? null,
    visibleIdentifiers: Array.from(codeMap.values()),
    confidence: Math.min(number01(confidence), ...groups.map((group) => group.confidence)),
    needsReview: needsReview || groups.some((group) => group.needsReview),
    images: normalizeRoles(Array.from(imageMap.values())),
  } satisfies CommerceBatchGroup;
}

async function consolidateGroups(groups: CommerceBatchGroup[]) {
  if (groups.length <= 1) return groups;
  const prompt = [
    "Sos el consolidador de identidad de productos de CLOUVA.",
    "Recibís grupos preliminares creados por bloques de fotos. Algunos grupos separados son en realidad el MISMO producto/variante visto en fotos distintas.",
    "Tu tarea es devolver clusters de groupKeys que representan la misma identidad comercial exacta.",
    "Mismo producto exacto con mismo EAN/UPC/barcode: unilo, aunque sean varias unidades físicas.",
    "Frente y dorso del mismo packaging deben unirse aunque uno no tenga código visible.",
    "Marca + modelo + nombre equivalentes pueden confirmar identidad aun si una foto leyó un dato incompleto.",
    "NO unas códigos completos distintos. NO unas colores, conectores, capacidades o modelos distintos.",
    "unitCount es la mejor estimación de unidades físicas distintas representadas por TODO el cluster; no sumes fotos repetidas ni frente/dorso como unidades nuevas.",
    "Cada groupKey debe aparecer una sola vez. Si no hay evidencia suficiente, dejalo como cluster individual con needsReview=true.",
    JSON.stringify(groups.map((group) => ({
      groupKey: group.groupKey,
      name: group.name,
      brand: group.brand,
      model: group.model,
      packageKind: group.packageKind,
      unitCount: group.unitCount,
      identifier: group.identifier,
      visibleIdentifiers: group.visibleIdentifiers,
      sourceIndexes: group.images.map((image) => image.sourceIndex),
    }))),
  ].join("\n");

  try {
    const generated = await generateGoogleCloudJson({
      model: process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
        ?? process.env.GEMINI_PRODUCT_VISION_MODEL
        ?? "gemini-2.5-flash",
      prompt,
      responseJsonSchema: CONSOLIDATION_SCHEMA,
      temperature: 0,
      maxOutputTokens: 5000,
    });
    const root = record(parseGroupingJson(generated.text));
    const known = new Map(groups.map((group) => [group.groupKey, group]));
    const used = new Set<string>();
    const consolidated: CommerceBatchGroup[] = [];

    for (const raw of Array.isArray(root.clusters) ? root.clusters : []) {
      const cluster = record(raw);
      const keys = Array.isArray(cluster.groupKeys)
        ? cluster.groupKeys.filter((key): key is string => typeof key === "string" && known.has(key) && !used.has(key))
        : [];
      if (!keys.length) continue;
      const members = keys.map((key) => known.get(key)!).filter(Boolean);
      const distinctCodes = new Set(
        members.flatMap((group) => group.identifier ? [`${group.identifier.type}:${group.identifier.value.replace(/\s/g, "").toUpperCase()}`] : []),
      );
      // Conflicting validated codes always win over semantic similarity.
      if (distinctCodes.size > 1) {
        for (const member of members) {
          used.add(member.groupKey);
          consolidated.push(member);
        }
        continue;
      }
      keys.forEach((key) => used.add(key));
      consolidated.push(mergeClusterGroups(
        members,
        Number(cluster.unitCount) || Math.max(...members.map((group) => group.unitCount)),
        number01(cluster.confidence),
        cluster.needsReview === true,
      ));
    }

    for (const group of groups) if (!used.has(group.groupKey)) consolidated.push(group);
    return consolidated;
  } catch {
    return groups;
  }
}

async function refineMergedGroup(args: {
  group: CommerceBatchGroup;
  imagesByIndex: Map<number, StoredBatchImage>;
  spotName: string;
}) {
  if (args.group.images.length <= 1 || args.group.images.length > 16) return args.group;
  try {
    const refs = await Promise.all(args.group.images.map(async (image) => {
      const source = args.imagesByIndex.get(image.sourceIndex);
      if (!source) throw new Error("Imagen de lote inexistente.");
      const stored = await downloadGeneratedMediaObject(source.storagePath);
      return {
        sourceIndex: image.sourceIndex,
        mimeType: stored.mimeType.startsWith("image/") ? stored.mimeType : source.mimeType,
        data: stored.bytes.toString("base64"),
      };
    }));
    const prompt = [
      "Sos el verificador visual final de una identidad de producto de CLOUVA.",
      `Spot: "${args.spotName}".`,
      "Todas estas fotos fueron propuestas como el mismo producto/variante. Confirmá la identidad y contá unidades físicas sin duplicar vistas.",
      "Frente, dorso y detalle del mismo objeto cuentan como UNA unidad.",
      "Si se ven varias cajas/unidades idénticas, contalas una sola vez cada una aunque aparezcan repetidas en otras fotos.",
      "Si descubrís códigos completos distintos o una variante claramente diferente, marcá needsReview=true; no inventes datos.",
      `Índices: ${refs.map((ref) => ref.sourceIndex).join(", ")}.`,
    ].join("\n");
    const generated = await generateGoogleCloudJson({
      model: process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
        ?? process.env.GEMINI_PRODUCT_VISION_MODEL
        ?? "gemini-2.5-flash",
      prompt,
      referenceImages: refs.map((ref) => ({ mimeType: ref.mimeType, data: ref.data })),
      responseJsonSchema: REFINE_SCHEMA,
      temperature: 0,
      maxOutputTokens: 2600,
    });
    const allowed = new Set(args.group.images.map((image) => image.sourceIndex));
    const sanitized = sanitizeGroup({
      ...record(parseGroupingJson(generated.text)),
      groupKey: args.group.groupKey,
    }, allowed, args.group.groupKey);
    if (!sanitized) return args.group;
    const oldCode = args.group.identifier;
    if (oldCode && sanitized.identifier
      && `${oldCode.type}:${oldCode.value.replace(/\s/g, "").toUpperCase()}`
        !== `${sanitized.identifier.type}:${sanitized.identifier.value.replace(/\s/g, "").toUpperCase()}`) {
      return { ...args.group, needsReview: true };
    }
    return {
      ...sanitized,
      groupKey: args.group.groupKey,
      visibleIdentifiers: sanitized.visibleIdentifiers.length ? sanitized.visibleIdentifiers : args.group.visibleIdentifiers,
      identifier: sanitized.identifier ?? args.group.identifier,
      needsReview: sanitized.needsReview || args.group.needsReview,
    };
  } catch {
    return { ...args.group, needsReview: true };
  }
}

export async function analyzeCommerceProductBatch(args: {
  images: StoredBatchImage[];
  spotName: string;
  onProgress?: (progress: CommerceBatchAnalysisProgress) => void | Promise<void>;
}): Promise<CommerceBatchGroup[]> {
  if (!args.images.length) throw new Error("El lote no tiene imágenes.");
  if (args.images.length > MAX_BATCH_IMAGES) {
    throw new Error(`Podés procesar hasta ${MAX_BATCH_IMAGES} imágenes por lote.`);
  }

  const groups: CommerceBatchGroup[] = [];
  const totalChunks = Math.max(1, Math.ceil(args.images.length / GROUPING_CHUNK_SIZE));
  let completedChunks = 0;
  for (let offset = 0, chunkNumber = 1; offset < args.images.length; offset += GROUPING_CHUNK_SIZE, chunkNumber += 1) {
    const chunk = args.images.slice(offset, offset + GROUPING_CHUNK_SIZE);
    groups.push(...await analyzeChunkWithFallback({
      images: chunk,
      spotName: args.spotName,
      chunkNumber,
    }));
    completedChunks += 1;
    await args.onProgress?.({
      stage: "grouping",
      completed: completedChunks,
      total: totalChunks,
      provisionalProducts: groups.length,
      message: `Separando fotos · bloque ${completedChunks}/${totalChunks}`,
      updatedAt: new Date().toISOString(),
    });
  }

  await args.onProgress?.({
    stage: "consolidating",
    completed: 0,
    total: 1,
    provisionalProducts: groups.length,
    message: "Uniendo vistas repetidas y productos iguales…",
    updatedAt: new Date().toISOString(),
  });
  const consolidated = await consolidateGroups(groups);
  await args.onProgress?.({
    stage: "consolidating",
    completed: 1,
    total: 1,
    provisionalProducts: consolidated.length,
    message: `${consolidated.length} grupos candidatos · verificando unidades…`,
    updatedAt: new Date().toISOString(),
  });

  const imagesByIndex = new Map(args.images.map((image) => [image.sourceIndex, image]));
  const refined: CommerceBatchGroup[] = [];
  for (let index = 0; index < consolidated.length; index += 1) {
    const group = consolidated[index];
    refined.push(await refineMergedGroup({ group, imagesByIndex, spotName: args.spotName }));
    await args.onProgress?.({
      stage: "refining",
      completed: index + 1,
      total: consolidated.length,
      provisionalProducts: refined.length,
      message: `Verificando producto ${index + 1}/${consolidated.length}`,
      updatedAt: new Date().toISOString(),
    });
  }

  const result = refined.map((group, index) => ({
    ...group,
    groupKey: `product-${String(index + 1).padStart(3, "0")}`,
    images: normalizeRoles(group.images),
  }));
  await args.onProgress?.({
    stage: "done",
    completed: result.length,
    total: result.length,
    provisionalProducts: result.length,
    message: `${result.length} productos listos para comparar con la factura`,
    updatedAt: new Date().toISOString(),
  });
  return result;
}
