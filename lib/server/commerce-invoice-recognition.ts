import "server-only";

import { generateGoogleCloudJson } from "@/lib/server/google-cloud-genai";
import { validateCommerceIdentifier, type CommerceIdentifierType } from "@/lib/commerce/identifiers";
import type { CommerceBatchGroup } from "@/lib/server/commerce-product-batch-recognition";

export type CommerceInvoiceLine = {
  lineNumber: number;
  description: string;
  brand: string;
  model: string;
  supplierSku: string;
  barcode: { value: string; type: CommerceIdentifierType } | null;
  quantity: number;
  unitPrice: number | null;
  taxAmount: number | null;
  lineTotal: number | null;
};

export type CommerceInvoiceRecognition = {
  supplierName: string;
  supplierTaxId: string;
  documentType: string;
  documentNumber: string;
  issuedAt: string;
  currency: string;
  subtotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  lines: CommerceInvoiceLine[];
};

export type CommerceInvoiceMatch = {
  line: CommerceInvoiceLine;
  matchedGroupKeys: string[];
  matchedQuantity: number;
  matchStatus: "matched" | "partial" | "unmatched" | "ambiguous";
  autoChecked: boolean;
  confidence: number;
  reasons: string[];
};

const IDENTIFIER_TYPES = new Set<CommerceIdentifierType>([
  "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku",
]);

const INVOICE_MATCH_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lineNumber: { type: "integer" },
          groupKeys: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reasons: { type: "array", items: { type: "string" } },
        },
        required: ["lineNumber", "groupKeys", "confidence", "reasons"],
      },
    },
  },
  required: ["matches"],
} as const;

const INVOICE_SCHEMA = {
  type: "object",
  properties: {
    supplierName: { type: "string" },
    supplierTaxId: { type: "string" },
    documentType: { type: "string" },
    documentNumber: { type: "string" },
    issuedAt: { type: "string" },
    currency: { type: "string" },
    subtotal: { type: ["number", "null"] },
    taxAmount: { type: ["number", "null"] },
    totalAmount: { type: ["number", "null"] },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lineNumber: { type: "integer" },
          description: { type: "string" },
          brand: { type: "string" },
          model: { type: "string" },
          supplierSku: { type: "string" },
          barcodeValue: { type: "string" },
          barcodeType: {
            type: "string",
            enum: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku"],
          },
          quantity: { type: "number" },
          unitPrice: { type: ["number", "null"] },
          taxAmount: { type: ["number", "null"] },
          lineTotal: { type: ["number", "null"] },
        },
        required: [
          "lineNumber", "description", "brand", "model", "supplierSku",
          "barcodeValue", "barcodeType", "quantity", "unitPrice", "taxAmount", "lineTotal",
        ],
      },
    },
  },
  required: [
    "supplierName", "supplierTaxId", "documentType", "documentNumber", "issuedAt",
    "currency", "subtotal", "taxAmount", "totalAmount", "lines",
  ],
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finiteOrNull(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value: unknown, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeBarcode(value: string) {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

function sanitizeIdentifier(value: unknown, type: unknown) {
  const rawValue = clean(value, 512);
  const rawType = clean(type, 32) as CommerceIdentifierType;
  if (!rawValue || !IDENTIFIER_TYPES.has(rawType)) return null;
  const validation = validateCommerceIdentifier(rawType, rawValue);
  return validation.valid ? { value: validation.value, type: rawType } : null;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bps\s*4\b/g, " playstation 4 ")
    .replace(/\bdual\s*shock\b/g, " dualshock ")
    .replace(/\bla[\s-]*700\b/g, " la700 ")
    .replace(/\btype[\s-]*c\b/g, " usb c ")
    .replace(/\btipo[\s-]*c\b/g, " usb c ")
    .replace(/\btc\b/g, " usb c ")
    .replace(/\biphone\b/g, " lightning ")
    .replace(/\bnote[\s-]*book\b/g, " laptop ")
    .replace(/\b(auricular(?:es)?|audifonos?|earbuds?|earphones?)\b/g, " headset ")
    .replace(/\bwireless\b/g, " wifi ")
    .replace(/\bwi[\s-]*fi\b/g, " wifi ")
    .replace(/\bpower\s+adapter\b/g, " cargador ")
    .replace(/\bcharger\b/g, " cargador ")
    .replace(/\bauto\b/g, " vehiculo ")
    .replace(/\bcar\b/g, " vehiculo ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "de", "del", "la", "las", "el", "los", "y", "con", "sin", "para", "por", "un", "una",
  "unidad", "unidades", "uni", "u", "art", "articulo", "producto", "caja", "pack",
  "original", "generico", "generic",
]);

function tokens(value: string) {
  return new Set(normalizeText(value).split(" ").filter((token) => token.length >= 2 && !STOP.has(token)));
}

function tokenScore(a: string, b: string) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  // La factura usa descripciones muy cortas ("PS4", "Cargador notebook",
  // "Cable iPhone"). Medimos cobertura del renglón contra la identidad larga
  // del packaging; no penalizamos porque la caja tenga más palabras.
  return intersection / left.size;
}

