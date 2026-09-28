import "server-only";

import { downloadGeneratedMediaObject } from "@/lib/gcs-media";
import { decodeBarcodesFromImageBytes } from "@/lib/server/commerce-barcode-decode";
import {
  generateGoogleCloudJson,
  GoogleCloudGenAIError,
} from "@/lib/server/google-cloud-genai";
import { normalizeCommerceIdentifier, validateCommerceIdentifier, type CommerceIdentifierType } from "@/lib/commerce/identifiers";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientVertexError(error: unknown) {
  const status = Number((error as Error & { status?: number })?.status || 0);
  const message = error instanceof Error ? error.message : String(error ?? "");
  return status === 429 || /RESOURCE_EXHAUSTED|resource exhausted|quota|rate.?limit|429/i.test(message);
}

// Un 429 de Vertex (cuota por minuto) no puede envenenar todo el lote:
// reintenta con backoff como ya hace el process de compra masiva.
async function withVertexRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientVertexError(error) || attempt >= 3) break;
      await sleep(2500 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Vertex AI no respondió (${label}).`);
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

export type CommerceBatchPhysicalUnit = {
  sourceIndexes: number[];
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
  physicalUnits?: CommerceBatchPhysicalUnit[];
  contextOnly?: boolean;
  unassignedEvidence?: boolean;
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
  });
}

function canonicalCodeKey(type: CommerceIdentifierType, value: string) {
  const normalized = normalizeCommerceIdentifier(value);
  // Los numéricos (EAN/UPC/CODE_128 numérico) se comparan por dígitos sin
  // ceros a la izquierda e ignorando el tipo. Así EAN_13:6950106761203 y
  // CODE_128:6950106761203 fusionan aunque la IA haya tipado distinto.
  if (/^\d+$/.test(normalized)) {
    const stripped = normalized.replace(/^0+/, "") || "0";
    return `gtin:${stripped}`;
  }
  return `${type}:${normalized}`;
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
    // Descartar EAN/UPC con dígito verificador inválido: son transcripciones
    // de la IA con 1 dígito mal, no códigos reales. El lector exacto los
    // repone después con confianza 1.0.
    const validation = validateCommerceIdentifier(type, value);
    if (!validation.valid) return [];
    const source = code.source === "box" ? "box" : code.source === "product" ? "product" : "unknown";
    const sourceIndex = Number(code.sourceIndex);
    return [{
      value: validation.value,
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

  const claimedPhysicalIndexes = new Set<number>();
  const physicalUnits = (Array.isArray(item.physicalUnits) ? item.physicalUnits : []).flatMap((raw) => {
    const unit = record(raw);
    const sourceIndexes = Array.from(new Set(
      (Array.isArray(unit.sourceIndexes) ? unit.sourceIndexes : [])
        .map((value) => Number(value))
        .filter((sourceIndex) => Number.isInteger(sourceIndex) && allowedIndexes.has(sourceIndex)),
    ));
    if (!sourceIndexes.length) return [];
    sourceIndexes.forEach((sourceIndex) => claimedPhysicalIndexes.add(sourceIndex));
    return [{
      sourceIndexes,
      confidence: number01(unit.confidence),
    } satisfies CommerceBatchPhysicalUnit];
  });
  const physicalCoverageComplete = physicalUnits.length > 0
    && uniqueImages.every((image) => claimedPhysicalIndexes.has(image.sourceIndex));
  const unitCount = physicalUnits.length
    ? physicalUnits.length
    : Math.max(1, Math.min(100, Math.floor(Number(item.unitCount) || 1)));

  return {
    groupKey: text(item.groupKey, 96) || fallbackKey,
    name: text(item.name, 180),
    brand: text(item.brand, 120),
    model: text(item.model, 120),
    packageKind,
    unitCount: Math.max(1, Math.min(100, unitCount)),
    identifier: primary,
    visibleIdentifiers,
    confidence: number01(item.confidence),
    needsReview: item.needsReview === true || (physicalUnits.length > 0 && !physicalCoverageComplete),
    images: normalizeRoles(uniqueImages),
    ...(physicalUnits.length ? { physicalUnits } : {}),
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
    "Clasificá Frente y Atrás solo cuando esas vistas realmente existan. Si falta el frente, no conviertas un dorso o detalle en Frente. El resto es Detalle.",
  ].join("\n");

  try {
    const generated = await withVertexRetry("recuperador-contexto", () => generateGoogleCloudJson({
      model: process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
        ?? process.env.GEMINI_PRODUCT_VISION_MODEL
        ?? "gemini-2.5-flash",
      prompt,
      responseJsonSchema: RECOVERY_SCHEMA,
      temperature: 0,
      maxOutputTokens: 5000,
    }));
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
  const downloadedRaw = await Promise.all(args.images.map(async (image) => {
    const stored = await downloadGeneratedMediaObject(image.storagePath);
    const mimeType = stored.mimeType.startsWith("image/") ? stored.mimeType : image.mimeType;
    return {
      sourceIndex: image.sourceIndex,
      mimeType,
      bytes: stored.bytes,
      data: stored.bytes.toString("base64"),
    };
  }));
  const downloaded = downloadedRaw.map(({ sourceIndex, mimeType, data }) => ({ sourceIndex, mimeType, data }));

  // Lector exacto sobre el original full-res (no el thumb de Gemini).
  // Es la verdad absoluta para códigos: si lee 8945637653460 válido, la IA
  // no puede poner 8945637653466. Si no lee nada (Samsung blanco), queda
  // sin código y va a SKU, que es lo correcto para tu único sin código.
  const exactByIndex = new Map<number, { value: string; type: CommerceIdentifierType }[]>();
  await Promise.all(downloadedRaw.map(async (image) => {
    try {
      const decoded = await decodeBarcodesFromImageBytes(image.bytes, image.sourceIndex);
      if (decoded.length) {
        exactByIndex.set(image.sourceIndex, decoded.map((d) => ({ value: d.value, type: d.type })));
      }
    } catch {
      // Nunca romper el lote por el lector exacto.
    }
  }));
  const exactLines = Array.from(exactByIndex.entries())
    .map(([idx, codes]) => `foto #${idx}: ${codes.map((c) => `${c.type} ${c.value}`).join(" | ")}`)
    .join("\n");

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
    ...(exactLines
      ? [
          "CÓDIGOS LECTOR EXACTO POR FOTO (verdad absoluta, NO re-transcribir, copiar tal cual):",
          exactLines,
          "Si una foto tiene código lector exacto, ese código DEBE aparecer en visibleIdentifiers de su grupo con ese mismo sourceIndex, y debe ser el identifierValue/identifierType salvo que veas otro código distinto e inequívoco en la misma foto.",
          "Nunca inventes un dígito distinto al lector exacto. Si el lector no trae código para una foto (ej. caja blanca sin barras), dejá identifierValue vacío para ese grupo: va a SKU, no inventes.",
        ]
      : []),
    "Cada índice debe aparecer exactamente una vez: dentro de un grupo o en unassignedIndexes.",
    "Usá unassignedIndexes SOLO para una vista general/panorámica sin sujeto principal, comprobantes, fotos inutilizables o imágenes que realmente no representan una identidad de producto.",
    "REGLA CRÍTICA DE SUJETO PRINCIPAL: si una caja/producto está sostenida, centrada, enfocada, ocupa la mayor parte de la imagen o claramente fue fotografiada a propósito, esa foto pertenece a ese producto AUNQUE haya otros productos distintos en el fondo.",
    "Una foto es realmente mixta/contexto únicamente cuando hay varios productos diferentes co-protagonistas y no existe un objeto principal claro. Si son varias unidades idénticas del MISMO SKU sí pertenece a un grupo.",
    "Si una imagen muestra un solo producto pero no podés reconocer nombre/código, creá igualmente un grupo con campos vacíos y needsReview=true; no la mandes a unassignedIndexes.",
    "Usá Frente SOLO cuando realmente se vea la cara frontal del producto o packaging. Si el grupo contiene únicamente dorso, lateral, etiqueta, código o detalle, puede tener CERO fotos Frente. Elegí como máximo una Atrás cuando exista una vista posterior clara; el resto debe ser Detalle.",
    "name, brand y model deben salir solo de texto/evidencia visible. Dejalos vacíos si no están confirmados.",
    "identifierValue debe estar vacío salvo que el código completo sea inequívoco carácter por carácter.",
    "needsReview=true cuando el agrupamiento no sea suficientemente seguro.",
    "No inventes precio, costo, stock ni disponibilidad.",
  ].join("\n");

  const generated = await withVertexRetry("agrupador", () => generateGoogleCloudJson({
    model: process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
      ?? process.env.GEMINI_PRODUCT_VISION_MODEL
      ?? "gemini-2.5-flash",
    prompt,
    referenceImages: downloaded.map((image) => ({ mimeType: image.mimeType, data: image.data })),
    responseJsonSchema: GROUP_SCHEMA,
    temperature: 0.05,
    maxOutputTokens: 6000,
  }));

  const parsed = parseGroupingJson(generated.text);

  const root = record(parsed);
  const allowed = new Set(args.images.map((image) => image.sourceIndex));
  const parsedGroups = (Array.isArray(root.groups) ? root.groups : [])
    .map((group, index) => sanitizeGroup(group, allowed, `chunk-${args.chunkNumber}-group-${index + 1}`))
    .filter((group): group is CommerceBatchGroup => Boolean(group));

  // Pisar con lector exacto: si la IA puso 8809094564654 pero el lector leyó
  // 8806090134654 válido en esa misma foto, vale el lector. Si el lector no
  // leyó nada, no inventar (tu Samsung blanco queda SKU).
  for (const group of parsedGroups) {
    const byCanonical = new Map<string, CommerceBatchVisibleIdentifier>();
    for (const code of group.visibleIdentifiers) {
      byCanonical.set(canonicalCodeKey(code.type, code.value), code);
    }
    for (const image of group.images) {
      const exacts = exactByIndex.get(image.sourceIndex) ?? [];
      for (const exact of exacts) {
        const key = canonicalCodeKey(exact.type, exact.value);
        const prev = byCanonical.get(key);
        const entry: CommerceBatchVisibleIdentifier = {
          value: exact.value,
          type: exact.type,
          source: prev?.source ?? "box",
          confidence: 1,
          sourceIndex: image.sourceIndex,
        };
        // El exacto siempre gana sobre transcripciones de la IA.
        byCanonical.set(key, entry);
      }
    }
    group.visibleIdentifiers = Array.from(byCanonical.values());
    // Si el primario es nulo o no coincide con ningún exacto del grupo pero
    // hay exacto disponible, promover el primer exacto a primario.
    const primaryKey = group.identifier ? canonicalCodeKey(group.identifier.type, group.identifier.value) : null;
    const hasPrimaryInExact = primaryKey ? byCanonical.has(primaryKey) : false;
    if (!group.identifier || !hasPrimaryInExact) {
      const firstExact = group.images.flatMap((img) => exactByIndex.get(img.sourceIndex) ?? [])[0];
      if (firstExact) {
        group.identifier = { value: firstExact.value, type: firstExact.type };
      }
    }
  }

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
    const exacts = exactByIndex.get(sourceIndex) ?? [];
    const visibles = exacts.map((e) => ({
      value: e.value,
      type: e.type,
      source: "box" as const,
      confidence: 1,
      sourceIndex,
    }));
    groups.push({
      groupKey: `single-${sourceIndex}`,
      name: "",
      brand: "",
      model: "",
      packageKind: "unknown",
      unitCount: 1,
      identifier: exacts[0] ? { value: exacts[0].value, type: exacts[0].type } : null,
      visibleIdentifiers: visibles,
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

const RECEIPT_CLUSTER_SCHEMA = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          groupKeys: { type: "array", items: { type: "string" } },
          canonicalGroupKey: { type: "string" },
          invoiceIndex: { type: "integer", minimum: 0, maximum: 500 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needsReview: { type: "boolean" },
          physicalUnitCount: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["groupKeys", "canonicalGroupKey", "invoiceIndex", "confidence", "needsReview", "physicalUnitCount"],
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
          codedProducts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                brand: { type: "string" },
                model: { type: "string" },
                identifierValue: { type: "string" },
                identifierType: {
                  type: "string",
                  enum: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku"],
                },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["name", "brand", "model", "identifierValue", "identifierType", "confidence"],
            },
          },
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
          "observedProducts", "codedProducts", "matches",
        ],
      },
    },
  },
  required: ["observations"],
} as const;

const INVOICE_ANCHOR_SCHEMA = {
  type: "object",
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          groupKey: { type: "string" },
          invoiceIndex: { type: "integer", minimum: 0, maximum: 500 },
          trueExtra: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string" },
        },
        required: ["groupKey", "invoiceIndex", "trueExtra", "confidence", "reason"],
      },
    },
  },
  required: ["assignments"],
} as const;

const INVOICE_CONTEXT_SCHEMA = {
  type: "object",
  properties: {
    observations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          groupKey: { type: "string" },
          invoiceIndexes: { type: "array", items: { type: "integer", minimum: 1, maximum: 500 } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["groupKey", "invoiceIndexes", "confidence"],
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
    physicalUnits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceIndexes: { type: "array", items: { type: "integer" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["sourceIndexes", "confidence"],
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needsReview: { type: "boolean" },
    images: GROUP_SCHEMA.properties.groups.items.properties.images,
  },
  required: [
    "name", "brand", "model", "packageKind", "unitCount", "identifierValue", "identifierType",
    "visibleIdentifiers", "physicalUnits", "confidence", "needsReview", "images",
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