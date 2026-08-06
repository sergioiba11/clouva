import "server-only";
import type { GeminiReferenceImage } from "@/lib/gemini-image";
import { callGeminiJson } from "@/lib/server/vip-profile-layout-gemini";
import {
  LOGO_COMPLEXITY,
  LOGO_ORIENTATIONS,
  LOGO_TYPES,
  type DetectedLogo,
  type LogoOrientation,
  type LogoType,
} from "./types";

function clamp01(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0.5;
  return Math.min(1, Math.max(0, n));
}

function clampBoxCoord(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(1000, Math.max(0, Math.round(n)));
}

function sanitizeDetectedLogo(raw: unknown): DetectedLogo {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const detected = value.detected === true;
  if (!detected) return { detected: false, confidence: 0, box: null, logoType: null, visualSignature: null };

  const rawBox = value.box && typeof value.box === "object" ? (value.box as Record<string, unknown>) : null;
  const box = rawBox
    ? {
        top: clampBoxCoord(rawBox.top),
        left: clampBoxCoord(rawBox.left),
        bottom: clampBoxCoord(rawBox.bottom),
        right: clampBoxCoord(rawBox.right),
      }
    : null;

  const logoType = typeof value.logoType === "string" && (LOGO_TYPES as readonly string[]).includes(value.logoType)
    ? (value.logoType as LogoType)
    : null;

  const rawSignature = value.visualSignature && typeof value.visualSignature === "object" ? (value.visualSignature as Record<string, unknown>) : null;
  const visualSignature = rawSignature
    ? {
        silhouette: typeof rawSignature.silhouette === "string" ? rawSignature.silhouette.slice(0, 200) : "",
        geometry: typeof rawSignature.geometry === "string" ? rawSignature.geometry.slice(0, 200) : "",
        symmetry: typeof rawSignature.symmetry === "string" ? rawSignature.symmetry.slice(0, 100) : "",
        strokeWeight: typeof rawSignature.strokeWeight === "string" ? rawSignature.strokeWeight.slice(0, 100) : "",
        negativeSpace: typeof rawSignature.negativeSpace === "string" ? rawSignature.negativeSpace.slice(0, 200) : "",
        typographyStyle: typeof rawSignature.typographyStyle === "string" ? rawSignature.typographyStyle.slice(0, 200) : null,
        palette: Array.isArray(rawSignature.palette)
          ? rawSignature.palette.filter((c): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 6)
          : [],
        orientation: typeof rawSignature.orientation === "string" && (LOGO_ORIENTATIONS as readonly string[]).includes(rawSignature.orientation)
          ? (rawSignature.orientation as LogoOrientation)
          : "square",
        complexity: typeof rawSignature.complexity === "string" && (LOGO_COMPLEXITY as readonly string[]).includes(rawSignature.complexity)
          ? (rawSignature.complexity as (typeof LOGO_COMPLEXITY)[number])
          : "medium",
      }
    : null;

  return { detected: true, confidence: clamp01(value.confidence), box, logoType, visualSignature };
}

// Paso 1 del motor: mirar la imagen de referencia (mockup/branding/sketch) y
// devolver SOLO una descripción textual/geométrica del logo si existe -- sin
// bytes de imagen, sin URL. La generación real (build-logo-brief.ts +
// generate-logo.ts) recién pasa a Gemini de generación de imágenes después,
// con esta descripción como brief -- nunca la imagen completa "adivinando"
// qué recortar.
export async function detectLogoInReference(args: {
  apiKey: string;
  referenceImage: GeminiReferenceImage;
}): Promise<DetectedLogo> {
  const promptText = [
    "Sos un analizador visual de marcas/logos para CLOUVA.",
    "Tu tarea es mirar la imagen adjunta (puede ser un mockup de web, una foto de branding, un dibujo/sketch, o una referencia visual) y decidir si contiene un logo/isotipo/wordmark real identificable.",
    "No generás HTML, CSS ni código. No inventás nada que no esté visible en la imagen.",
    "",
    "Si hay un logo visible, describí su lenguaje visual (para que otro sistema genere una versión ORIGINAL inspirada en ese lenguaje, nunca una copia) -- silueta general, geometría de las formas, si es simétrico, grosor de trazo, cómo usa el espacio negativo, estilo tipográfico si tiene texto, paleta de color (hex), orientación de la composición, y qué tan compleja es.",
    "",
    "Devolvé exactamente este JSON, sin texto alrededor:",
    "{",
    '  "detected": boolean,',
    '  "confidence": number,',
    '  "box": { "top": number, "left": number, "bottom": number, "right": number } | null,',
    `  "logoType": ${LOGO_TYPES.map((t) => `"${t}"`).join(" | ")} | null,`,
    '  "visualSignature": {',
    '    "silhouette": string, "geometry": string, "symmetry": string, "strokeWeight": string,',
    '    "negativeSpace": string, "typographyStyle": string | null, "palette": string[],',
    `    "orientation": ${LOGO_ORIENTATIONS.map((o) => `"${o}"`).join(" | ")},`,
    `    "complexity": ${LOGO_COMPLEXITY.map((c) => `"${c}"`).join(" | ")}`,
    "  } | null",
    "}",
    "",
    'El "box" es normalizado 0-1000 relativo a TODA la imagen (0,0 esquina superior izquierda, 1000,1000 esquina inferior derecha) -- mismo formato que el resto del sistema, nunca porcentajes de una sub-región.',
  ].join("\n");

  const { parsed } = await callGeminiJson({ apiKey: args.apiKey, promptText, images: [args.referenceImage] });
  return sanitizeDetectedLogo(parsed);
}
