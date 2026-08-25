import {
  detectCommerceIdentifierType,
  type CommerceIdentifierType,
  validateCommerceIdentifier,
} from "@/lib/commerce/identifiers";

export type CommerceRecognitionConfidence = {
  overall: number;
  identity: number;
  variant: number;
  identifier: number;
};

export type CommerceProductRecognition = {
  detectedObject: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  productKind: "physical" | "avatar_item" | "bundle" | "digital";
  listingKind: "resale" | "owned_design" | "avatar" | "combo";
  size: string;
  color: string;
  presentation: string;
  identifier: { value: string; type: CommerceIdentifierType } | null;
  visibleText: string[];
  uncertainFields: string[];
  confidence: CommerceRecognitionConfidence;
};

const PRODUCT_KINDS = new Set<CommerceProductRecognition["productKind"]>([
  "physical",
  "avatar_item",
  "bundle",
  "digital",
]);
const LISTING_KINDS = new Set<CommerceProductRecognition["listingKind"]>([
  "resale",
  "owned_design",
  "avatar",
  "combo",
]);
const IDENTIFIER_TYPES = new Set<CommerceIdentifierType>([
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "clouva_barcode",
  "clouva_qr",
  "sku",
]);

function stringValue(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function score(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function stringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => stringValue(item, maxLength))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function identifierValue(raw: Record<string, unknown>, confidence: number) {
  const value = stringValue(raw.value, 512);
  if (!value || confidence < 0.85) return null;
  const requestedType = stringValue(raw.type, 32) as CommerceIdentifierType;
  const type = IDENTIFIER_TYPES.has(requestedType)
    ? requestedType
    : detectCommerceIdentifierType(value);
  const validation = validateCommerceIdentifier(type, value);
  return validation.valid ? { value: validation.value, type } : null;
}

export function sanitizeCommerceProductRecognition(value: unknown): CommerceProductRecognition {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawConfidence = raw.confidence && typeof raw.confidence === "object"
    ? raw.confidence as Record<string, unknown>
    : {};
  const confidence: CommerceRecognitionConfidence = {
    overall: score(rawConfidence.overall),
    identity: score(rawConfidence.identity),
    variant: score(rawConfidence.variant),
    identifier: score(rawConfidence.identifier),
  };
  const productKind = stringValue(raw.productKind, 32) as CommerceProductRecognition["productKind"];
  const listingKind = stringValue(raw.listingKind, 32) as CommerceProductRecognition["listingKind"];
  const rawIdentifier = raw.identifier && typeof raw.identifier === "object"
    ? raw.identifier as Record<string, unknown>
    : {};

  return {
    detectedObject: stringValue(raw.detectedObject, 160),
    name: stringValue(raw.name, 180),
    brand: stringValue(raw.brand, 120),
    category: stringValue(raw.category, 120),
    description: stringValue(raw.description, 1200),
    productKind: PRODUCT_KINDS.has(productKind) ? productKind : "physical",
    listingKind: LISTING_KINDS.has(listingKind) ? listingKind : "resale",
    size: stringValue(raw.size, 80),
    color: stringValue(raw.color, 80),
    presentation: stringValue(raw.presentation, 160),
    identifier: identifierValue(rawIdentifier, confidence.identifier),
    visibleText: stringArray(raw.visibleText, 24, 180),
    uncertainFields: stringArray(raw.uncertainFields, 20, 80),
    confidence,
  };
}
