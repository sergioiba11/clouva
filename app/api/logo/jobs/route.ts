import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";
import { buildIdentityBrief, buildStudioIdentityBrief, playerBriefToFacts, studioBriefToFacts } from "@/lib/server/vip-profile-brief";
import { fetchReferenceImages } from "@/lib/server/vip-profile-assets";
import { resolveBrandAsset } from "@/lib/server/brand-engine/resolve-brand-asset";
import type { BrandSourceType } from "@/lib/server/brand-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mismas URLs que ya acepta /api/vip-profile/generate -- únicamente las que
// nuestro propio /api/vip-profile/reference-images subió (nunca una URL
// arbitraria del cliente, eso sería un vector SSRF cuando el server la
// fetch()ea).
const REFERENCE_IMAGE_URL_RE = /^https:\/\/storage\.googleapis\.com\/[a-z0-9._-]+\/reference-images\/(players|studios)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/;
const MAX_REFERENCE_IMAGES = 3;
const VALID_SOURCES: BrandSourceType[] = ["standalone", "website_mockup", "uploaded_logo", "sketch", "brand_reference"];

function sanitizeReferenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === "string" && REFERENCE_IMAGE_URL_RE.test(url)).slice(0, MAX_REFERENCE_IMAGES);
}

// Herramienta independiente /logo -- mismo motor compartido
// (lib/server/brand-engine) que usa el generador de páginas automático, solo
// que acá el usuario dispara la corrida directamente y espera el resultado
// (a diferencia del pipeline VIP completo, resolveBrandAsset es una sola
// unidad de trabajo acotada -- no hace falta la cola de Cloud Tasks
// multi-paso, corre sincrónico dentro de este request; Cloud Run no tiene el
// límite de 10s de las funciones de Vercel).
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      playerId?: string;
      studioId?: string;
      referenceImageUrls?: unknown;
      source?: string;
      forceRedesign?: boolean;
    };
    if (!body.playerId && !body.studioId) return NextResponse.json({ error: "Falta playerId o studioId." }, { status: 400 });
    if (body.playerId && body.studioId) return NextResponse.json({ error: "Elegí playerId o studioId, no ambos." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireActiveVipEntitlement({ admin, userId: user.id, playerId: body.playerId, studioId: body.studioId });

    const referenceImageUrls = sanitizeReferenceImageUrls(body.referenceImageUrls);
    const referenceImages = referenceImageUrls.length ? await fetchReferenceImages(referenceImageUrls) : [];

    const source: BrandSourceType = body.source && (VALID_SOURCES as string[]).includes(body.source)
      ? (body.source as BrandSourceType)
      : referenceImages.length > 0
        ? "uploaded_logo"
        : "standalone";

    const isPlayer = Boolean(body.playerId);
    const { brief, facts, name } = isPlayer
      ? await (async () => {
          const { brief } = await buildIdentityBrief(admin, body.playerId as string);
          return { brief, facts: playerBriefToFacts(brief), name: brief.display_name };
        })()
      : await (async () => {
          const { brief } = await buildStudioIdentityBrief(admin, body.studioId as string);
          return { brief, facts: studioBriefToFacts(brief), name: brief.name };
        })();
    void brief;

    // Regla 1 (obligatoria): forceRedesign SOLO puede venir en true desde
    // acá (acción explícita "Rediseñar identidad" en /logo) -- el generador
    // de páginas automático NUNCA la manda.
    const result = await resolveBrandAsset(admin, {
      ownerType: isPlayer ? "player" : "studio",
      ownerId: (body.playerId || body.studioId) as string,
      name,
      facts,
      source,
      referenceImages,
      createdBy: user.id,
      forceRedesign: body.forceRedesign === true,
    });

    return NextResponse.json({ result });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo generar el logo.";
    return NextResponse.json({ error: message }, { status });
  }
}
