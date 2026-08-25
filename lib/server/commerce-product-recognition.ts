import "server-only";

import {
  sanitizeCommerceProductRecognition,
  type CommerceProductRecognition,
} from "@/lib/commerce/product-recognition";
import {
  type CommerceIdentifierType,
  validateCommerceIdentifier,
} from "@/lib/commerce/identifiers";
import {
  canonicalProductCaptureLabel,
  countProductCaptureLabels,
  MAX_PRODUCT_DETAIL_IMAGES,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_REFERENCE_IMAGES,
  MAX_PRODUCT_TOTAL_BYTES,
  orderProductCaptures,
  type ProductCaptureLabel,
} from "@/lib/commerce/product-capture-contract";

type RecognitionImage = { dataUrl: string; label?: unknown };
type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: Record<string, unknown>;
  error?: { message?: string };
};

const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    detectedObject: { type: "string", description: "Objeto físico principal visible." },
    name: { type: "string", description: "Nombre comercial completo sustentado por el envase y texto visible." },
    brand: { type: "string", description: "Marca visible; vacío si no puede leerse con seguridad." },
    category: { type: "string", description: "Categoría de inventario breve y concreta." },
    description: { type: "string", description: "Descripción factual del producto y su presentación, sin inventar atributos." },
    productKind: { type: "string", enum: ["physical", "avatar_item", "bundle", "digital"] },
    listingKind: { type: "string", enum: ["resale", "owned_design", "avatar", "combo"] },
    size: { type: "string", description: "Talle o tamaño de variante visible; vacío si no corresponde." },
    color: { type: "string", description: "Color de variante o producto visible; vacío si no corresponde." },
    presentation: { type: "string", description: "Contenido neto, cantidad, sabor, modelo o formato de presentación visible." },
    identifier: {
      type: "object",
      properties: {
        value: { type: "string", description: "Código completo leído exactamente; vacío si no es inequívoco." },
        type: { type: "string", enum: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku"] },
      },
      required: ["value", "type"],
    },
    visibleText: { type: "array", items: { type: "string" }, description: "Textos relevantes legibles en el producto." },
    uncertainFields: { type: "array", items: { type: "string" }, description: "Campos que necesitan confirmación humana." },
    confidence: {
      type: "object",
      properties: {
        overall: { type: "number", minimum: 0, maximum: 1 },
        identity: { type: "number", minimum: 0, maximum: 1 },
        variant: { type: "number", minimum: 0, maximum: 1 },
        identifier: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["overall", "identity", "variant", "identifier"],
    },
  },
  required: [
    "detectedObject", "name", "brand", "category", "description", "productKind",
    "listingKind", "size", "color", "presentation", "identifier", "visibleText",
    "uncertainFields", "confidence",
  ],
} as const;

export class CommerceProductRecognitionError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function inferredLabel(index: number): ProductCaptureLabel {
  return index === 0 ? "Frente" : index === 1 ? "Atrás" : "Detalle";
}

function parseImage(image: RecognitionImage, index: number) {
  const label = canonicalProductCaptureLabel(image.label ?? inferredLabel(index));
  if (!label) throw new CommerceProductRecognitionError(`La foto ${index + 1} no tiene una vista válida.`, 400);
  const match = image.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new CommerceProductRecognitionError(`La foto ${index + 1} no tiene un formato válido.`, 400);
  const mimeType = match[1].toLowerCase();
  if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
    throw new CommerceProductRecognitionError("Usá fotos JPG, PNG o WEBP.", 400);
  }
  const data = match[2].replace(/\s/g, "");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > MAX_PRODUCT_IMAGE_BYTES) {
    throw new CommerceProductRecognitionError(`La foto ${index + 1} supera el máximo de 5 MB.`, 413);
  }
  return {
    mimeType,
    data,
    byteLength: bytes.length,
    label,
  };
}

function buildPrompt(args: {
  spotName: string;
  suppliedIdentifier?: { value: string; type: CommerceIdentifierType } | null;
  imageLabels: string[];
}) {
  return [
    "Sos el analizador visual de productos físicos de CLOUVA.",
    `Contexto: el producto se está cargando en el Spot \"${args.spotName}\" en Argentina.`,
    `Imágenes recibidas en orden: ${args.imageLabels.join(", ")}. Todas pertenecen al mismo producto físico.`,
    "Las vistas canónicas son Frente (cara principal), Atrás (cara posterior) y uno o varios Detalles complementarios. Si llega una captura histórica llamada Dorso, interpretala exactamente como Atrás.",
    "Combiná la evidencia de TODAS las vistas: usá Frente para identidad comercial, Atrás para información posterior/códigos y cada Detalle para confirmar variante, materiales, presentación, branding y textos pequeños cuando sean legibles.",
    "Cuando haya varios Detalles, tratá cada uno como evidencia complementaria del mismo objeto; no los interpretes como productos o variantes distintos.",
    args.suppliedIdentifier
      ? `Código ya leído por el escáner: ${args.suppliedIdentifier.type} ${args.suppliedIdentifier.value}. Es una fuente confirmada y prioritaria: conservá exactamente ese código en identifier.`
      : "No hay un código confirmado. Solo devolvé identifier si podés leer el valor completo e inequívoco en alguna de las imágenes.",
    "Identificá el objeto, leé el envase y devolvé una ficha comercial editable.",
    "Usá exclusivamente evidencia visible. No inventes marca, modelo, sabor, cantidad, material, beneficios, fabricante ni procedencia.",
    "No inventes costo, precio de venta, stock ni disponibilidad: esos datos no forman parte de la respuesta.",
    "Para mercadería comercial, listingKind debe ser resale. Solo usá owned_design si la imagen demuestra que es un diseño propio de CLOUVA/El Iglú.",
    "La descripción debe ser breve, factual y útil para un catálogo. Escribí en español.",
    "Los campos que no puedan confirmarse deben ir vacíos y además figurar en uncertainFields.",
    "Los valores de confidence van de 0 a 1. identifier requiere exactitud carácter por carácter.",
  ].join("\n");
}

