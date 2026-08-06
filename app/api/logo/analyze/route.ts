import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";
import { buildIdentityBrief, buildStudioIdentityBrief } from "@/lib/server/vip-profile-brief";
import { fetchReferenceImages } from "@/lib/server/vip-profile-assets";
import { analyzeBrandSource } from "@/lib/server/brand-engine/resolve-brand-asset";
import { detectLogoInReference, isLogoBoxUsable } from "@/lib/server/brand-engine/analyze-logo-source";
import { resolveBrandNaming, suggestTypography } from "@/lib/server/brand-engine/resolve-brand-naming";
import type { BrandSourceType, NormalizedBox } from "@/lib/server/brand-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFERENCE_IMAGE_URL_RE = /^https:\/\/storage\.googleapis\.com\/[a-z0-9._-]+\/reference-images\/(players|studios)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/;
const MAX_REFERENCE_IMAGES = 3;

function sanitizeReferenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === "string" && REFERENCE_IMAGE_URL_RE.test(url)).slice(0, MAX_REFERENCE_IMAGES);
}

function sanitizeManualBox(value: unknown): NormalizedBox | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const coord = (entry: unknown) => typeof entry === "number" && Number.isFinite(entry) ? Math.max(0, Math.min(1000, Math.round(entry))) : 0;
  const box = { top: coord(raw.top), left: coord(raw.left), bottom: coord(raw.bottom), right: coord(raw.right) };
  return isLogoBoxUsable(box) ? box : null;
}

// Paso de análisis sin generación de imágenes. Puede trabajar en automático
// o sobre un rectángulo marcado manualmente por el usuario cuando el detector
// confundió una sección completa del mockup con el logo real.
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      playerId?: string;
      studioId?: string;
      referenceImageUrls?: unknown;
      source?: string;
      manualBox?: unknown;
    };
    if (!body.playerId && !body.studioId) return NextResponse.json({ error: "Falta playerId o studioId." }, { status: 400 });
    if (body.playerId && body.studioId) return NextResponse.json({ error: "Elegí playerId o studioId, no ambos." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireActiveVipEntitlement({ admin, userId: user.id, playerId: body.playerId, studioId: body.studioId });

    const referenceImageUrls = sanitizeReferenceImageUrls(body.referenceImageUrls);
    const referenceImages = referenceImageUrls.length ? await fetchReferenceImages(referenceImageUrls) : [];
    const manualBox = sanitizeManualBox(body.manualBox);

    const isPlayer = Boolean(body.playerId);
    const entityName = isPlayer
      ? (await buildIdentityBrief(admin, body.playerId as string)).brief.display_name
      : (await buildStudioIdentityBrief(admin, body.studioId as string)).brief.name;

    const source: BrandSourceType = referenceImages.length > 0 ? "website_mockup" : "standalone";

    if (manualBox && referenceImages[0]) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");
      const detectedLogo = await detectLogoInReference({ apiKey, referenceImage: referenceImages[0], manualBox });
      const naming = resolveBrandNaming({ entityName, detectedLogo, officialNaming: null });
      const suggestedTypography = suggestTypography(detectedLogo);
      return NextResponse.json({ result: { detectedLogo, naming, suggestedTypography }, referenceImageUrls, manualSelection: true });
    }

    const result = await analyzeBrandSource(admin, {
      ownerType: isPlayer ? "player" : "studio",
      ownerId: (body.playerId || body.studioId) as string,
      entityName,
      source,
      referenceImages,
    });

    return NextResponse.json({ result, referenceImageUrls, manualSelection: false });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo analizar la referencia.";
    return NextResponse.json({ error: message }, { status });
  }
}