function groupCodes(group: CommerceBatchGroup) {
  const values = [
    ...(group.identifier ? [group.identifier] : []),
    ...group.visibleIdentifiers,
  ];
  return new Set(values.map((code) => normalizeBarcode(code.value)));
}

function scoreLineGroup(line: CommerceInvoiceLine, group: CommerceBatchGroup) {
  const reasons: string[] = [];
  let score = 0;

  const invoiceCode = line.barcode?.value || line.supplierSku;
  if (invoiceCode) {
    const normalized = normalizeBarcode(invoiceCode);
    if (groupCodes(group).has(normalized)) {
      score = Math.max(score, 1);
      reasons.push("código exacto");
    }
  }

  const lineBrand = normalizeText(line.brand);
  const groupBrand = normalizeText(group.brand);
  if (lineBrand && groupBrand && lineBrand === groupBrand) {
    score += 0.18;
    reasons.push("marca");
  }

  const lineModel = normalizeText(line.model);
  const groupModel = normalizeText(group.model);
  if (lineModel && groupModel && lineModel === groupModel) {
    score += 0.28;
    reasons.push("modelo");
  }

  const description = [line.description, line.brand, line.model, line.supplierSku].filter(Boolean).join(" ");
  const identity = [group.name, group.brand, group.model].filter(Boolean).join(" ");
  const similarity = tokenScore(description, identity);
  if (similarity > 0) {
    score += similarity * 0.62;
    reasons.push(`cobertura factura ${Math.round(similarity * 100)}%`);
  }

  const normalizedDescription = normalizeText(description);
  const normalizedIdentity = normalizeText(identity);
  const lineTokens = tokens(description);
  const identityTokens = tokens(identity);
  const distinctiveMatch = Array.from(lineTokens).some((token) =>
    identityTokens.has(token)
    && /[a-z]/.test(token)
    && /\d/.test(token)
    && token.length >= 3,
  );
  if (distinctiveMatch) {
    score += 0.28;
    reasons.push("dato distintivo");
  }

  const lineWifi = /\bwifi\b/.test(normalizedDescription);
  const groupWifi = /\bwifi\b/.test(normalizedIdentity);
  if (lineWifi && groupWifi) {
    score += 0.2;
    reasons.push("familia WiFi");
  }
  const lineNetworkRole = /\b(adaptador|repetidor|receptor)\b/.test(normalizedDescription);
  const groupNetworkRole = /\b(adaptador|repetidor|receptor)\b/.test(normalizedIdentity);
  if (lineWifi && groupWifi && lineNetworkRole && groupNetworkRole) {
    const lineAdapter = /\badaptador\b/.test(normalizedDescription);
    const groupAdapter = /\badaptador\b/.test(normalizedIdentity);
    const lineRepeater = /\b(repetidor|receptor)\b/.test(normalizedDescription);
    const groupRepeater = /\b(repetidor|receptor)\b/.test(normalizedIdentity);
    if ((lineAdapter && groupAdapter) || (lineRepeater && groupRepeater)) {
      score += 0.18;
      reasons.push("tipo WiFi");
    }
  }
  const lineIsCable = /\bcable\b/.test(normalizedDescription);
  const groupIsCable = /\bcable\b/.test(normalizedIdentity);
  if (lineIsCable === groupIsCable && (lineIsCable || /\b(playstation|dualshock)\b/.test(normalizedDescription))) {
    score += 0.12;
    reasons.push("tipo de producto");
  }
  if (lineIsCable !== groupIsCable && /\bplaystation\b/.test(normalizedDescription) && /\bplaystation\b/.test(normalizedIdentity)) {
    score -= 0.28;
  }
  if (/\bplaystation\b/.test(normalizedDescription) && /\b(dualshock|playstation)\b/.test(normalizedIdentity)) {
    score += 0.2;
    reasons.push("familia PlayStation");
  }
  if (/\bla700\b/.test(normalizedDescription) && /\bla700\b/.test(normalizedIdentity)) {
    score += 0.3;
    reasons.push("modelo LA700");
  }
  if (/\bcargador\b/.test(normalizedDescription) && /\bcargador\b/.test(normalizedIdentity)) {
    const sameVehicleRole = /\bvehiculo\b/.test(normalizedDescription) && /\bvehiculo\b/.test(normalizedIdentity);
    const sameLaptopRole = /\blaptop\b/.test(normalizedDescription) && /\blaptop\b/.test(normalizedIdentity);
    if (sameVehicleRole || sameLaptopRole) {
      score += 0.3;
      reasons.push(sameVehicleRole ? "cargador de vehículo" : "cargador de notebook");
    }
  }
  if (/\blightning\b/.test(normalizedDescription) && /\blightning\b/.test(normalizedIdentity)) {
    score += 0.25;
    reasons.push("conector Lightning");
  }
  if (/\bheadset\b/.test(normalizedDescription) && /\bheadset\b/.test(normalizedIdentity)) {
    score += 0.2;
    reasons.push("familia auriculares");
  }

  return {
    score: Math.min(1, score),
    reasons,
  };
}