export async function recognizeCommerceProduct(args: {
  images: RecognitionImage[];
  spotName: string;
  suppliedIdentifier?: { value: string; type: CommerceIdentifierType } | null;
}): Promise<{
  recognition: CommerceProductRecognition;
  model: string;
  usage: Record<string, unknown> | null;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new CommerceProductRecognitionError("GEMINI_API_KEY no está configurada.", 500);
  if (!Array.isArray(args.images) || args.images.length < 1) {
    throw new CommerceProductRecognitionError("Capturá al menos el Frente del producto.", 400);
  }
  if (args.images.length > MAX_PRODUCT_REFERENCE_IMAGES) {
    throw new CommerceProductRecognitionError(`Podés analizar hasta ${MAX_PRODUCT_REFERENCE_IMAGES} referencias por producto.`, 400);
  }

  const images = orderProductCaptures(args.images.map(parseImage));
  const counts = countProductCaptureLabels(images.map((image) => image.label));
  if (counts.front !== 1) {
    throw new CommerceProductRecognitionError("El análisis necesita exactamente un Frente del producto.", 400);
  }
  if (counts.back > 1) {
    throw new CommerceProductRecognitionError("Podés usar como máximo una vista Atrás.", 400);
  }
  if (counts.detail > MAX_PRODUCT_DETAIL_IMAGES) {
    throw new CommerceProductRecognitionError(`Podés usar hasta ${MAX_PRODUCT_DETAIL_IMAGES} imágenes de Detalle.`, 400);
  }

  const totalBytes = images.reduce((sum, image) => sum + image.byteLength, 0);
  if (totalBytes > MAX_PRODUCT_TOTAL_BYTES) {
    throw new CommerceProductRecognitionError("Las fotos juntas superan el máximo de 24 MB.", 413);
  }

  let suppliedIdentifier = args.suppliedIdentifier ?? null;
  if (suppliedIdentifier) {
    const validation = validateCommerceIdentifier(suppliedIdentifier.type, suppliedIdentifier.value);
    suppliedIdentifier = validation.valid
      ? { value: validation.value, type: suppliedIdentifier.type }
      : null;
  }

  let detailIndex = 0;
  const labeledImages = images.map((image) => ({
    ...image,
    displayLabel: image.label === "Detalle" ? `Detalle ${++detailIndex}` : image.label,
  }));

  const model = process.env.GEMINI_PRODUCT_VISION_MODEL
    ?? process.env.GEMINI_MODEL
    ?? "gemini-3.5-flash";
  const parts: Array<Record<string, unknown>> = [
    { text: buildPrompt({ spotName: args.spotName, suppliedIdentifier, imageLabels: labeledImages.map((image) => image.displayLabel) }) },
    ...labeledImages.flatMap((image) => [
      { text: `Vista: ${image.displayLabel}` },
      { inlineData: { mimeType: image.mimeType, data: image.data } },
    ]),
  ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2200,
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_SCHEMA,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
    },
  );

  const raw = await response.text();
  let payload: GeminiPayload = {};
  try {
    payload = raw ? JSON.parse(raw) as GeminiPayload : {};
  } catch {
    throw new CommerceProductRecognitionError("Gemini devolvió una respuesta inválida.");
  }
  if (!response.ok) {
    throw new CommerceProductRecognitionError(
      payload.error?.message ?? `Gemini respondió HTTP ${response.status}`,
      response.status,
    );
  }
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) {
    const reason = payload.candidates?.[0]?.finishReason;
    throw new CommerceProductRecognitionError(
      reason ? `Gemini terminó sin una ficha (${reason}).` : "Gemini no devolvió una ficha del producto.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CommerceProductRecognitionError("No se pudo interpretar la ficha de Gemini.");
  }
  const recognition = sanitizeCommerceProductRecognition(parsed);
  if (suppliedIdentifier) {
    recognition.identifier = suppliedIdentifier;
    recognition.confidence.identifier = 1;
  }
  if (!recognition.detectedObject && !recognition.name) {
    throw new CommerceProductRecognitionError("Gemini no pudo identificar un producto en las fotos.", 422);
  }

  return { recognition, model, usage: payload.usageMetadata ?? null };
}
