import "server-only";
import type { BrandNaming, DetectedLogo, LetterSpacing, TypographyConfig } from "./types";

// Umbral mínimo de confianza para confiar en el texto que Gemini leyó del
// mockup -- por debajo de esto, mejor caer al nombre oficial/interno que
// arriesgar un texto mal leído.
const MOCKUP_TEXT_CONFIDENCE_THRESHOLD = 0.55;

// Fase 3: separa el nombre INTERNO de la entidad en CLOUVA (ej. "El Iglú",
// como está guardado en players/studios.name) del texto EXACTO que va en el
// logo (ej. "IGLÚ" + descriptor "RECORDS") -- nunca se transforma uno en el
// otro automáticamente. Prioridad: confirmado a mano por el usuario > texto
// detectado en el mockup con confianza alta > identidad oficial ya
// publicada > nombre interno como último recurso.
export function resolveBrandNaming(args: {
  entityName: string;
  detectedLogo?: DetectedLogo | null;
  officialNaming?: { displayName: string; descriptor: string | null } | null;
  userConfirmed?: { displayName: string; descriptor: string | null } | null;
}): BrandNaming {
  if (args.userConfirmed && args.userConfirmed.displayName.trim()) {
    return {
      entityName: args.entityName,
      displayName: args.userConfirmed.displayName.trim(),
      descriptor: args.userConfirmed.descriptor?.trim() || null,
      source: "user_confirmed",
    };
  }

  const detectedName = args.detectedLogo?.visibleText.primaryName;
  const confidence = args.detectedLogo?.confidence ?? 0;
  if (detectedName && confidence >= MOCKUP_TEXT_CONFIDENCE_THRESHOLD) {
    return {
      entityName: args.entityName,
      displayName: detectedName,
      descriptor: args.detectedLogo?.visibleText.descriptor ?? null,
      source: "mockup_detected",
    };
  }

  if (args.officialNaming?.displayName) {
    return {
      entityName: args.entityName,
      displayName: args.officialNaming.displayName,
      descriptor: args.officialNaming.descriptor,
      source: "official_identity",
    };
  }

  return { entityName: args.entityName, displayName: args.entityName, descriptor: null, source: "entity_fallback" };
}

// Traduce letterSpacing cualitativo (lo que Gemini describe) a un valor de
// tracking en píxeles usable por compose-logo-lockups.ts. Valores calibrados
// a ojo sobre fontSize=96 para el nombre principal -- razonables, no una
// medición exacta del mockup (no tenemos esa granularidad sin remedir cada
// letra).
const LETTER_SPACING_PX: Record<LetterSpacing, number> = { tight: -1, normal: 2, wide: 6, very_wide: 14 };

const DEFAULT_TYPOGRAPHY: TypographyConfig = {
  family: "Archivo Black",
  weight: 900,
  width: "extended",
  uppercase: true,
  primaryTracking: 4,
  descriptorTracking: 12,
  descriptorScale: 0.3,
};

// Fase 5: única fuente embebida y verificada en esta etapa (ver
// lib/server/brand-engine/fonts/) -- geométrica, ancha, ideal para wordmarks
// de marca. El resto de TypographyConfig sí varía según lo detectado.
export function suggestTypography(detectedLogo: DetectedLogo | null): TypographyConfig {
  if (!detectedLogo?.lockupStructure) return DEFAULT_TYPOGRAPHY;
  const { letterSpacing } = detectedLogo.lockupStructure;
  return {
    ...DEFAULT_TYPOGRAPHY,
    primaryTracking: LETTER_SPACING_PX[letterSpacing] ?? DEFAULT_TYPOGRAPHY.primaryTracking,
    descriptorTracking: (LETTER_SPACING_PX[letterSpacing] ?? DEFAULT_TYPOGRAPHY.descriptorTracking) * 2.5,
  };
}
