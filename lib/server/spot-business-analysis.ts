import "server-only";

import {
  sanitizeSpotBusinessAnalysis,
  SPOT_MODULES,
  type SpotBusinessAnalysis,
} from "@/lib/commerce/spot-business";

type BusinessImage = { dataUrl: string; label?: string };
type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: Record<string, unknown>;
  error?: { message?: string };
};

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    businessType: { type: "string" },
    businessCategories: { type: "array", items: { type: "string" } },
    suggestedModules: { type: "array", items: { type: "string", enum: [...SPOT_MODULES] } },
    suggestedProductAttributes: { type: "array", items: { type: "string" } },
    suggestedServiceAttributes: { type: "array", items: { type: "string" } },
    suggestedInventoryMode: { type: "string", enum: ["none", "simple", "variants", "locations"] },
    suggestedSalesChannels: { type: "array", items: { type: "string" } },
    suggestedBrandTone: { type: "string" },
    suggestedDescription: { type: "string" },
    suggestedColorDirection: { type: "string" },
    suggestedHomeSections: { type: "array", items: { type: "string" } },
  },
  required: [
    "businessType",
    "businessCategories",
    "suggestedModules",
    "suggestedProductAttributes",
    "suggestedServiceAttributes",
    "suggestedInventoryMode",
    "suggestedSalesChannels",
    "suggestedBrandTone",
    "suggestedDescription",
    "suggestedColorDirection",
    "suggestedHomeSections",
  ],
} as const;

export class SpotBusinessAnalysisError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseImage(image: BusinessImage, index: number) {
  const match = image.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new SpotBusinessAnalysisError(`La imagen ${index + 1} no tiene un formato válido.`, 400);
  const mimeType = match[1].toLowerCase();
  if (!ACCEPTED_MIME_TYPES.has(mimeType)) throw new SpotBusinessAnalysisError("Usá imágenes JPG, PNG o WEBP.", 400);
  const data = match[2].replace(/\s/g, "");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new SpotBusinessAnalysisError(`La imagen ${index + 1} supera 4 MB.`, 413);
  return { mimeType, data, label: short(image.label, 40) || `Referencia ${index + 1}` };
}

function prompt(args: {
  name: string;
  description: string;
  intent: string;
  country: string;
  website: string;
  social: string;
}) {
  return [
    "Sos el configurador de negocios de MI SPOT dentro de CLOUVA.",
    "Tu tarea es entender qué negocio tiene la persona y recomendar una configuración inicial del mismo Core comercial.",
    "No asumas que la persona es artista, productor o creador. Puede ser barbería, ferretería, local, marca, restaurante, servicio técnico, estudio, sello o cualquier emprendimiento.",
    `Nombre: ${args.name || "sin definir"}.`,
    `Qué quiere hacer: ${args.intent || "sin opción preseleccionada"}.`,
    `Descripción libre: ${args.description}.`,
    `País: ${args.country || "AR"}.`,
    args.website ? `Website aportado por el usuario: ${args.website}. No navegues ni inventes contenido del sitio.` : "",
    args.social ? `Social aportado por el usuario: ${args.social}. No navegues ni inventes contenido del perfil.` : "",
    "Elegí solo módulos de la lista permitida. No inventes funcionalidades fuera del schema.",
    "Si vende productos físicos, sugerí products/catalog, inventory, scanner/codes y sales/orders cuando corresponda.",
    "Si ofrece servicios, sugerí services y bookings, más customers/finance cuando corresponda.",
    "Si es un Estudio o artista con merch, combiná commerce con content; no lo fuerces si no aplica.",
    "La descripción sugerida debe ser concreta y editable. El tono y color son recomendaciones de marca, nunca decisiones irreversibles.",
    "No generes precios, saldos, pagos, permisos, propietarios ni datos financieros. Gemini solamente recomienda configuración.",
    "Respondé en español salvo businessType, que debe ser un slug semántico breve en inglés o snake_case.",
  ].filter(Boolean).join("\n");
}

export async function analyzeSpotBusiness(args: {
  name?: string;
  description: string;
  intent?: string;
  country?: string;
  website?: string;
  social?: string;
  images?: BusinessImage[];
}): Promise<{ analysis: SpotBusinessAnalysis; model: string; usage: Record<string, unknown> | null }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new SpotBusinessAnalysisError("GEMINI_API_KEY no está configurada.", 500);
  const description = short(args.description, 2400);
  if (description.length < 4) throw new SpotBusinessAnalysisError("Contanos brevemente qué negocio querés armar.", 400);

  const images = (args.images ?? []).slice(0, MAX_IMAGES).map(parseImage);
  const model = process.env.GEMINI_SPOT_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
  const parts: Array<Record<string, unknown>> = [{
    text: prompt({
      name: short(args.name, 160),
      description,
      intent: short(args.intent, 120),
      country: short(args.country, 8).toUpperCase(),
      website: short(args.website, 300),
      social: short(args.social, 300),
    }),
  }];
  for (const image of images) {
    parts.push({ text: `Referencia visual opcional: ${image.label}. Usala solo para inferir estilo/categoría visible, no identidad privada.` });
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 2400,
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_SCHEMA,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(40_000),
  });

  const raw = await response.text();
  let payload: GeminiPayload = {};
  try {
    payload = raw ? JSON.parse(raw) as GeminiPayload : {};
  } catch {
    throw new SpotBusinessAnalysisError("Gemini devolvió una respuesta inválida.");
  }
  if (!response.ok) {
    throw new SpotBusinessAnalysisError(payload.error?.message ?? `Gemini respondió HTTP ${response.status}`, response.status);
  }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new SpotBusinessAnalysisError("Gemini no devolvió una configuración para el Spot.", 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SpotBusinessAnalysisError("No se pudo interpretar la configuración de Gemini.");
  }

  return {
    analysis: sanitizeSpotBusinessAnalysis(parsed),
    model,
    usage: payload.usageMetadata ?? null,
  };
}
