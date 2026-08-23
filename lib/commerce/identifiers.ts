const DIGITS = /^\d+$/;

export type CommerceIdentifierType =
  | "ean_13"
  | "ean_8"
  | "upc_a"
  | "upc_e"
  | "code_128"
  | "clouva_barcode"
  | "clouva_qr"
  | "sku";

export function normalizeCommerceIdentifier(value: string) {
  return value.trim().replace(/[\s-]+/g, "").toUpperCase();
}

export function gtinCheckDigit(valueWithoutCheck: string) {
  if (!DIGITS.test(valueWithoutCheck)) throw new Error("El GTIN solo puede contener números.");
  const digits = [...valueWithoutCheck].reverse().map(Number);
  const sum = digits.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

export function isValidGtin(value: string) {
  if (!DIGITS.test(value) || ![8, 12, 13].includes(value.length)) return false;
  return gtinCheckDigit(value.slice(0, -1)) === value.at(-1);
}

export function detectCommerceIdentifierType(raw: string): CommerceIdentifierType {
  const value = normalizeCommerceIdentifier(raw);
  if (/^HTTPS?:\/\//i.test(raw.trim()) || value.startsWith("CLOUVA:QR:")) return "clouva_qr";
  if (DIGITS.test(value)) {
    if (value.length === 13) return "ean_13";
    if (value.length === 8) return "ean_8";
    if (value.length === 12) return "upc_a";
    if ([6, 7, 8].includes(value.length)) return "upc_e";
  }
  if (value.startsWith("CLV")) return "clouva_barcode";
  if (/^[A-Z0-9]+(?:[-_.][A-Z0-9]+)+$/.test(value)) return "sku";
  return "code_128";
}

export function validateCommerceIdentifier(type: CommerceIdentifierType, raw: string) {
  const value = normalizeCommerceIdentifier(raw);
  if (!value) return { valid: false, error: "Ingresá o escaneá un código." } as const;
  if (type === "ean_13" && (value.length !== 13 || !isValidGtin(value))) {
    return { valid: false, error: "El EAN-13 no tiene un dígito verificador válido." } as const;
  }
  if (type === "ean_8" && (value.length !== 8 || !isValidGtin(value))) {
    return { valid: false, error: "El EAN-8 no tiene un dígito verificador válido." } as const;
  }
  if (type === "upc_a" && (value.length !== 12 || !isValidGtin(value))) {
    return { valid: false, error: "El UPC-A no tiene un dígito verificador válido." } as const;
  }
  if (type === "upc_e" && (!DIGITS.test(value) || ![6, 7, 8].includes(value.length))) {
    return { valid: false, error: "El UPC-E no tiene un formato válido." } as const;
  }
  if (value.length > 512) return { valid: false, error: "El código es demasiado largo." } as const;
  return { valid: true, value } as const;
}

function cleanSkuPart(value: string, fallback: string, max = 8) {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, max);
  return cleaned || fallback;
}

export function buildSpotSku(args: {
  spotSlug: string;
  productName: string;
  color?: string | null;
  size?: string | null;
  suffix?: string | null;
}) {
  const spot = cleanSkuPart(args.spotSlug, "SPOT", 4);
  const productWords = args.productName.split(/\s+/).filter(Boolean);
  const product = productWords.length > 1
    ? productWords.map((word) => cleanSkuPart(word, "", 1)).join("").slice(0, 5)
    : cleanSkuPart(args.productName, "ITEM", 5);
  const parts = [spot, product || "ITEM"];
  if (args.color) parts.push(cleanSkuPart(args.color, "CLR", 4));
  if (args.size) parts.push(cleanSkuPart(args.size, "UNI", 4));
  if (args.suffix) parts.push(cleanSkuPart(args.suffix, "", 6));
  return parts.filter(Boolean).join("-");
}

export function buildClouvaBarcodeValue(sequence: string) {
  const normalized = sequence.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(-18);
  return `CLV${normalized.padStart(18, "0")}`;
}

export function buildClouvaQrUrl(siteUrl: string, identifierId: string) {
  return `${siteUrl.replace(/\/$/, "")}/q/${encodeURIComponent(identifierId)}`;
}