export async function recognizeCommerceInvoice(args: {
  bytes: Buffer;
  mimeType: string;
  spotName: string;
}) {
  const prompt = [
    "Sos el lector de facturas y comprobantes de compra de CLOUVA.",
    `Contexto: el comprobante pertenece al inventario del Spot "${args.spotName}" en Argentina.`,
    "Extraé exclusivamente información visible del documento. No inventes productos, códigos, precios ni impuestos.",
    "Separá cada renglón de producto comprado. No incluyas líneas puramente contables como subtotal/IVA/total dentro de lines.",
    "description debe conservar el texto útil del renglón para luego reconciliarlo con fotos de cajas/productos.",
    "Si el renglón muestra marca o modelo por separado, completalos; si no, dejalos vacíos.",
    "supplierSku es el código de artículo/SKU interno del proveedor si aparece.",
    "barcodeValue solo debe contener un EAN/UPC/barcode inequívoco y completo del renglón. Si no aparece, dejalo vacío.",
    "quantity debe ser la cantidad comprada del renglón. No la confundas con precio o código.",
    "unitPrice es precio unitario; lineTotal es total del renglón. Conservá importes numéricos sin símbolos.",
    "currency debe ser ARS, USD u otro ISO de 3 letras cuando pueda determinarse; si no, dejala vacía.",
    "issuedAt preferentemente en formato YYYY-MM-DD cuando la fecha sea inequívoca.",
    "documentType puede ser Factura A/B/C, Ticket, Remito, Nota de débito/crédito u otro texto visible.",
  ].join("\n");

  const generated = await generateGoogleCloudJson({
    model: process.env.GOOGLE_CLOUD_DOCUMENT_MODEL
      ?? process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
      ?? process.env.GEMINI_PRODUCT_VISION_MODEL
      ?? "gemini-2.5-flash",
    prompt,
    referenceImages: [{ mimeType: args.mimeType, data: args.bytes.toString("base64") }],
    responseJsonSchema: INVOICE_SCHEMA,
    temperature: 0,
    maxOutputTokens: 6000,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(generated.text);
  } catch {
    throw new Error("Google Cloud devolvió una factura que no se pudo interpretar.");
  }

  const root = record(parsed);
  const rawLines = Array.isArray(root.lines) ? root.lines : [];
  const lines = rawLines.flatMap((raw, index) => {
    const line = record(raw);
    const description = clean(line.description, 700);
    if (!description) return [];
    return [{
      lineNumber: Math.max(1, Math.floor(Number(line.lineNumber) || index + 1)),
      description,
      brand: clean(line.brand, 180),
      model: clean(line.model, 180),
      supplierSku: clean(line.supplierSku, 240),
      barcode: sanitizeIdentifier(line.barcodeValue, line.barcodeType),
      quantity: positive(line.quantity, 1),
      unitPrice: finiteOrNull(line.unitPrice),
      taxAmount: finiteOrNull(line.taxAmount),
      lineTotal: finiteOrNull(line.lineTotal),
    } satisfies CommerceInvoiceLine];
  });

  const recognition: CommerceInvoiceRecognition = {
    supplierName: clean(root.supplierName, 240),
    supplierTaxId: clean(root.supplierTaxId, 100),
    documentType: clean(root.documentType, 100),
    documentNumber: clean(root.documentNumber, 120),
    issuedAt: clean(root.issuedAt, 80),
    currency: clean(root.currency, 3).toUpperCase(),
    subtotal: finiteOrNull(root.subtotal),
    taxAmount: finiteOrNull(root.taxAmount),
    totalAmount: finiteOrNull(root.totalAmount),
    lines,
  };

  return {
    recognition,
    provider: generated.provider,
    model: generated.model,
    usage: generated.usage,
  };
}

export function reconcileCommerceInvoice(args: {
  invoice: CommerceInvoiceRecognition;
  groups: CommerceBatchGroup[];
}): CommerceInvoiceMatch[] {
  const reserved = new Set<string>();

  return args.invoice.lines.map((line) => {
    const target = Math.max(1, Math.round(line.quantity));
    const candidates = args.groups
      .map((group) => ({ group, ...scoreLineGroup(line, group) }))
      .filter((candidate) => candidate.score >= 0.34)
      .sort((a, b) => b.score - a.score);

    // Cada renglón representa una identidad comercial. La cantidad del
    // renglón no obliga a buscar N grupos visuales: una sola ficha/SKU puede
    // representar todas las unidades compradas.
    const selected = candidates
      .filter((candidate) => !reserved.has(candidate.group.groupKey))
      .slice(0, 1);

    const best = selected[0]?.score ?? 0;
    const second = candidates.find((candidate) => candidate.group.groupKey !== selected[0]?.group.groupKey)?.score ?? 0;
    const ambiguous = best > 0 && second >= best - 0.08 && best < 0.88 && target === 1;
    const strongSelected = selected.filter((candidate) => candidate.score >= (ambiguous ? 0.56 : 0.42));

    for (const candidate of strongSelected) reserved.add(candidate.group.groupKey);

    // The grouped photos represent the physical receipt. The invoice target is
    // only the expected quantity, so overages and shortages stay visible.
    const matchedQuantity = ambiguous
      ? 0
      : strongSelected.reduce(
          (sum, candidate) => sum + Math.max(1, Math.floor(candidate.group.unitCount || 1)),
          0,
        );
    const matchStatus: CommerceInvoiceMatch["matchStatus"] = ambiguous
      ? "ambiguous"
      : matchedQuantity >= target
        ? "matched"
        : matchedQuantity > 0
          ? "partial"
          : "unmatched";

    return {
      line,
      matchedGroupKeys: strongSelected.map((candidate) => candidate.group.groupKey),
      matchedQuantity,
      matchStatus,
      autoChecked: matchStatus === "matched" && matchedQuantity === target,
      confidence: strongSelected.length
        ? strongSelected.reduce((sum, candidate) => sum + candidate.score, 0) / strongSelected.length
        : 0,
      reasons: Array.from(new Set(strongSelected.flatMap((candidate) => candidate.reasons))),
    };
  });
}


export async function reconcileCommerceInvoiceWithAI(args: {
  invoice: CommerceInvoiceRecognition;
  groups: CommerceBatchGroup[];
}): Promise<CommerceInvoiceMatch[]> {
  const fallback = reconcileCommerceInvoice(args);
  if (!args.invoice.lines.length || !args.groups.length) return fallback;

  const prompt = [
    "Sos el reconciliador de recepción de mercadería de CLOUVA.",
    "Tenés renglones de una factura y productos ya agrupados desde fotos. Debés decidir qué producto agrupado corresponde a cada renglón.",
    "Usá significado comercial, marca, modelo, conectores, cantidades y códigos. La descripción de factura puede estar abreviada.",
    "REGLA FUERTE: un groupKey solo puede pertenecer a UN renglón de factura.",
    "REGLA FUERTE: no uses un cable PS4 para cubrir el renglón PS4 si existe un producto controlador/joystick y además hay un renglón separado Cable PS4.",
    "REGLA FUERTE: códigos EAN/UPC exactos y modelos exactos pesan más que similitud de palabras.",
    "No fuerces coincidencias incompatibles. Pero recordá que el proveedor usa abreviaturas muy cortas: compará por significado y por el conjunto completo de renglones, no solo por coincidencia literal.",
    "Hacé asignación global uno-a-uno: si una línea abreviada no muestra la marca/modelo del packaging, usá categoría, conectores, resto de líneas y productos todavía no asignados para resolverla cuando sea claro.",
    "No devuelvas groupKeys vacío solo porque la descripción de factura sea abreviada si hay una identidad comercial compatible y única en el conjunto.",
    "La factura indica la cantidad ESPERADA; group.unitCount indica la cantidad FÍSICA detectada. Puede haber faltantes o extras y no debés ocultarlos.",
    "Tu tarea acá es asignar identidad, no fabricar coincidencia de cantidades. Un groupKey puede tener unitCount mayor o menor al renglón de factura.",
    "Solo devolvé varios groupKeys para un renglón cuando sean fragmentos/vistas de la MISMA identidad comercial que todavía no quedaron consolidados.",
    `Factura: ${JSON.stringify(args.invoice.lines.map((line) => ({
      lineNumber: line.lineNumber,
      description: line.description,
      brand: line.brand,
      model: line.model,
      supplierSku: line.supplierSku,
      barcode: line.barcode,
      quantity: line.quantity,
    })))}`,
    `Productos agrupados: ${JSON.stringify(args.groups.map((group) => ({
      groupKey: group.groupKey,
      name: group.name,
      brand: group.brand,
      model: group.model,
      unitCount: group.unitCount,
      identifier: group.identifier,
      visibleIdentifiers: group.visibleIdentifiers,
    })))}`,
  ].join("\n");

  try {
    const generated = await generateGoogleCloudJson({
      model: process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
        ?? process.env.GEMINI_PRODUCT_VISION_MODEL
        ?? "gemini-2.5-flash",
      prompt,
      responseJsonSchema: INVOICE_MATCH_SCHEMA,
      temperature: 0,
      maxOutputTokens: 4000,
    });

    const root = record(JSON.parse(generated.text));
    const rawMatches = Array.isArray(root.matches) ? root.matches : [];
    const groupByKey = new Map(args.groups.map((group) => [group.groupKey, group]));
    const aiByLine = new Map<number, { keys: string[]; confidence: number; reasons: string[] }>();

    for (const raw of rawMatches) {
      const item = record(raw);
      const lineNumber = Math.floor(Number(item.lineNumber));
      if (!Number.isInteger(lineNumber)) continue;
      const keys = Array.from(new Set(
        (Array.isArray(item.groupKeys) ? item.groupKeys : [])
          .filter((key): key is string => typeof key === "string" && groupByKey.has(key)),
      ));
      aiByLine.set(lineNumber, {
        keys,
        confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
        reasons: (Array.isArray(item.reasons) ? item.reasons : [])
          .filter((reason): reason is string => typeof reason === "string")
          .map((reason) => reason.trim())
          .filter(Boolean)
          .slice(0, 6),
      });
    }

    const finalUsed = new Set<string>();
    return args.invoice.lines.map((line, index) => {
      const ai = aiByLine.get(line.lineNumber);
      const aiKeys = (ai?.keys ?? []).filter((key) => !finalUsed.has(key));
      const fallbackMatch = fallback[index];
      const fallbackKeys = fallbackMatch.matchedGroupKeys.filter((key) => !finalUsed.has(key));

      // Un resultado vacío de la IA no puede borrar una coincidencia
      // determinística válida. Primero usamos la asignación semántica de IA
      // cuando realmente eligió un producto; si no, recuperamos el matcher local.
      const selectedKeys = aiKeys.length ? aiKeys : fallbackKeys;
      for (const key of selectedKeys) finalUsed.add(key);

      const target = Math.max(1, Math.round(line.quantity));
      const matchedQuantity = selectedKeys.reduce(
        (sum, key) => sum + Math.max(1, Math.floor(groupByKey.get(key)?.unitCount || 1)),
        0,
      );
      const matchStatus: CommerceInvoiceMatch["matchStatus"] = selectedKeys.length
        ? matchedQuantity >= target
          ? "matched"
          : "partial"
        : (fallbackMatch.matchStatus === "ambiguous" ? "ambiguous" : "unmatched");
      const confidence = aiKeys.length
        ? (ai?.confidence ?? 0)
        : selectedKeys.length
          ? fallbackMatch.confidence
          : Math.max(ai?.confidence ?? 0, fallbackMatch.confidence);

      return {
        line,
        matchedGroupKeys: selectedKeys,
        matchedQuantity,
        matchStatus,
        autoChecked: matchStatus === "matched"
          && matchedQuantity === target
          && (aiKeys.length ? confidence >= 0.82 : true),
        confidence,
        reasons: aiKeys.length
          ? (ai?.reasons.length ? ai.reasons : ["reconciliación semántica"])
          : selectedKeys.length
            ? fallbackMatch.reasons
            : (ai?.reasons.length ? ai.reasons : fallbackMatch.reasons),
      };
    });
  } catch {
    return fallback;
  }
}
