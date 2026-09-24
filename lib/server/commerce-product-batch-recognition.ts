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
  sourceIndex?: number;
};

export type CommerceBatchExpectedProduct = {
  description: string;
  brand?: string;
  model?: string;
  supplierSku?: string;
  quantity: number;
};

export type CommerceBatchContextReference = {
  sourceIndex: number;
  label: string;
  confidence: number;
};

export type CommerceBatchContextMatch = {
  groupKey: string;
  label: string;
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
  contextOnly?: boolean;
  observedProducts?: string[];
  contextReason?: string;
  contextReferences?: CommerceBatchContextReference[];
  contextMatches?: CommerceBatchContextMatch[];
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
                sourceIndex: { type: "integer" },
              },
              required: ["value", "type", "source", "confidence", "sourceIndex"],
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
    const sourceIndex = Number(code.sourceIndex);
    return [{
      value,
      type,
      source,
      confidence: number01(code.confidence),
      ...(Number.isInteger(sourceIndex) && allowedIndexes.has(sourceIndex) ? { sourceIndex } : {}),
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

function enforceUniqueImageAssignments(groups: CommerceBatchGroup[]) {
  const claims = new Map<number, Array<{ groupIndex: number; image: CommerceBatchImageRole }>>();
  groups.forEach((group, groupIndex) => {
    for (const image of group.images) {
      claims.set(image.sourceIndex, [...(claims.get(image.sourceIndex) ?? []), { groupIndex, image }]);
    }
  });

  const winners = new Map<number, number>();
  const ambiguousIndexes = new Set<number>();
  for (const [sourceIndex, sourceClaims] of claims) {
    if (sourceClaims.length === 1) {
      winners.set(sourceIndex, sourceClaims[0].groupIndex);
      continue;
    }
    if (sourceClaims.length >= 3) ambiguousIndexes.add(sourceIndex);
    const ranked = [...sourceClaims].sort((a, b) => {
      const left = groups[a.groupIndex];
      const right = groups[b.groupIndex];
      const score = (group: CommerceBatchGroup, image: CommerceBatchImageRole) =>
        (group.identifier ? 2 : 0)
        + (group.needsReview ? 0 : 1)
        + group.confidence
        + (image.role === "Frente" ? 0.15 : 0);
      return score(right, b.image) - score(left, a.image);
    });
    winners.set(sourceIndex, ranked[0].groupIndex);
  }

  const cleaned = groups.flatMap((group, groupIndex) => {
    const images = group.images.filter((image) => winners.get(image.sourceIndex) === groupIndex);
    if (!images.length) return [];
    return [{
      ...group,
      images: normalizeRoles(images),
      needsReview: group.needsReview
        || images.length !== group.images.length
        || images.some((image) => ambiguousIndexes.has(image.sourceIndex)),
    }];
  });

  return { groups: cleaned, ambiguousIndexes };
}


async function recoverExplicitUnassignedImages(args: {
  images: StoredBatchImage[];
  spotName: string;
  chunkNumber: number;
}): Promise<CommerceBatchGroup[]> {
  if (!args.images.length) return [];
  // Re-check each rejected photo by itself. When several rejected images are
  // sent together, a true back/label photo can be mistaken for a mixed scene
  // because another image in the same recovery batch contains many products.
  if (args.images.length > 1) {
    const recovered: CommerceBatchGroup[] = [];
    for (let index = 0; index < args.images.length; index += 1) {
      recovered.push(...await recoverExplicitUnassignedImages({
        images: [args.images[index]],
        spotName: args.spotName,
        chunkNumber: args.chunkNumber * 100 + index + 1,
      }));
    }
    return recovered;
  }
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
    "Sos el segundo pase visual de CLOUVA para fotos que un primer análisis marcó como contexto.",
    "Revisá cada imagen otra vez de forma conservadora: muchas veces un frente, dorso, código o detalle real fue descartado por error.",
    `Spot: "${args.spotName}". Índices: ${downloaded.map((image) => image.sourceIndex).join(", ")}.`,
    "Si una imagen muestra UNA identidad de producto reconocible (producto, caja, blister, frente, dorso, etiqueta o código), DEBE quedar dentro de un grupo.",
    "REGLA FUERTE: el DORSO de una caja, blister o packaging es una vista del producto, NO contexto. Aunque no se vea el frente, usá marca, modelo, plataforma, conector, potencia, SKU, textos y códigos para conservarlo como producto.",
    "REGLA DE SUJETO PRINCIPAL: que haya otros productos atrás NO vuelve la foto mixta. Si una caja/producto está sostenida con la mano, centrada, ocupa gran parte del cuadro, está enfocada o es claramente el objetivo de la foto, esa imagen pertenece a ESE producto y lo demás es fondo.",
    "Ejemplo: frente 'Cable USB para PS4' y dorso 'USB Cable / for PS4' son la misma identidad comercial salvo evidencia concreta de otra variante.",
    "Usá contextObservations SOLO para una vista general/panorámica donde varios productos distintos sean co-protagonistas y NO exista un producto principal claro.",
    "Para cada foto mixta, observedProducts debe enumerar TODO lo que realmente se ve y se puede nombrar, como una lista corta de productos/variantes visibles. No inventes.",
    "Si una foto mixta contiene objetos que también aparecen solos en otras fotos, la foto mixta sigue siendo SOLO contexto; las fotos individuales sí deben quedar agrupadas con la identidad comercial que les corresponde.",
    "Comprobantes o imágenes inutilizables también van a contextObservations, con observedProducts vacío y reason explicando por qué.",
    "Varias vistas del mismo producto exacto deben quedar juntas. La cantidad de fotos nunca determina unitCount.",
    "Si no podés demostrar más de una unidad física distinta, unitCount=1.",
    "No inventes marca, modelo ni código. Código completo distinto = variante distinta.",
    "Cada índice debe aparecer exactamente una vez: dentro de group.images o como sourceIndex de contextObservations.",
    "Elegí un Frente por grupo, máximo una Atrás, y el resto Detalle.",
  ].join("\n");

  try {
    const generated = await generateGoogleCloudJson({
      model: process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
        ?? process.env.GEMINI_PRODUCT_VISION_MODEL
        ?? "gemini-2.5-flash",
      prompt,
      referenceImages: downloaded.map((image) => ({ mimeType: image.mimeType, data: image.data })),
      responseJsonSchema: RECOVERY_SCHEMA,
      temperature: 0,
      maxOutputTokens: 4200,
    });
    const root = record(parseGroupingJson(generated.text));
    const allowed = new Set(args.images.map((image) => image.sourceIndex));
    const parsedGroups = (Array.isArray(root.groups) ? root.groups : [])
      .map((group, index) => sanitizeGroup(group, allowed, `recovery-${args.chunkNumber}-group-${index + 1}`))
      .filter((group): group is CommerceBatchGroup => Boolean(group));
    const unique = enforceUniqueImageAssignments(parsedGroups);
    const groups = unique.groups;
    const assigned = new Set(groups.flatMap((group) => group.images.map((image) => image.sourceIndex)));
    const contextIndexes = new Set<number>();

    for (const rawObservation of Array.isArray(root.contextObservations) ? root.contextObservations : []) {
      const observation = record(rawObservation);
      const sourceIndex = Number(observation.sourceIndex);
      if (!Number.isInteger(sourceIndex) || !allowed.has(sourceIndex) || assigned.has(sourceIndex) || contextIndexes.has(sourceIndex)) continue;
      const observedProducts = (Array.isArray(observation.observedProducts) ? observation.observedProducts : [])
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().slice(0, 120))
        .slice(0, 20);
      contextIndexes.add(sourceIndex);
      groups.push({
        groupKey: `context-recovery-${sourceIndex}`,
        name: "",
        brand: "",
        model: "",
        packageKind: "unknown",
        unitCount: 1,
        identifier: null,
        visibleIdentifiers: [],
        confidence: 1,
        needsReview: false,
        images: [{ sourceIndex, role: "Frente" }],
        contextOnly: true,
        observedProducts,
        contextReason: text(observation.reason, 240) || "Foto con varios productos distintos.",
      });
    }

    // Never silently lose a photo because the recovery model omitted it.
    for (const sourceIndex of allowed) {
      if (assigned.has(sourceIndex) || contextIndexes.has(sourceIndex)) continue;
      groups.push({
        groupKey: `recovered-single-${sourceIndex}`,
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
  } catch {
    // A recovery failure must preserve evidence instead of throwing away a
    // potentially real product photo.
    return args.images.map((image) => ({
      groupKey: `recovered-single-${image.sourceIndex}`,
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
    "unitCount es la cantidad de UNIDADES FÍSICAS del mismo producto que se ven representadas por ese grupo. Si una foto muestra 3 cajas iguales claramente separadas, unitCount=3. Si son varias fotos del mismo objeto o de las mismas 3 cajas, no sumes de nuevo. La cantidad de imágenes NO es evidencia de cantidad: si no podés demostrar que son unidades distintas, usá 1 y needsReview=true.",
    "Leé TODOS los códigos visibles y completos en visibleIdentifiers. source=box si el código está impreso/pegado en la caja, product si está en el producto o su packaging directo.",
    "En cada visibleIdentifier incluí sourceIndex con el índice EXACTO de la foto donde se leyó ese código.",
    "identifierValue/identifierType representan el código principal más confiable. Si no hay ninguno inequívoco, dejá identifierValue vacío.",
    "EAN/UPC requieren lectura completa. Para un barcode lineal alfanumérico claramente legible que no sea EAN/UPC, usá code_128.",
    "Cada índice debe aparecer exactamente una vez: dentro de un grupo o en unassignedIndexes.",
    "Usá unassignedIndexes SOLO para una vista general/panorámica sin sujeto principal, comprobantes, fotos inutilizables o imágenes que realmente no representan una identidad de producto.",
    "REGLA CRÍTICA DE SUJETO PRINCIPAL: si una caja/producto está sostenida, centrada, enfocada, ocupa la mayor parte de la imagen o claramente fue fotografiada a propósito, esa foto pertenece a ese producto AUNQUE haya otros productos distintos en el fondo.",
    "Una foto es realmente mixta/contexto únicamente cuando hay varios productos diferentes co-protagonistas y no existe un objeto principal claro. Si son varias unidades idénticas del MISMO SKU sí pertenece a un grupo.",
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
  const parsedGroups = (Array.isArray(root.groups) ? root.groups : [])
    .map((group, index) => sanitizeGroup(group, allowed, `chunk-${args.chunkNumber}-group-${index + 1}`))
    .filter((group): group is CommerceBatchGroup => Boolean(group));
  const uniqueAssignments = enforceUniqueImageAssignments(parsedGroups);
  const groups = uniqueAssignments.groups;

  const assigned = new Set(groups.flatMap((group) => group.images.map((image) => image.sourceIndex)));
  const explicitUnassigned = new Set<number>();
  for (const value of Array.isArray(root.unassignedIndexes) ? root.unassignedIndexes : []) {
    const index = Number(value);
    if (Number.isInteger(index) && allowed.has(index) && !assigned.has(index)) explicitUnassigned.add(index);
  }

  // Dense first-pass grouping can wrongly throw away a real front/back/code
  // photo as "context". Re-check those images in a dedicated smaller pass
  // before we ever mark them context-only.
  if (explicitUnassigned.size) {
    const recoveryImages = args.images.filter((image) => explicitUnassigned.has(image.sourceIndex));
    groups.push(...await recoverExplicitUnassignedImages({
      images: recoveryImages,
      spotName: args.spotName,
      chunkNumber: args.chunkNumber,
    }));
  }

  const assignedAfterRecovery = new Set(groups.flatMap((group) => group.images.map((image) => image.sourceIndex)));
  // If the first model simply forgot an index, keep it as reviewable evidence.
  for (const sourceIndex of allowed) {
    if (assignedAfterRecovery.has(sourceIndex) || explicitUnassigned.has(sourceIndex)) continue;
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

const RECOVERY_SCHEMA = {
  type: "object",
  properties: {
    groups: GROUP_SCHEMA.properties.groups,
    contextObservations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceIndex: { type: "integer" },
          observedProducts: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
        required: ["sourceIndex", "observedProducts", "reason"],
      },
    },
  },
  required: ["groups", "contextObservations"],
} as const;

const SCENE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceIndex: { type: "integer" },
          sceneType: {
            type: "string",
            enum: ["single_product", "same_product_multiple_units", "mixed_products"],
          },
          observedProducts: {
            type: "array",
            items: { type: "string" },
          },
          reason: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["sourceIndex", "sceneType", "observedProducts", "reason", "confidence"],
      },
    },
  },
  required: ["images"],
} as const;

const CONTEXT_LINK_SCHEMA = {
  type: "object",
  properties: {
    observations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceIndex: { type: "integer" },
          sceneType: {
            type: "string",
            enum: ["primary_product", "true_context"],
          },
          primaryGroupKey: { type: "string" },
          primaryRole: {
            type: "string",
            enum: ["Frente", "Atrás", "Detalle"],
          },
          primaryConfidence: { type: "number", minimum: 0, maximum: 1 },
          observedProducts: { type: "array", items: { type: "string" } },
          matches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                groupKey: { type: "string" },
                label: { type: "string" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["groupKey", "label", "confidence"],
            },
          },
        },
        required: [
          "sourceIndex", "sceneType", "primaryGroupKey", "primaryRole", "primaryConfidence",
          "observedProducts", "matches",
        ],
      },
    },
  },
  required: ["observations"],
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

