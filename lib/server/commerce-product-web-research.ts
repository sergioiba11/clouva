import "server-only";

import type { CommerceProductRecognition } from "@/lib/commerce/product-recognition";
import {
  generateGoogleCloudGroundedText,
  generateGoogleCloudJson,
} from "@/lib/server/google-cloud-genai";

type ResearchIdentifier = {
  value: string;
  type: string;
};

export type CommerceExtraProductResearch = {
  verified: boolean;
  name: string;
  brand: string;
  productModel: string;
  category: string;
  description: string;
  evidenceSummary: string;
  confidence: number;
  provider: "google_vertex_ai";
  modelName: string;
  groundingMetadata: Record<string, unknown> | null;
};

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    verified: {
      type: "boolean",
      description: "True solo cuando la identidad comercial está sustentada por la evidencia visual/textual y la búsqueda web.",
    },
    name: {
      type: "string",
      description: "Nombre comercial concreto del artículo físico. Debe describir qué producto es, no solo una plataforma o compatibilidad.",
    },
    brand: {
      type: "string",
      description: "Marca confirmada. Vacío si no puede confirmarse.",
    },
    productModel: {
      type: "string",
      description: "Modelo o referencia comercial confirmada. Vacío si no puede confirmarse.",
    },
    category: {
      type: "string",
      description: "Categoría breve y concreta de inventario.",
    },
    description: {
      type: "string",
      description: "Descripción factual breve del producto confirmado.",
    },
    evidenceSummary: {
      type: "string",
      description: "Resumen corto de qué señales permitieron resolver la identidad.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confianza de la identidad resultante.",
    },
  },
  required: [
    "verified",
    "name",
    "brand",
    "productModel",
    "category",
    "description",
    "evidenceSummary",
    "confidence",
  ],
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function score(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

export async function researchCommerceExtraProduct(args: {
  spotName: string;
  recognition: CommerceProductRecognition;
  groupName: string;
  groupBrand: string;
  groupModel: string;
  identifiers: ResearchIdentifier[];
}): Promise<CommerceExtraProductResearch> {
  const identifiers = Array.from(new Map(
    args.identifiers
      .filter((identifier) => identifier.value.trim())
      .map((identifier) => [
        `${identifier.type}:${identifier.value.replace(/\s/g, "").toUpperCase()}`,
        { type: identifier.type, value: identifier.value.trim() },
      ]),
  ).values());

  const evidence = {
    groupedName: args.groupName,
    groupedBrand: args.groupBrand,
    groupedModel: args.groupModel,
    detectedObject: args.recognition.detectedObject,
    visualName: args.recognition.name,
    visualBrand: args.recognition.brand,
    visualCategory: args.recognition.category,
    visualDescription: args.recognition.description,
    presentation: args.recognition.presentation,
    color: args.recognition.color,
    size: args.recognition.size,
    visibleText: args.recognition.visibleText,
    identifiers,
  };

  const prompt = [
    "Sos el investigador de identidad de mercadería de CLOUVA.",
    `Contexto: se está recibiendo mercadería física en el Spot "${args.spotName}" y este objeto fue confirmado como un artículo EXTRA que no figura como renglón propio en la factura.`,
    "Tu tarea es identificar con precisión QUÉ ARTÍCULO FÍSICO ES antes de crear su ficha de catálogo.",
    "Usá Google Search como fuente de verificación externa. Priorizá primero cualquier EAN, UPC, Code 128, modelo, SKU de fabricante o texto distintivo visible; buscá códigos exactos cuando existan.",
    "Contrastá la búsqueda con las fotos y textos recibidos. Un resultado web que no coincide con el objeto físico no sirve.",
    "No confundas compatibilidad con identidad. Ejemplo obligatorio: que un envase diga PS4 NO significa que el producto sea una consola PlayStation 4; puede ser un cable, joystick, cargador, receptor, soporte u otro accesorio compatible con PS4.",
    "El nombre final debe indicar el tipo de artículo real y, cuando esté sustentado, marca/modelo/compatibilidad. Evitá nombres vagos como 'PS4', 'Samsung' o 'USB'.",
    "No inventes marca, modelo ni especificaciones. Si la web no permite confirmar un campo, dejalo vacío.",
    "No busques ni devuelvas precio, costo, stock, disponibilidad ni vendedor. Esta búsqueda es solo para identidad de catálogo.",
    "verified=true requiere que la identidad esté respaldada tanto por la evidencia del objeto como por información web coherente. Si solo encontrás productos parecidos, verified=false.",
    `Evidencia disponible: ${JSON.stringify(evidence)}`,
  ].join("\n");

  const model = process.env.GOOGLE_CLOUD_PRODUCT_RESEARCH_MODEL
    ?? process.env.GOOGLE_CLOUD_PRODUCT_VISION_MODEL
    ?? process.env.GEMINI_PRODUCT_VISION_MODEL
    ?? "gemini-2.5-flash";

  // Search grounding and schema-constrained JSON are intentionally separate.
  // Gemini 2.5 can ground with Google Search reliably, while structured output
  // with built-in tools is model-dependent. First gather grounded evidence,
  // then normalize that evidence into CLOUVA's catalog contract.
  const grounded = await generateGoogleCloudGroundedText({
    model,
    prompt: [
      prompt,
      "Respondé con una investigación factual breve. Incluí el nombre más preciso que puedas sustentar y explicá qué señales lo respaldan.",
      "No devuelvas JSON en esta etapa.",
    ].join("\n"),
    temperature: 0.05,
    maxOutputTokens: 2200,
  });

  const generated = await generateGoogleCloudJson({
    model,
    prompt: [
      "Convertí la investigación fundamentada de Google Search al contrato JSON de identidad de producto de CLOUVA.",
      "No agregues ningún dato que no esté sustentado por la investigación o por la evidencia visual original.",
      "verified=true solo si la investigación distingue inequívocamente el tipo de artículo físico. Si hay duda entre categorías distintas, usá verified=false.",
      `Evidencia visual original: ${JSON.stringify(evidence)}`,
      `Investigación fundamentada: ${grounded.text}`,
    ].join("\n"),
    responseJsonSchema: RESEARCH_SCHEMA,
    temperature: 0.05,
    maxOutputTokens: 1800,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(generated.text);
  } catch {
    throw new Error("Google Search devolvió una investigación de producto que CLOUVA no pudo interpretar.");
  }

  const raw = record(parsed);
  const name = cleanText(raw.name, 180);
  const verified = raw.verified === true && Boolean(name);

  return {
    verified,
    name,
    brand: cleanText(raw.brand, 120),
    productModel: cleanText(raw.productModel, 140),
    category: cleanText(raw.category, 120),
    description: cleanText(raw.description, 1200),
    evidenceSummary: cleanText(raw.evidenceSummary, 600),
    confidence: score(raw.confidence),
    provider: grounded.provider,
    modelName: grounded.model,
    groundingMetadata: grounded.groundingMetadata,
  };
}
