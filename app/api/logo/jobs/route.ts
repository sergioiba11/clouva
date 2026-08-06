import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";
import { buildIdentityBrief, buildStudioIdentityBrief, playerBriefToFacts, studioBriefToFacts } from "@/lib/server/vip-profile-brief";
import { fetchReferenceImages } from "@/lib/server/vip-profile-assets";
import { resolveBrandAsset } from "@/lib/server/brand-engine/resolve-brand-asset";
import { hasUsableSymbolReference } from "@/lib/server/brand-engine/analyze-logo-source";
import type { BrandNaming, BrandSourceType, DetectedLogo, ReferenceFidelity, TypographyConfig } from "@/lib/server/brand-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFERENCE_IMAGE_URL_RE = /^https:\/\/storage\.googleapis\.com\/[a-z0-9._-]+\/reference-images\/(players|studios)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/;
const MAX_REFERENCE_IMAGES = 3;
const VALID_SOURCES: BrandSourceType[] = ["standalone", "website_mockup", "uploaded_logo", "sketch", "brand_reference"];
const VALID_FIDELITY: ReferenceFidelity[] = ["creative", "balanced", "high"];

function sanitizeReferenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === "string" && REFERENCE_IMAGE_URL_RE.test(url)).slice(0, MAX_REFERENCE_IMAGES);
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      playerId?: string;
      studioId?: string;
      referenceImageUrls?: unknown;
      source?: string;
      forceRedesign?: boolean;
      referenceFidelity?: string;
      detectedLogo?: DetectedLogo;
      naming?: BrandNaming;
      typography?: TypographyConfig;
    };
    if (!body.playerId && !body.studioId) return NextResponse.json({ error: "Falta playerId o studioId." }, { status: 400 });
    if (body.playerId && body.studioId) return NextResponse.json({ error: "Elegí playerId o studioId, no ambos." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireActiveVipEntitlement({ admin, userId: user.id, playerId: body.playerId, studioId: body.studioId });

    const referenceImageUrls = sanitizeReferenceImageUrls(body.referenceImageUrls);
    const referenceImages = referenceImageUrls.length ? await fetchReferenceImages(referenceImageUrls) : [];

    const source: BrandSourceType = body.source && (VALID_SOURCES as string[]).includes(body.source)
      ? (body.source as BrandSourceType)
      : referenceImages.length > 0 ? "uploaded_logo" : "standalone";
    const referenceFidelity: ReferenceFidelity | undefined = body.referenceFidelity && (VALID_FIDELITY as string[]).includes(body.referenceFidelity)
      ? (body.referenceFidelity as ReferenceFidelity)
      : undefined;

    // Compuerta anti-gasto: con una referencia visual y el flujo normal, no
    // se genera si el análisis no encontró un símbolo real dentro de un box
    // compacto. El usuario debe marcar manualmente la zona correcta y
    // reanalizarla. "Rediseñar identidad" sí puede crear un símbolo nuevo sin
    // copiar una referencia concreta porque esa acción es explícita.
    if (referenceImages.length > 0 && body.forceRedesign !== true && !hasUsableSymbolReference(body.detectedLogo)) {
      return NextResponse.json(
        { error: "No detectamos un símbolo real y compacto en la referencia. Marcá con el mouse el área exacta del logo o isotipo, tocá ‘Analizar área marcada’ y recién después generá." },
        { status: 422 },
      );
    }

    const isPlayer = Boolean(body.playerId);
    const { facts, entityName } = isPlayer
      ? await (async () => {
          const { brief } = await buildIdentityBrief(admin, body.playerId as string);
          return { facts: playerBriefToFacts(brief), entityName: brief.display_name };
        })()
      : await (async () => {
          const { brief } = await buildStudioIdentityBrief(admin, body.studioId as string);
          return { facts: studioBriefToFacts(brief), entityName: brief.name };
        })();

    const result = await resolveBrandAsset(admin, {
      ownerType: isPlayer ? "player" : "studio",
      ownerId: (body.playerId || body.studioId) as string,
      entityName,
      facts,
      source,
      referenceImages,
      createdBy: user.id,
      forceRedesign: body.forceRedesign === true,
      referenceFidelity,
      detectedLogo: body.detectedLogo ?? null,
      naming: body.naming ?? null,
      typography: body.typography ?? null,
    });

    return NextResponse.json({ result });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo generar el logo.";
    return NextResponse.json({ error: message }, { status });
  }
}