function normalizeIdentityText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(unknown|desconocido|generico|generic)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const IDENTITY_STOP = new Set([
  "de", "del", "la", "las", "el", "los", "y", "con", "para", "por", "the",
  "a", "to", "for", "cable", "usb", "producto", "packaging", "caja",
]);

function identityTokens(value: string) {
  return new Set(
    normalizeIdentityText(value)
      .split(" ")
      .filter((token) => token.length >= 2 && !IDENTITY_STOP.has(token)),
  );
}

function identitySimilarity(left: string, right: string) {
  const a = identityTokens(left);
  const b = identityTokens(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / Math.max(a.size, b.size);
}

function editDistance(left: string, right: string) {
  const a = left.replace(/\s+/g, "");
  const b = right.replace(/\s+/g, "");
  if (!a) return b.length;
  if (!b) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length];
}

function looselySameBrand(left: string, right: string) {
  const a = normalizeIdentityText(left).replace(/\s+/g, "");
  const b = normalizeIdentityText(right).replace(/\s+/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 4 && longer.includes(shorter) && shorter.length / longer.length >= 0.6) return true;
  const distance = editDistance(a, b);
  return Math.max(a.length, b.length) >= 5 && distance <= Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.3));
}

const GENERIC_IDENTITY_TOKENS = new Set([
  "usb", "cable", "charge", "charger", "fast", "power", "tipo", "type",
  "data", "datos", "adapter", "adaptador", "wireless", "original", "generic",
]);

