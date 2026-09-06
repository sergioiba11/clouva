import "server-only";

import type { GeminiReferenceImage } from "@/lib/gemini-image";
import type { LayoutConfig } from "./layout-config";
import { callGeminiJson } from "./vip-profile-layout-gemini";
import { sanitizeVisualCorrectionPatch, type VisualCorrectionPatch } from "./visual-correction-patch";

export type VisualCorrectionComparison = {
  patch: VisualCorrectionPatch;
  costUsd: number;
  model: string;
};

// Pure comparison stage for the Reference Fidelity loop. Screenshot capture is
// intentionally outside this module: any canonical browser/preview runner can
// provide TARGET + RENDER images without coupling the layout engine to
// Playwright or a second rendering stack.
export async function compareReferenceRender(args: {
  apiKey: string;
  target: GeminiReferenceImage;
  render: GeminiReferenceImage;
  layout: LayoutConfig;
}): Promise<VisualCorrectionComparison> {
  if (args.layout.layout_kind !== "precise") {
    return { patch: { changes: [] }, costUsd: 0, model: "none" };
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
    "Sos el comparador visual de Reference Fidelity V2 de CLOUVA.",
    "Se adjuntan DOS imágenes en este orden: 0=TARGET ORIGINAL, 1=RENDER ACTUAL DE CLOUVA.",
    "Comparalas visualmente. No rediseñes la página y no generes HTML/CSS/JSX. Tu única salida es un parche DELTA pequeño sobre IDs existentes del layout estructurado.",
    "Priorizá las diferencias perceptuales grandes: posición, tamaño, proporción, tipografía, radio, color, overlay y escala. No cambies contenido real.",
    "No propongas cambios a un ID que no exista en la escena entregada.",
    "Usá `delta` cuando sea una corrección relativa pequeña y `set` cuando la propiedad objetivo sea clara. Máximo 24 cambios por pasada.",
    "Valores permitidos para element.set: x,y,w,h,zIndex,fontSizePx,letterSpacingPx,lineHeight,opacity,borderWidthPx,radiusPx,color,backgroundColor,borderColor,shadow,blur,imageFit,imagePosition,align,buttonStyle.",
    "Valores permitidos para element.delta: x,y,w,h,zIndex,fontSizePx,letterSpacingPx,lineHeight,opacity,borderWidthPx,radiusPx.",
    "Valores permitidos para section.set/delta: heightVh,widthPct,xPct; section.set también puede usar overlayOpacity.",
    `ESCENA EDITABLE ACTUAL: ${JSON.stringify(editableScene)}`,
    "Devolvé exactamente JSON válido sin texto alrededor:",
    '{"changes":[{"target":"element"|"section","id":string,"set":{"prop":number|string|null},"delta":{"prop":number}}]}',
    "Si el render ya coincide razonablemente con el target, devolvé {\"changes\":[]}.",
  ].join("\n");

  const { parsed, costUsd, model } = await callGeminiJson({
    apiKey: args.apiKey,
    promptText,
    images: [args.target, args.render],
    workload: "reference_precise",
  });

  return {
    patch: sanitizeVisualCorrectionPatch(parsed),
    costUsd,
    model,
  };
}
