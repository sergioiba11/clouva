import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";
import { buildIdentityBrief, buildStudioIdentityBrief, playerBriefToFacts, studioBriefToFacts } from "@/lib/server/vip-profile-brief";
import { fetchReferenceImages } from "@/lib/server/vip-profile-assets";
import { resolveBrandAsset } from "@/lib/server/brand-engine/resolve-brand-asset";
import {
  BRAND_SOURCE_KINDS,
  type BrandNaming,
  type BrandSourceKind,
  type BrandSourceType,
  type DetectedLogo,
  type ExtractionMethod,
  type ReferenceFidelity,
  type TypographyConfig,
} from "@/lib/server/brand-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFERENCE_IMAGE_URL_RE = /^https:\/\/storage\.googleapis\.com\/[a-z0-9._-]+\/reference-images\/(players|studios)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/;
const MAX_REFERENCE_IMAGES = 3;
const VALID_SOURCES: BrandSourceType[] = ["standalone", "website_mockup", "uploaded_logo", "sketch", "brand_reference"];
const VALID_FIDELITY: ReferenceFidelity[] = ["creative", "balanced", "high"];
const VALID_EXTRACTION_METHODS: ExtractionMethod[] = ["manual_crop", "confirmed_detected_crop"];

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
      extractionMethod?: string;
      ownershipAttested?: boolean;
      sourceKind?: string;
      sourceNote?: string;
    };
    if (!body.playerId && !body.studioId) return NextResponse.json({ error: "Falta playerId o studioId." }, { status: 400 });
    if (body.playerId && body.studioId) return NextResponse.json({ error: "Elegí playerId o studioId, no ambos." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireActiveVipEntitlement({ admin, userId: user.id, playerId: body.playerId, studioId: body.studioId });

    const referenceImageUrls = sanitizeReferenceImageUrls(body.referenceImageUrls);
    const referenceImages = referenceImageUrls.length ? await fetchReferenceImages(referenceImageUrls) : [];
    const forceRedesign = body.forceRedesign === true;
    const sourceKind: BrandSourceKind = body.sourceKind && (BRAND_SOURCE_KINDS as readonly string[]).includes(body.sourceKind)
      ? (body.sourceKind as BrandSourceKind)
      : referenceImages.length > 0 ? "own_mockup" : "own_logo_file";

    if (referenceImages.length > 0 && !forceRedesign) {
      if (sourceKind === "reference_only") {
        return NextResponse.json({ error: "Una referencia ajena no puede importarse como identidad propia. Elegí Rediseñar identidad." }, { status: 400 });
      }
      if (body.ownershipAttested !== true) {
        return NextResponse.json({ error: "Tenés que declarar que poseés o tenés autorización para usar esta identidad antes de importarla." }, { status: 400 });
      }
      if (!body.detectedLogo?.detected || !body.detectedLogo.primaryBox) {
        return NextResponse.json({ error: "Falta un recorte confirmado de la identidad real." }, { status: 400 });
      }
    }

    const source: BrandSourceType = body.source && (VALID_SOURCES as string[]).includes(body.source)
      ? (body.source as BrandSourceType)
      : referenceImages.length > 0 ? "uploaded_logo" : "standalone";
    const referenceFidelity: ReferenceFidelity | undefined = body.referenceFidelity && (VALID_FIDELITY as string[]).includes(body.referenceFidelity)
      ? (body.referenceFidelity as ReferenceFidelity)
      : undefined;
    const extractionMethod: ExtractionMethod = body.extractionMethod && (VALID_EXTRACTION_METHODS as string[]).includes(body.extractionMethod)
      ? (body.extractionMethod as ExtractionMethod)
      : "confirmed_detected_crop";

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
      referenceImageUrls,
      createdBy: user.id,
      forceRedesign,
      referenceFidelity,
      detectedLogo: body.detectedLogo ?? null,
      naming: body.naming ?? null,
      typography: body.typography ?? null,
      extractionMethod,
      ownershipAttested: body.ownershipAttested === true,
      ownershipAttestedBy: body.ownershipAttested === true ? user.id : null,
      sourceKind,
      sourceNote: typeof body.sourceNote === "string" ? body.sourceNote.trim().slice(0, 500) || null : null,
    });

    return NextResponse.json({ result });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo procesar la identidad.";
    return NextResponse.json({ error: message }, { status });
  }
}