function sharedDistinctiveIdentityToken(left: CommerceBatchGroup, right: CommerceBatchGroup) {
  const brandTokens = new Set([
    ...identityTokens(left.brand),
    ...identityTokens(right.brand),
  ]);
  const leftTokens = identityTokens([left.name, left.model].filter(Boolean).join(" "));
  const rightTokens = identityTokens([right.name, right.model].filter(Boolean).join(" "));
  for (const token of leftTokens) {
    if (!rightTokens.has(token) || brandTokens.has(token) || GENERIC_IDENTITY_TOKENS.has(token)) continue;
    const hasLetter = /[a-z]/.test(token);
    const hasDigit = /\d/.test(token);
    if ((hasLetter && hasDigit && token.length >= 3) || token.length >= 5) return true;
  }
  return false;
}

function externalCodeKeys(group: CommerceBatchGroup) {
  const raw = [
    ...(group.identifier ? [group.identifier] : []),
    ...group.visibleIdentifiers,
  ];
  return new Set(raw.flatMap((code) => {
    if (["sku", "clouva_barcode", "clouva_qr"].includes(code.type)) return [];
    const validation = validateCommerceIdentifier(code.type, code.value);
    if (!validation.valid) return [];
    return [`${code.type}:${validation.value.replace(/\s/g, "").toUpperCase()}`];
  }));
}

function hasConflictingExternalCodes(left: CommerceBatchGroup, right: CommerceBatchGroup) {
  const a = externalCodeKeys(left);
  const b = externalCodeKeys(right);
  if (!a.size || !b.size) return false;
  for (const key of a) if (b.has(key)) return false;
  return true;
}

