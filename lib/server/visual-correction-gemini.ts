import "server-only";

import type { GeminiReferenceImage } from "@/lib/gemini-image";
import type { LayoutConfig } from "./layout-config";
import { callGeminiJson } from "./vip-profile-layout-gemini";
import { sanitizeVisualCorrectionPatch, type VisualCorrectionPatch } from "./visual-correction-patch";

export type VisualCorrectionComparison = {
  patch: VisualCorrectionPatch;
  visualScore: number;
  summary: string | null;
  structuralMismatch: boolean;
  costUsd: number;
  model: string;
};

function sanitizeScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export async function compareReferenceRender(args: {
  apiKey: string;
  target: GeminiReferenceImage;
  render: GeminiReferenceImage;
  layout: LayoutConfig;
}): Promise<VisualCorrectionComparison> {
  if (args.layout.layout_kind !== "precise") {
    return { patch: { changes: [] }, visualScore: 0, summary: "El layout no es precise.", structuralMismatch: true, costUsd: 0, model: "none" };
  }

  const editableScene = args.layout.precise_sections.map((section) => ({
    id: section.id,
    type: section.type,
    heightVh: section.heightVh,
    widthPct: section.widthPct,
    xPct: section.xPct,
    elements: (section.elements ?? []).map((element) => ({
      id: element.id,
      type: element.type,
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      fontSizePx: element.fontSizePx,
      letterSpacingPx: element.letterSpacingPx,
      lineHeight: element.lineHeight,
      opacity: element.opacity,
      borderWidthPx: element.borderWidthPx,
      radiusPx: element.radiusPx,
      color: element.color,
      backgroundColor: element.backgroundColor,
      borderColor: element.borderColor,
      shadow: element.shadow,
      blur: element.blur,
      imageFit: element.imageFit,
      imagePosition: element.imagePosition,
      align: element.align,
      buttonStyle: element.buttonStyle,
    })),
  }));

  const promptText = [
    "Sos el comparador visual de Reference Fidelity V3 de CLOUVA.",
    "Se adjuntan DOS imágenes en este orden: 0=TARGET ORIGINAL, 1=RENDER ACTUAL DE CLOUVA.",
    "Comparalas visualmente. No rediseñes la página y no generes HTML/CSS/JSX. Solo podés devolver un parche DELTA pequeño sobre IDs existentes del layout estructurado.",
    "Evaluá fidelidad perceptual real: composición, posición, tamaño, proporción, tipografía, radio, color, overlay, escala y jerarquía.",
    "visualScore debe ser un número 0..1 donde 1 significa coincidencia visual excelente. No lo infles.",
    "structuralMismatch=true solo cuando la estructura principal no puede corregirse razonablemente con deltas pequeños.",
    "No propongas cambios a un ID que no exista en la escena entregada.",
    "Usá delta para correcciones relativas pequeñas y set cuando la propiedad objetivo sea clara. Máximo 24 cambios.",
    "Valores element.set: x,y,w,h,zIndex,fontSizePx,letterSpacingPx,lineHeight,opacity,borderWidthPx,radiusPx,color,backgroundColor,borderColor,shadow,blur,imageFit,imagePosition,align,buttonStyle.",
    "Valores element.delta: x,y,w,h,zIndex,fontSizePx,letterSpacingPx,lineHeight,opacity,borderWidthPx,radiusPx.",
    "Valores section.set/delta: heightVh,widthPct,xPct; section.set también overlayOpacity.",
    `ESCENA EDITABLE ACTUAL: ${JSON.stringify(editableScene)}`,
    "Devolvé exactamente JSON válido sin texto alrededor:",
    '{"visualScore":number,"summary":string,"structuralMismatch":boolean,"changes":[{"target":"element"|"section","id":string,"set":{"prop":number|string|null},"delta":{"prop":number}}]}',
    "Si el render ya coincide razonablemente, devolvé changes vacío pero igualmente puntuá con precisión.",
  ].join("\n");

  const { parsed, costUsd, model } = await callGeminiJson({
    apiKey: args.apiKey,
    promptText,
    images: [args.target, args.render],
    workload: "reference_precise",
  });
  const raw = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};

  return {
    patch: sanitizeVisualCorrectionPatch(raw),
    visualScore: sanitizeScore(raw.visualScore),
    summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 500) : null,
    structuralMismatch: raw.structuralMismatch === true,
    costUsd,
    model,
  };
}
