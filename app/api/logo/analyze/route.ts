import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";
import { buildIdentityBrief, buildStudioIdentityBrief } from "@/lib/server/vip-profile-brief";
import { fetchReferenceImages } from "@/lib/server/vip-profile-assets";
import { analyzeBrandSource } from "@/lib/server/brand-engine/resolve-brand-asset";
import type { BrandSourceType } from "@/lib/server/brand-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFERENCE_IMAGE_URL_RE = /^https:\/\/storage\.googleapis\.com\/[a-z0-9._-]+\/reference-images\/(players|studios)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/;
const MAX_REFERENCE_IMAGES = 3;

function sanitizeReferenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === "string" && REFERENCE_IMAGE_URL_RE.test(url)).slice(0, MAX_REFERENCE_IMAGES);
}

// Fase 6: paso barato (sin generar imágenes) -- analiza la referencia y
// propone nombre/descriptor/estructura para que el usuario los revise y
// corrija ANTES de gastar una generación real. /logo llama esto primero.
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { playerId?: string; studioId?: string; referenceImageUrls?: unknown; source?: string };
    if (!body.playerId && !body.studioId) return NextResponse.json({ error: "Falta playerId o studioId." }, { status: 400 });
    if (body.playerId && body.studioId) return NextResponse.json({ error: "Elegí playerId o studioId, no ambos." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireActiveVipEntitlement({ admin, userId: user.id, playerId: body.playerId, studioId: body.studioId });

    const referenceImageUrls = sanitizeReferenceImageUrls(body.referenceImageUrls);
    const referenceImages = referenceImageUrls.length ? await fetchReferenceImages(referenceImageUrls) : [];

    const isPlayer = Boolean(body.playerId);
    const entityName = isPlayer
      ? (await buildIdentityBrief(admin, body.playerId as string)).brief.display_name
      : (await buildStudioIdentityBrief(admin, body.studioId as string)).brief.name;

    const source: BrandSourceType = referenceImages.length > 0 ? "website_mockup" : "standalone";

    const result = await analyzeBrandSource(admin, {
      ownerType: isPlayer ? "player" : "studio",
      ownerId: (body.playerId || body.studioId) as string,
      entityName,
      source,
      referenceImages,
    });

    return NextResponse.json({ result, referenceImageUrls });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo analizar la referencia.";
    return NextResponse.json({ error: message }, { status });
  }
}