function sameExternalCode(left: CommerceBatchGroup, right: CommerceBatchGroup) {
  const a = externalCodeKeys(left);
  const b = externalCodeKeys(right);
  for (const key of a) if (b.has(key)) return true;
  return false;
}

function shouldMergeCommercialIdentity(left: CommerceBatchGroup, right: CommerceBatchGroup) {
  if (hasConflictingExternalCodes(left, right)) return false;
  if (sameExternalCode(left, right)) return true;

  const leftBrand = normalizeIdentityText(left.brand);
  const rightBrand = normalizeIdentityText(right.brand);
  const brandSame = Boolean(leftBrand && rightBrand && leftBrand === rightBrand);
  const brandLoose = looselySameBrand(left.brand, right.brand);
  const brandConflict = Boolean(leftBrand && rightBrand && !brandSame && !brandLoose);

  const leftModel = normalizeIdentityText(left.model);
  const rightModel = normalizeIdentityText(right.model);
  const modelSame = Boolean(
    leftModel && rightModel && leftModel === rightModel && leftModel.length >= 4,
  );
  const compactSpecificModel = (value: string) =>
    /^[a-z0-9-]{4,}$/i.test(value.replace(/\s+/g, ""))
    && /[a-z]/i.test(value)
    && /\d/.test(value)
    && !/\s/.test(value);
  const hardModelConflict = Boolean(
    leftModel && rightModel && leftModel !== rightModel
    && compactSpecificModel(left.model)
    && compactSpecificModel(right.model),
  );

  const leftIdentity = [left.name, left.brand, left.model].filter(Boolean).join(" ");
  const rightIdentity = [right.name, right.brand, right.model].filter(Boolean).join(" ");
  const similarity = identitySimilarity(leftIdentity, rightIdentity);
  const nameSimilarity = identitySimilarity(left.name, right.name);
  const leftName = normalizeIdentityText(left.name);
  const rightName = normalizeIdentityText(right.name);
  const shorterName = leftName.length <= rightName.length ? leftName : rightName;
  const longerName = leftName.length > rightName.length ? leftName : rightName;
  const nameContained = shorterName.length >= 7 && longerName.includes(shorterName);

  if (modelSame && (!brandConflict || similarity >= 0.5)) return true;
  if (!hardModelConflict && (brandSame || brandLoose) && sharedDistinctiveIdentityToken(left, right)) return true;
  if (!hardModelConflict && (brandSame || brandLoose) && (nameSimilarity >= 0.58 || nameContained)) return true;
  if (!brandConflict && !hardModelConflict && similarity >= 0.84 && (!leftModel || !rightModel)) return true;
  return false;
}

function consolidateDeterministicCommercialIdentity(groups: CommerceBatchGroup[]) {
  if (groups.length <= 1) return groups;
  const parent = groups.map((_, index) => index);
  const find = (value: number): number => parent[value] === value ? value : (parent[value] = find(parent[value]));
  const union = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };

  for (let left = 0; left < groups.length; left += 1) {
    for (let right = left + 1; right < groups.length; right += 1) {
      if (shouldMergeCommercialIdentity(groups[left], groups[right])) union(left, right);
    }
  }

  const clusters = new Map<number, CommerceBatchGroup[]>();
  groups.forEach((group, index) => {
    const root = find(index);
    clusters.set(root, [...(clusters.get(root) ?? []), group]);
  });

  return Array.from(clusters.values()).map((members) => {
    if (members.length === 1) return members[0];
    // A deterministic commercial-identity merge proves that these views belong
    // to the same SKU/variant, but it does NOT prove that every source group is
    // a different physical unit. Summing here was inflating stock whenever
    // front/back/detail photos had been split across chunks. Keep the strongest
    // existing physical count and let the visual refinement step raise it only
    // when multiple distinct units are actually visible.
    return mergeClusterGroups(
      members,
      Math.max(...members.map((group) => Math.max(1, group.unitCount))),
      Math.min(...members.map((group) => group.confidence)),
      members.some((group) => group.needsReview),
    );
  });
}

