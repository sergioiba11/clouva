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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "de", "del", "la", "las", "el", "los", "y", "con", "sin", "para", "por", "un", "una",
  "unidad", "unidades", "uni", "u", "art", "articulo", "producto", "caja", "pack",
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
  return intersection / Math.max(left.size, right.size);
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
    reasons.push(`texto ${Math.round(similarity * 100)}%`);
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

    const selected: typeof candidates = [];
    for (const candidate of candidates) {
      if (reserved.has(candidate.group.groupKey)) continue;
      if (selected.length >= target) break;
      selected.push(candidate);
    }

    const best = selected[0]?.score ?? 0;
    const second = candidates.find((candidate) => candidate.group.groupKey !== selected[0]?.group.groupKey)?.score ?? 0;
    const ambiguous = best > 0 && second >= best - 0.08 && best < 0.88 && target === 1;
    const strongSelected = selected.filter((candidate) => candidate.score >= (ambiguous ? 0.56 : 0.42));

    for (const candidate of strongSelected) reserved.add(candidate.group.groupKey);

    const matchedQuantity = strongSelected.length;
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
      autoChecked: matchStatus === "matched",
      confidence: strongSelected.length
        ? strongSelected.reduce((sum, candidate) => sum + candidate.score, 0) / strongSelected.length
        : 0,
      reasons: Array.from(new Set(strongSelected.flatMap((candidate) => candidate.reasons))),
    };
  });
}