function mergeClusterGroups(groups: CommerceBatchGroup[], unitCount: number, confidence: number, needsReview: boolean) {
  const coded = groups.find((group) => group.identifier);
  const preferred = coded ?? [...groups].sort((a, b) =>
    (b.name.length + b.brand.length + b.model.length) - (a.name.length + a.brand.length + a.model.length))[0];
  const imageMap = new Map<number, CommerceBatchImageRole>();
  for (const group of groups) for (const image of group.images) imageMap.set(image.sourceIndex, image);
  const codeMap = new Map<string, CommerceBatchVisibleIdentifier>();
  for (const group of groups) {
    if (group.identifier) {
      const sourceIndex = group.visibleIdentifiers.find((code) =>
        code.type === group.identifier?.type && code.value === group.identifier?.value)?.sourceIndex;
      const primary = {
        value: group.identifier.value,
        type: group.identifier.type,
        source: "unknown" as const,
        confidence: group.confidence,
        ...(sourceIndex != null ? { sourceIndex } : {}),
      };
      codeMap.set(`${primary.type}:${primary.value.replace(/\s/g, "").toUpperCase()}`, primary);
    }
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

async function consolidateGroups(
  groups: CommerceBatchGroup[],
  expectedProducts: CommerceBatchExpectedProduct[] = [],
  imagesByIndex?: Map<number, StoredBatchImage>,
  spotName = "",
) {
  if (groups.length <= 1) return groups;

  // Keep visual evidence enabled for normal 60–80 photo imports too.
  // After the first consolidation these batches usually have ~25–40 candidate
  // products; disabling visuals at 25 was exactly where front/back pairs such
  // as PS4 cable packaging stopped being joined.
  const visualRefs = imagesByIndex && groups.length <= 40
    ? (await Promise.all(groups.map(async (group) => {
        const representative = group.images.find((image) => image.role === "Frente") ?? group.images[0];
        const source = representative ? imagesByIndex.get(representative.sourceIndex) : undefined;
        if (!source) return null;
        const stored = await downloadGeneratedMediaObject(source.storagePath);
        return {
          groupKey: group.groupKey,
          sourceIndex: representative.sourceIndex,
          mimeType: stored.mimeType.startsWith("image/") ? stored.mimeType : source.mimeType,
          data: stored.bytes.toString("base64"),
        };
      }))).filter((value): value is NonNullable<typeof value> => Boolean(value))
    : [];

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
    "Si un grupo sin código coincide claramente en marca/modelo/packaging con otro grupo que sí tiene código, unilos: el código pertenece al producto agrupado completo.",
    "La factura es CONTEXTO, no una orden de forzar coincidencias. Usala para reconocer nombres abreviados y cantidades esperadas, pero nunca unas variantes visualmente incompatibles.",
    visualRefs.length
      ? "También recibís una imagen representativa por grupo. Usalas como evidencia principal para decidir frente/dorso/detalle del mismo artículo. No agrupes por parecido genérico."
      : "En este lote no se adjuntaron referencias visuales a esta pasada; sé conservador con cualquier unión.",
    spotName ? `Spot: "${spotName}".` : "",
    visualRefs.length
      ? `Orden de referencias visuales: ${visualRefs.map((ref, index) => `imagen ${index + 1} = ${ref.groupKey} (sourceIndex ${ref.sourceIndex})`).join(" · ")}`
      : "",
    expectedProducts.length ? `Factura / productos esperados: ${JSON.stringify(expectedProducts)}` : "No hay factura disponible para este lote.",
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
  ].filter(Boolean).join("\n");

  try {
    const generated = await generateGoogleCloudJson({
      model: process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
        ?? process.env.GEMINI_PRODUCT_VISION_MODEL
        ?? "gemini-2.5-flash",
      prompt,
      ...(visualRefs.length
        ? { referenceImages: visualRefs.map((ref) => ({ mimeType: ref.mimeType, data: ref.data })) }
        : {}),
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
  if (args.group.images.length > 16) return args.group;
  // A single image can still have a bad physical-count estimate. Re-verify
  // singles only when the first pass was uncertain or claimed >1 unit.
  if (args.group.images.length === 1 && !args.group.needsReview && args.group.unitCount === 1) return args.group;
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
      "REGLA CRÍTICA: la cantidad de fotos NUNCA es la cantidad de unidades. Dos fotos del mismo producto no implican unitCount=2.",
      "Si el mismo packaging aparece en varias fotos y no podés demostrar que son unidades físicas distintas, usá unitCount=1.",
      "Solo usá unitCount>1 cuando la evidencia visual muestre claramente varias unidades distintas al mismo tiempo o rasgos inequívocos que prueben que son objetos distintos.",
      "Si se ven varias cajas/unidades idénticas, contalas una sola vez cada una aunque aparezcan repetidas en otras fotos.",
      "Ignorá productos ajenos que aparezcan de fondo: para identidad y unitCount contá únicamente la variante propuesta por este grupo.",
      "Si descubrís códigos completos distintos o una variante claramente diferente, marcá needsReview=true; no inventes datos.",
      "Elegí como Frente la foto donde mejor se vea el producto o la cara frontal de su packaging.",
      "Si un código aparece en cualquier foto del grupo, conservá ese código como identifier principal y registrá sourceIndex en visibleIdentifiers.",
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

async function reviewMixedSceneCandidate(args: {
  group: CommerceBatchGroup;
  imagesByIndex: Map<number, StoredBatchImage>;
  spotName: string;
}): Promise<CommerceBatchGroup[]> {
  const suspicious = args.group.images.length <= 2 && (
    args.group.needsReview
    || args.group.unitCount > 1
    || /\b(and|y|con|varios|multiple|multi)\b/i.test(args.group.name)
  );
  if (!suspicious) return [args.group];

  try {
    const refs = await Promise.all(args.group.images.map(async (image) => {
      const source = args.imagesByIndex.get(image.sourceIndex);
      if (!source) throw new Error("Imagen inexistente.");
      const stored = await downloadGeneratedMediaObject(source.storagePath);
      return {
        sourceIndex: image.sourceIndex,
        mimeType: stored.mimeType.startsWith("image/") ? stored.mimeType : source.mimeType,
        data: stored.bytes.toString("base64"),
      };
    }));
    const prompt = [
      "Sos el control anti-mezcla de CLOUVA.",
      `Spot: "${args.spotName}".`,
      "Clasificá CADA FOTO por separado. No conviertas un grupo entero en contexto solo porque una de sus imágenes sea mixta.",
      "single_product: frente/dorso/detalle de un solo SKU.",
      "same_product_multiple_units: aparecen varias unidades físicamente separadas pero TODAS son exactamente el mismo SKU/variante.",
      "mixed_products: SOLO cuando ESA FOTO es una vista general con varios productos/variantes diferentes co-protagonistas y NO hay un sujeto principal claro.",
      "Si hay un producto/caja sostenido, centrado, enfocado o claramente dominante y otros artículos aparecen atrás, NO es mixed_products: clasificá la foto según el producto principal.",
      "Para cada mixed_products, observedProducts debe enumerar TODO lo que realmente se alcanza a reconocer en ESA foto, sin inventar.",
      "Una foto mixed_products nunca pertenece a un producto y nunca suma stock. Las otras fotos individuales del grupo deben conservarse con el producto al que corresponden.",
      "Un dorso de packaging, etiqueta o código de barras sigue siendo single_product aunque haya objetos ajenos desenfocados detrás.",
      `Índices disponibles: ${refs.map((ref) => ref.sourceIndex).join(", ")}.`,
      `Grupo propuesto: ${JSON.stringify({
        name: args.group.name,
        brand: args.group.brand,
        model: args.group.model,
        unitCount: args.group.unitCount,
        sourceIndexes: args.group.images.map((image) => image.sourceIndex),
      })}`,
    ].join("\n");
    const generated = await generateGoogleCloudJson({
      model: process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
        ?? process.env.GEMINI_PRODUCT_VISION_MODEL
        ?? "gemini-2.5-flash",
      prompt,
      referenceImages: refs.map((ref) => ({ mimeType: ref.mimeType, data: ref.data })),
      responseJsonSchema: SCENE_REVIEW_SCHEMA,
      temperature: 0,
      maxOutputTokens: 1200,
    });
    const result = record(parseGroupingJson(generated.text));
    const reviews = Array.isArray(result.images) ? result.images.map(record) : [];
    const reviewByIndex = new Map<number, Record<string, unknown>>();
    for (const review of reviews) {
      const sourceIndex = Number(review.sourceIndex);
      if (Number.isInteger(sourceIndex) && args.group.images.some((image) => image.sourceIndex === sourceIndex)) {
        reviewByIndex.set(sourceIndex, review);
      }
    }

    const mixed: CommerceBatchGroup[] = [];
    const productImages: CommerceBatchImageRole[] = [];
    for (const image of args.group.images) {
      const review = reviewByIndex.get(image.sourceIndex);
      if (review?.sceneType !== "mixed_products") {
        productImages.push(image);
        continue;
      }
      const observedProducts = (Array.isArray(review.observedProducts) ? review.observedProducts : [])
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().slice(0, 120))
        .slice(0, 20);
      mixed.push({
        groupKey: `context-scene-${image.sourceIndex}`,
        name: "",
        brand: "",
        model: "",
        packageKind: "unknown",
        unitCount: 1,
        identifier: null,
        visibleIdentifiers: [],
        confidence: number01(review.confidence),
        needsReview: false,
        images: [{ sourceIndex: image.sourceIndex, role: "Frente" }],
        contextOnly: true,
        observedProducts,
        contextReason: text(review.reason, 240) || "Foto con varios productos distintos.",
      });
    }

    if (!mixed.length) return [args.group];
    const productPart = productImages.length
      ? [{
          ...args.group,
          images: normalizeRoles(productImages),
          needsReview: true,
        } satisfies CommerceBatchGroup]
      : [];
    return [...productPart, ...mixed];
  } catch {
    return [args.group];
  }
}

async function linkContextScenesToProducts(args: {
  productGroups: CommerceBatchGroup[];
  contextGroups: CommerceBatchGroup[];
  imagesByIndex: Map<number, StoredBatchImage>;
  spotName: string;
}): Promise<{ productGroups: CommerceBatchGroup[]; contextGroups: CommerceBatchGroup[] }> {
  if (!args.contextGroups.length) {
    return { productGroups: args.productGroups, contextGroups: args.contextGroups };
  }

  const contextImages = args.contextGroups.flatMap((group) =>
    group.images.map((image) => ({ sourceIndex: image.sourceIndex, groupKey: group.groupKey })),
  );
  const alreadyAssigned = new Map<number, string>();
  for (const group of args.productGroups) {
    for (const image of group.images) alreadyAssigned.set(image.sourceIndex, group.groupKey);
  }

  try {
    const refs = (await Promise.all(contextImages.map(async (entry) => {
      const source = args.imagesByIndex.get(entry.sourceIndex);
      if (!source) return null;
      const stored = await downloadGeneratedMediaObject(source.storagePath);
      return {
        ...entry,
        mimeType: stored.mimeType.startsWith("image/") ? stored.mimeType : source.mimeType,
        data: stored.bytes.toString("base64"),
      };
    }))).filter((value): value is NonNullable<typeof value> => Boolean(value));
    if (!refs.length) return { productGroups: args.productGroups, contextGroups: args.contextGroups };

    const catalog = args.productGroups.map((group) => ({
      groupKey: group.groupKey,
      name: group.name,
      brand: group.brand,
      model: group.model,
      identifier: group.identifier,
      visibleIdentifiers: group.visibleIdentifiers,
      sourceIndexes: group.images.map((image) => image.sourceIndex),
    }));

    const prompt = [
      "Sos el revisor final de fotos que CLOUVA marcó provisoriamente como contexto.",
      `Spot: "${args.spotName}".`,
      "IMPORTANTE: algunas de estas fotos fueron clasificadas mal. Re-evaluá CADA FOTO contra el catálogo ya detectado.",
      "sceneType=primary_product cuando existe UN producto/caja claramente protagonista: está sostenido con la mano, centrado, enfocado, ocupa gran parte del cuadro, o la foto muestra su dorso/etiqueta/código. Los artículos visibles atrás son solo fondo.",
      "sceneType=true_context SOLO para una vista general/panorámica donde varios productos distintos sean co-protagonistas y NO exista un producto principal claro.",
      "Un dorso, lateral, etiqueta o código de barras de una sola caja NUNCA es true_context por el hecho de mostrar mucho texto.",
      "Si sceneType=primary_product y el sujeto corresponde exactamente a una identidad del catálogo, primaryGroupKey DEBE ser ese groupKey. Elegí primaryRole=Frente, Atrás o Detalle según la vista real.",
      "Si no hay coincidencia segura en catálogo, dejá primaryGroupKey vacío y bajá primaryConfidence; no inventes matches.",
      "Para true_context, primaryGroupKey debe quedar vacío. observedProducts debe listar TODO producto distinguible que realmente se vea, usando marca/modelo/tipo cuando haya evidencia.",
      "matches puede relacionar productos visibles con el catálogo, pero una coincidencia de fondo NO significa que la foto pertenezca a ese producto.",
      "No cuentes stock en este paso.",
      `Orden de imágenes: ${refs.map((ref, index) => `imagen ${index + 1} = sourceIndex ${ref.sourceIndex}`).join(" · ")}`,
      `Catálogo de productos ya detectados: ${JSON.stringify(catalog)}`,
    ].join("\n");

    const generated = await generateGoogleCloudJson({
      model: process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
        ?? process.env.GEMINI_PRODUCT_VISION_MODEL
        ?? "gemini-2.5-flash",
      prompt,
      referenceImages: refs.map((ref) => ({ mimeType: ref.mimeType, data: ref.data })),
      responseJsonSchema: CONTEXT_LINK_SCHEMA,
      temperature: 0,
      maxOutputTokens: 5600,
    });

    const root = record(parseGroupingJson(generated.text));
    const knownGroups = new Map(args.productGroups.map((group) => [group.groupKey, group]));
    const observationByIndex = new Map<number, {
      sceneType: "primary_product" | "true_context";
      primaryGroupKey: string;
      primaryRole: CommerceBatchImageRole["role"];
      primaryConfidence: number;
      observedProducts: string[];
      matches: CommerceBatchContextMatch[];
    }>();

    for (const raw of Array.isArray(root.observations) ? root.observations : []) {
      const observation = record(raw);
      const sourceIndex = Number(observation.sourceIndex);
      if (!Number.isInteger(sourceIndex) || !contextImages.some((entry) => entry.sourceIndex === sourceIndex)) continue;

      const observedProducts = Array.from(new Set(
        (Array.isArray(observation.observedProducts) ? observation.observedProducts : [])
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim().slice(0, 140)),
      )).slice(0, 24);

      const matches: CommerceBatchContextMatch[] = [];
      const seen = new Set<string>();
      for (const rawMatch of Array.isArray(observation.matches) ? observation.matches : []) {
        const match = record(rawMatch);
        const groupKey = text(match.groupKey, 96);
        if (!groupKey || !knownGroups.has(groupKey) || seen.has(groupKey)) continue;
        seen.add(groupKey);
        const known = knownGroups.get(groupKey)!;
        matches.push({
          groupKey,
          label: text(match.label, 160) || [known.brand, known.model, known.name].filter(Boolean).join(" · ") || known.name || groupKey,
          confidence: number01(match.confidence),
        });
      }

      const requestedPrimary = text(observation.primaryGroupKey, 96);
      const primaryGroupKey = knownGroups.has(requestedPrimary) ? requestedPrimary : "";
      const primaryRole: CommerceBatchImageRole["role"] = observation.primaryRole === "Atrás"
        ? "Atrás"
        : observation.primaryRole === "Detalle"
          ? "Detalle"
          : "Frente";
      observationByIndex.set(sourceIndex, {
        sceneType: observation.sceneType === "primary_product" ? "primary_product" : "true_context",
        primaryGroupKey,
        primaryRole,
        primaryConfidence: number01(observation.primaryConfidence),
        observedProducts,
        matches,
      });
    }

    const attachmentsByGroup = new Map<string, CommerceBatchImageRole[]>();
    const referencesByGroup = new Map<string, CommerceBatchContextReference[]>();
    const nextContextGroups: CommerceBatchGroup[] = [];

    for (const contextGroup of args.contextGroups) {
      for (const image of contextGroup.images) {
        // If an earlier product pass already owns this source image, product
        // ownership wins. A photo can never be both product evidence and context.
        if (alreadyAssigned.has(image.sourceIndex)) continue;

        const linked = observationByIndex.get(image.sourceIndex);
        if (
          linked?.sceneType === "primary_product"
          && linked.primaryGroupKey
          && linked.primaryConfidence >= 0.62
        ) {
          const target = attachmentsByGroup.get(linked.primaryGroupKey) ?? [];
          if (!target.some((candidate) => candidate.sourceIndex === image.sourceIndex)) {
            target.push({ sourceIndex: image.sourceIndex, role: linked.primaryRole });
            attachmentsByGroup.set(linked.primaryGroupKey, target);
          }
          alreadyAssigned.set(image.sourceIndex, linked.primaryGroupKey);
          continue;
        }

        const matches = linked?.matches ?? contextGroup.contextMatches ?? [];
        for (const match of matches) {
          const refsForGroup = referencesByGroup.get(match.groupKey) ?? [];
          if (!refsForGroup.some((ref) => ref.sourceIndex === image.sourceIndex)) {
            refsForGroup.push({
              sourceIndex: image.sourceIndex,
              label: match.label,
              confidence: match.confidence,
            });
            referencesByGroup.set(match.groupKey, refsForGroup);
          }
        }

        nextContextGroups.push({
          ...contextGroup,
          groupKey: contextGroup.images.length === 1
            ? contextGroup.groupKey
            : `${contextGroup.groupKey}-${image.sourceIndex}`,
          images: [{ sourceIndex: image.sourceIndex, role: "Frente" }],
          observedProducts: linked?.observedProducts.length
            ? linked.observedProducts
            : contextGroup.observedProducts,
          contextMatches: matches,
          contextReason: linked?.sceneType === "true_context"
            ? "Vista general con varios productos distintos y sin un sujeto principal."
            : contextGroup.contextReason,
        });
      }
    }

    const nextProductGroups: CommerceBatchGroup[] = [];
    for (const group of args.productGroups) {
      const attachments = attachmentsByGroup.get(group.groupKey) ?? [];
      const refsForGroup = [
        ...(group.contextReferences ?? []),
        ...(referencesByGroup.get(group.groupKey) ?? []),
      ].filter((ref, index, all) =>
        all.findIndex((candidate) => candidate.sourceIndex === ref.sourceIndex) === index,
      );

      if (!attachments.length) {
        nextProductGroups.push({ ...group, contextReferences: refsForGroup });
        continue;
      }

      const merged = {
        ...group,
        images: normalizeRoles([
          ...group.images,
          ...attachments.filter((attachment) => !group.images.some((image) => image.sourceIndex === attachment.sourceIndex)),
        ]),
        needsReview: true,
        contextReferences: refsForGroup,
      } satisfies CommerceBatchGroup;

      const refined = await refineMergedGroup({
        group: merged,
        imagesByIndex: args.imagesByIndex,
        spotName: args.spotName,
      });
      nextProductGroups.push({
        ...refined,
        groupKey: group.groupKey,
        contextReferences: refsForGroup,
      });
    }

    return { productGroups: nextProductGroups, contextGroups: nextContextGroups };
  } catch {
    // Even when the provider has a transient failure, never let the exact same
    // image appear both as a product photo and as context.
    const assigned = new Set(args.productGroups.flatMap((group) => group.images.map((image) => image.sourceIndex)));
    return {
      productGroups: args.productGroups,
      contextGroups: args.contextGroups.flatMap((group) => {
        const images = group.images.filter((image) => !assigned.has(image.sourceIndex));
        return images.length ? [{ ...group, images: normalizeRoles(images) }] : [];
      }),
    };
  }
}

export async function analyzeCommerceProductBatch(args: {
  images: StoredBatchImage[];
  spotName: string;
  expectedProducts?: CommerceBatchExpectedProduct[];
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

  const preclassifiedContext = groups.filter((group) => group.contextOnly);
  const productGroups = groups.filter((group) => !group.contextOnly);

  const imagesByIndex = new Map(args.images.map((image) => [image.sourceIndex, image]));

  await args.onProgress?.({
    stage: "consolidating",
    completed: 0,
    total: 2,
    provisionalProducts: productGroups.length,
    message: "Uniendo códigos, modelos y vistas repetidas…",
    updatedAt: new Date().toISOString(),
  });
  const deterministic = consolidateDeterministicCommercialIdentity(productGroups);
  await args.onProgress?.({
    stage: "consolidating",
    completed: 1,
    total: 2,
    provisionalProducts: deterministic.length,
    message: "Contrastando identidades con la factura y la evidencia visual…",
    updatedAt: new Date().toISOString(),
  });
  const aiConsolidated = await consolidateGroups(
    deterministic,
    args.expectedProducts ?? [],
    imagesByIndex,
    args.spotName,
  );
  const consolidated = consolidateDeterministicCommercialIdentity(aiConsolidated);
  await args.onProgress?.({
    stage: "consolidating",
    completed: 2,
    total: 2,
    provisionalProducts: consolidated.length,
    message: `${consolidated.length} productos candidatos · verificando frente, código y unidades…`,
    updatedAt: new Date().toISOString(),
  });

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

  const finalUnique = enforceUniqueImageAssignments(refined).groups;
  const sceneReviewed: CommerceBatchGroup[] = [];
  for (const group of finalUnique) {
    sceneReviewed.push(...await reviewMixedSceneCandidate({ group, imagesByIndex, spotName: args.spotName }));
  }
  const reviewed = [...sceneReviewed, ...preclassifiedContext].sort((left, right) => {
    const leftIndex = Math.min(...left.images.map((image) => image.sourceIndex));
    const rightIndex = Math.min(...right.images.map((image) => image.sourceIndex));
    return leftIndex - rightIndex;
  });
  let productNumber = 0;
  let contextNumber = 0;
  const numbered = reviewed.map((group) => {
    if (group.contextOnly) {
      contextNumber += 1;
      return {
        ...group,
        groupKey: `context-${String(contextNumber).padStart(3, "0")}`,
        images: normalizeRoles(group.images),
      };
    }
    productNumber += 1;
    return {
      ...group,
      groupKey: `product-${String(productNumber).padStart(3, "0")}`,
      images: normalizeRoles(group.images),
    };
  });

  await args.onProgress?.({
    stage: "refining",
    completed: productNumber,
    total: productNumber,
    provisionalProducts: productNumber,
    message: "Relacionando fotos mixtas con los productos que aparecen atrás y adelante…",
    updatedAt: new Date().toISOString(),
  });

  const linked = await linkContextScenesToProducts({
    productGroups: numbered.filter((group) => !group.contextOnly),
    contextGroups: numbered.filter((group) => group.contextOnly),
    imagesByIndex,
    spotName: args.spotName,
  });

  const result = [...linked.productGroups, ...linked.contextGroups].sort((left, right) => {
    const leftIndex = Math.min(...left.images.map((image) => image.sourceIndex));
    const rightIndex = Math.min(...right.images.map((image) => image.sourceIndex));
    return leftIndex - rightIndex;
  });

  await args.onProgress?.({
    stage: "done",
    completed: productNumber,
    total: productNumber,
    provisionalProducts: productNumber,
    message: `${productNumber} productos listos para comparar con la factura`,
    updatedAt: new Date().toISOString(),
  });
  return result;
}
