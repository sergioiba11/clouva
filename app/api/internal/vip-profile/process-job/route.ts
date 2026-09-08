import { NextRequest, NextResponse } from "next/server";
import { safeEqualHex } from "@/core/integrations/instagram/crypto";
import { uploadGeneratedMedia } from "@/lib/gcs-media";
import { createAdminSupabase } from "@/lib/server/supabase";
import { generateProfileCopy, type ProfileCopy } from "@/lib/server/vip-profile-gemini";
import { playerBriefToFacts, studioBriefToFacts, type IdentityBrief, type StudioIdentityBrief } from "@/lib/server/vip-profile-brief";
import { enqueueVipProfileJobStep } from "@/lib/server/cloud-tasks";
import { fetchReferenceImages, generateCoverAsset, generateLogoAsset, generatePillarAsset, type GeneratedAsset } from "@/lib/server/vip-profile-assets";
import { analyzeReferenceImages, generateLayoutConfig, generateLayoutVariants, generatePreciseLayoutConfig, type ReferenceAnalysis } from "@/lib/server/vip-profile-layout-gemini";
import { pickAccentFromPalette, sanitizeLayoutConfig, type ImageSlot, type LayoutConfig, type LayoutSection } from "@/lib/server/layout-config";
import { resolveBrandAsset } from "@/lib/server/brand-engine/resolve-brand-asset";
import { captureAdaptiveVariantPreview } from "@/lib/server/reference-fidelity-v3";
import {
  designInputFromSnapshot,
  orderedStudioDesignImages,
  resolveStudioDesignMode,
  type StudioDesignImageRole,
} from "@/lib/server/studio-design-input";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AdaptiveVariant = {
  layout: LayoutConfig;
  assets: GeneratedAsset[];
  previewUrl?: string | null;
  selected?: boolean;
};

function isAuthorized(request: NextRequest) {
  const provided = request.headers.get("x-clouva-vip-task-secret")?.trim() ?? "";
  const expected = process.env.VIP_PROFILE_TASK_SECRET?.trim() ?? "";
  if (!expected) return false;
  return safeEqualHex(provided, expected);
}

async function claim(admin: SupabaseClient, jobId: string, from: string, to: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("vip_profile_generation_jobs")
    .update({ status: to, ...extra })
    .eq("id", jobId)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

function roleCategory(role: StudioDesignImageRole) {
  if (role === "mockup") return "web_mockup" as const;
  if (role === "logo") return "brand_reference" as const;
  if (role === "theme") return "moodboard" as const;
  return "studio_photo" as const;
}

function explicitStudioAnalysis(args: {
  sourceSnapshot: unknown;
  referenceImageUrls: string[];
  fallback: ReferenceAnalysis | null;
}): ReferenceAnalysis {
  const input = designInputFromSnapshot(args.sourceSnapshot, args.referenceImageUrls);
  const ordered = orderedStudioDesignImages(input);
  const roles = new Map(ordered.map((row) => [row.url, row.role] as const));
  const mode = resolveStudioDesignMode(input);
  return {
    mode,
    confidence: 1,
    summary: args.fallback?.summary ?? (mode === "reference_layout" ? "Mockup explícito del usuario: reconstrucción precisa." : "Dirección adaptativa explícita del usuario."),
    images: args.referenceImageUrls.map((url, index) => {
      const role = roles.get(url) ?? "photo";
      return {
        index,
        category: roleCategory(role),
        is_layout_relevant: role === "mockup",
        notes: `Rol explícito del usuario: ${role}`,
      };
    }),
  };
}

async function imagesFor(urls: string[]) {
  return urls.length ? fetchReferenceImages(urls) : [];
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { jobId?: string };
  if (!body.jobId) return NextResponse.json({ error: "Falta jobId." }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: job, error: jobError } = await admin
    .from("vip_profile_generation_jobs")
    .select("id,user_id,player_id,studio_id,status,attempts,identity_brief,source_snapshot,generated_copy,generated_assets,generated_layout,layout_analysis,layout_variants,actual_cost_usd,reference_image_urls,brand_asset_version_id")
    .eq("id", body.jobId)
    .maybeSingle();
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "El job no existe." }, { status: 404 });

  const isPlayer = Boolean(job.player_id);
  const subjectColumn = isPlayer ? "player_id" : "studio_id";
  const subjectId = (job.player_id || job.studio_id) as string;
  const entityPathPrefix = isPlayer ? `players/${subjectId}` : `studios/${subjectId}`;

  try {
    switch (job.status) {
      case "queued": {
        const claimed = await claim(admin, job.id as string, "queued", "preparing_identity", {
          started_at: new Date().toISOString(),
          attempts: (job.attempts as number) + 1,
        });
        if (!claimed) return NextResponse.json({ ok: true, status: job.status, note: "Ya reclamado por otra ejecución." });
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "preparing_identity" });
      }
      case "preparing_identity": {
        const claimed = await claim(admin, job.id as string, "preparing_identity", "analyzing_identity");
        if (!claimed) return NextResponse.json({ ok: true, status: job.status, note: "Ya reclamado por otra ejecución." });
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "analyzing_identity" });
      }
      case "analyzing_identity": {
        const facts = isPlayer
          ? playerBriefToFacts(job.identity_brief as unknown as IdentityBrief)
          : studioBriefToFacts(job.identity_brief as unknown as StudioIdentityBrief);
        const { copy, costUsd }: { copy: ProfileCopy; costUsd: number } = await generateProfileCopy({
          facts,
          subjectLabel: isPlayer ? "Player" : "Estudio",
        });
        const { error } = await admin
          .from("vip_profile_generation_jobs")
          .update({
            status: "generating_copy",
            generated_copy: copy,
            actual_cost_usd: Number((((job.actual_cost_usd as number | null) ?? 0) + costUsd).toFixed(6)),
          })
          .eq("id", job.id)
          .eq("status", "analyzing_identity");
        if (error) throw new Error(error.message);
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "generating_copy", copy });
      }
      case "generating_copy": {
        const claimed = await claim(admin, job.id as string, "generating_copy", "classifying_reference");
        if (!claimed) return NextResponse.json({ ok: true, status: job.status, note: "Ya reclamado por otra ejecución." });
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "classifying_reference" });
      }
      case "classifying_reference": {
        const referenceImageUrls = (job.reference_image_urls as string[] | null) ?? [];
        const referenceImages = referenceImageUrls.length ? await fetchReferenceImages(referenceImageUrls) : [];
        const apiKey = process.env.GEMINI_API_KEY;
        let analysis: ReferenceAnalysis | null = null;
        let analysisCost = 0;
        if (apiKey && referenceImages.length) {
          try {
            const facts = isPlayer
              ? playerBriefToFacts(job.identity_brief as unknown as IdentityBrief)
              : studioBriefToFacts(job.identity_brief as unknown as StudioIdentityBrief);
            const result = await analyzeReferenceImages({ apiKey, images: referenceImages, facts, subjectLabel: isPlayer ? "Player" : "Estudio" });
            analysis = result.analysis;
            analysisCost = result.costUsd;
          } catch (analysisError) {
            console.warn("vip_profile_layout_classification_failed", {
              jobId: job.id,
              message: analysisError instanceof Error ? analysisError.message : "unknown",
            });
          }
        }
        if (!isPlayer) {
          analysis = explicitStudioAnalysis({ sourceSnapshot: job.source_snapshot, referenceImageUrls, fallback: analysis });
        }
        const nextStatus = analysis?.mode === "adaptive_layout" ? "generating_variants" : "generating_assets";

        const { error: saveError } = await admin
          .from("vip_profile_generation_jobs")
          .update({
            status: nextStatus,
            layout_analysis: analysis,
            actual_cost_usd: Number((((job.actual_cost_usd as number | null) ?? 0) + analysisCost).toFixed(6)),
          })
          .eq("id", job.id)
          .eq("status", "classifying_reference");
        if (saveError) throw new Error(saveError.message);

        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: nextStatus });
      }
      case "generating_assets": {
        const copy = job.generated_copy as unknown as ProfileCopy;
        const professionalCategories = isPlayer
          ? (job.identity_brief as unknown as IdentityBrief).professional_categories ?? []
          : (job.identity_brief as unknown as StudioIdentityBrief).services.map((s) => s.name);
        const referenceImageUrls = (job.reference_image_urls as string[] | null) ?? [];
        const designInput = !isPlayer ? designInputFromSnapshot(job.source_snapshot, referenceImageUrls) : null;
        const [legacyReferenceImages, mockupImages, themeImages, realPhotoImages, logoImages] = await Promise.all([
          isPlayer ? imagesFor(referenceImageUrls) : Promise.resolve([]),
          designInput ? imagesFor(designInput.mockupImages) : Promise.resolve([]),
          designInput ? imagesFor(designInput.themeImages) : Promise.resolve([]),
          designInput ? imagesFor(designInput.realPhotos) : Promise.resolve([]),
          designInput ? imagesFor(designInput.logoImages) : Promise.resolve([]),
        ]);
        const facts = isPlayer
          ? playerBriefToFacts(job.identity_brief as unknown as IdentityBrief)
          : studioBriefToFacts(job.identity_brief as unknown as StudioIdentityBrief);
        const entityName = isPlayer
          ? (job.identity_brief as unknown as IdentityBrief).display_name
          : (job.identity_brief as unknown as StudioIdentityBrief).name;
        const analysis = job.layout_analysis as unknown as ReferenceAnalysis | null;
        const selectedAdaptiveLayout = analysis?.mode === "adaptive_layout" ? sanitizeLayoutConfig(job.generated_layout) : null;

        const layoutResult = await (async (): Promise<{ layout: LayoutConfig | null; costUsd: number } | null> => {
          if (selectedAdaptiveLayout) return { layout: selectedAdaptiveLayout, costUsd: 0 };
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey || !analysis) return null;
          try {
            const layoutImages = isPlayer ? legacyReferenceImages : analysis.mode === "reference_layout" ? mockupImages : [...themeImages, ...logoImages];
            const localAnalysis = !isPlayer && analysis.mode === "reference_layout"
              ? { ...analysis, images: layoutImages.map((_, index) => ({ index, category: "web_mockup" as const, is_layout_relevant: true, notes: "Mockup explícito" })) }
              : analysis;
            const generator = analysis.mode === "reference_layout" ? generatePreciseLayoutConfig : generateLayoutConfig;
            const { layout, costUsd } = await generator({
              apiKey,
              images: layoutImages,
              analysis: localAnalysis,
              facts,
              copy: { tagline: copy.tagline, short_bio: copy.short_bio },
              subjectLabel: isPlayer ? "Player" : "Estudio",
            });
            return { layout, costUsd };
          } catch (layoutError) {
            console.warn("vip_profile_layout_generation_failed", {
              jobId: job.id,
              message: layoutError instanceof Error ? layoutError.message : "unknown",
            });
            return null;
          }
        })();
        if (!layoutResult?.layout) throw new Error("No se pudo construir un layout válido para el Studio.");

        const { data: studioFallback } = !isPlayer
          ? await admin.from("studios").select("logo_url,cover_url").eq("id", subjectId).maybeSingle()
          : { data: null };
        const fallbackCoverUrl = designInput?.realPhotos[0] ?? designInput?.themeImages[0] ?? (studioFallback?.cover_url as string | null | undefined) ?? null;
        const fallbackLogoUrl = (studioFallback?.logo_url as string | null | undefined) ?? null;
        const coverReferenceImages = isPlayer
          ? legacyReferenceImages
          : realPhotoImages.length ? realPhotoImages : themeImages.length ? themeImages : mockupImages;
        const coverPromise: Promise<GeneratedAsset> = fallbackCoverUrl
          ? Promise.resolve({ kind: "cover", url: fallbackCoverUrl, costUsd: 0 })
          : generateCoverAsset({
              admin,
              entityPathPrefix,
              copy,
              professionalCategories,
              referenceImages: coverReferenceImages.length ? coverReferenceImages : undefined,
              literalReference: analysis?.mode === "reference_layout",
            });

        const brandReferenceImages = isPlayer
          ? legacyReferenceImages
          : designInput?.logoOwnershipConfirmed ? logoImages : [];
        const brandPromise = resolveBrandAsset(admin, {
          ownerType: isPlayer ? "player" : "studio",
          ownerId: subjectId,
          entityName,
          facts,
          source: !isPlayer && brandReferenceImages.length ? "uploaded_logo" : "identity_brief",
          referenceImages: brandReferenceImages,
          createdBy: (job.user_id as string | null) ?? null,
          ...(!isPlayer && brandReferenceImages.length ? {
            sourceKind: "own_logo_file" as const,
            ownershipAttested: true,
            ownershipAttestedBy: (job.user_id as string | null) ?? undefined,
          } : {}),
        });

        const [coverResult, brandResult] = await Promise.allSettled([coverPromise, brandPromise]);
        const assets: GeneratedAsset[] = [];
        if (coverResult.status === "fulfilled") assets.push(coverResult.value);
        let brandAssetVersionId: string | null = null;
        let primaryBrandUrl = fallbackLogoUrl;
        let lockupBrandUrl = fallbackLogoUrl;
        let avatarBrandUrl = fallbackLogoUrl;
        let contrastBrandUrl = fallbackLogoUrl;
        if (brandResult.status === "fulfilled" && brandResult.value.urls) {
          brandAssetVersionId = brandResult.value.brandAssetVersionId;
          primaryBrandUrl = brandResult.value.urls.primary_logo_url;
          lockupBrandUrl = brandResult.value.urls.horizontal_logo_url ?? primaryBrandUrl;
          avatarBrandUrl = brandResult.value.urls.square_logo_url ?? brandResult.value.urls.symbol_logo_url ?? primaryBrandUrl;
          contrastBrandUrl = layoutResult.layout.page_style?.theme === "light"
            ? brandResult.value.urls.black_logo_url ?? primaryBrandUrl
            : brandResult.value.urls.white_logo_url ?? primaryBrandUrl;
          assets.push({ kind: "logo", url: primaryBrandUrl, costUsd: brandResult.value.costUsd });
        } else if (fallbackLogoUrl) {
          assets.push({ kind: "logo", url: fallbackLogoUrl, costUsd: 0 });
        }
        if (coverResult.status === "rejected") console.warn("vip_profile_cover_generation_recoverable", { jobId: job.id, message: coverResult.reason instanceof Error ? coverResult.reason.message : "unknown" });
        if (brandResult.status === "rejected") console.warn("vip_profile_brand_generation_recoverable", { jobId: job.id, message: brandResult.reason instanceof Error ? brandResult.reason.message : "unknown" });

        const isPrecise = layoutResult.layout.layout_kind === "precise";
        const pillarsSection = !isPrecise
          ? layoutResult.layout.sections.find((section): section is Extract<LayoutSection, { type: "pillars" }> => section.type === "pillars")
          : undefined;
        if (pillarsSection && designInput?.realPhotos.length) {
          pillarsSection.items = pillarsSection.items.map((item, index) => ({ ...item, image: designInput.realPhotos[index] ?? item.image ?? null }));
        }
        const pillarResults = analysis?.mode === "reference_layout" && pillarsSection && pillarsSection.items.length >= 2 && !designInput?.realPhotos.length
          ? await Promise.allSettled(
              pillarsSection.items.slice(0, 4).map((item, pillarIndex) =>
                generatePillarAsset({ admin, entityPathPrefix, title: item.title, description: item.description, professionalCategories, index: pillarIndex }),
              ),
            )
          : [];
        if (pillarsSection && pillarResults.length) {
          pillarsSection.items = pillarsSection.items.map((item, itemIndex) => {
            const result = pillarResults[itemIndex];
            return result && result.status === "fulfilled" ? { ...item, image: result.value.url } : item;
          });
        }

        const precisePillarsSection = isPrecise
          ? layoutResult.layout.precise_sections.find((section) => section.type === "pillars")
          : undefined;
        const referencedPillarSlots = precisePillarsSection
          ? Array.from(new Set(
              (precisePillarsSection.elements ?? [])
                .filter((element) => element.type === "image" && element.imageSlot?.startsWith("pillar-"))
                .map((element) => element.imageSlot as ImageSlot),
            )).slice(0, 4)
          : [];
        const preciseHeadings = (precisePillarsSection?.elements ?? []).filter((el) => el.type === "heading" || el.type === "subheading").map((el) => el.text || "");
        const preciseParagraphs = (precisePillarsSection?.elements ?? []).filter((el) => el.type === "paragraph").map((el) => el.text || "");
        const preciseSlotsNeedingGeneration = referencedPillarSlots.filter((_, index) => !designInput?.realPhotos[index]);
        const precisePillarResults = preciseSlotsNeedingGeneration.length
          ? await Promise.allSettled(
              preciseSlotsNeedingGeneration.map((slot) => {
                const sourceIndex = referencedPillarSlots.indexOf(slot);
                return generatePillarAsset({
                  admin,
                  entityPathPrefix,
                  title: preciseHeadings[sourceIndex] || precisePillarsSection?.styleHint?.heading || "Identidad",
                  description: preciseParagraphs[sourceIndex] || "Foto de ambiente representativa del Estudio.",
                  professionalCategories,
                  index: Number(slot.split("-")[1]),
                });
              }),
            )
          : [];

        const coverAsset = assets.find((asset) => asset.kind === "cover")?.url ?? fallbackCoverUrl;
        const preciseImageSlots: Partial<Record<ImageSlot, string>> = {};
        let generatedSlotIndex = 0;
        referencedPillarSlots.forEach((slot, index) => {
          const real = designInput?.realPhotos[index];
          if (real) {
            preciseImageSlots[slot] = real;
            return;
          }
          const result = precisePillarResults[generatedSlotIndex];
          generatedSlotIndex += 1;
          if (result && result.status === "fulfilled") preciseImageSlots[slot] = result.value.url;
        });
        layoutResult.layout.image_slots = {
          ...layoutResult.layout.image_slots,
          ...(coverAsset ? { cover: coverAsset, "hero-primary": coverAsset, "background-0": coverAsset } : {}),
          ...(contrastBrandUrl ? { logo: contrastBrandUrl } : {}),
          ...(lockupBrandUrl ? { "brand-lockup": lockupBrandUrl } : {}),
          ...(avatarBrandUrl ? { avatar: avatarBrandUrl } : {}),
          ...preciseImageSlots,
        };

        const pillarCostUsd = [...pillarResults, ...precisePillarResults].reduce((sum, result) => sum + (result.status === "fulfilled" ? result.value.costUsd : 0), 0);
        const costUsd = assets.reduce((sum, asset) => sum + asset.costUsd, 0) + (layoutResult.costUsd ?? 0) + pillarCostUsd;

        const { error: saveError } = await admin
          .from("vip_profile_generation_jobs")
          .update({
            status: "assembling_profile",
            generated_assets: assets,
            generated_layout: layoutResult.layout,
            brand_asset_version_id: brandAssetVersionId,
            actual_cost_usd: Number((((job.actual_cost_usd as number | null) ?? 0) + costUsd).toFixed(6)),
          })
          .eq("id", job.id)
          .eq("status", "generating_assets");
        if (saveError) throw new Error(saveError.message);

        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "assembling_profile", assets });
      }
      case "generating_variants": {
        const copy = job.generated_copy as unknown as ProfileCopy;
        const analysis = job.layout_analysis as unknown as ReferenceAnalysis;
        const referenceImageUrls = (job.reference_image_urls as string[] | null) ?? [];
        const designInput = !isPlayer ? designInputFromSnapshot(job.source_snapshot, referenceImageUrls) : null;
        const variantImageUrls = designInput
          ? [...designInput.themeImages, ...designInput.logoImages]
          : referenceImageUrls;
        const referenceImages = variantImageUrls.length ? await fetchReferenceImages(variantImageUrls) : [];
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");

        const facts = isPlayer
          ? playerBriefToFacts(job.identity_brief as unknown as IdentityBrief)
          : studioBriefToFacts(job.identity_brief as unknown as StudioIdentityBrief);
        const { layouts, costUsd } = await generateLayoutVariants({
          apiKey,
          images: referenceImages,
          analysis,
          facts,
          copy: { tagline: copy.tagline, short_bio: copy.short_bio },
          subjectLabel: isPlayer ? "Player" : "Estudio",
          creativeDirection: designInput?.creativeDirection ?? null,
        });
        if (layouts.length === 0) throw new Error("Gemini no devolvió ninguna variante de diseño válida.");

        const { error: saveError } = await admin
          .from("vip_profile_generation_jobs")
          .update({
            status: "generating_variant_assets",
            layout_variants: layouts.map((layout) => ({ layout, assets: [], previewUrl: null })),
            actual_cost_usd: Number((((job.actual_cost_usd as number | null) ?? 0) + costUsd).toFixed(6)),
          })
          .eq("id", job.id)
          .eq("status", "generating_variants");
        if (saveError) throw new Error(saveError.message);

        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "generating_variant_assets", variantCount: layouts.length });
      }
      case "generating_variant_assets": {
        const pendingVariants = (job.layout_variants as unknown as AdaptiveVariant[] | null) ?? [];
        if (pendingVariants.length === 0) throw new Error("No hay variantes pendientes de preparar.");

        if (!isPlayer) {
          const captures = await Promise.allSettled(
            pendingVariants.map(async (variant, index) => {
              const screenshot = await captureAdaptiveVariantPreview({ jobId: job.id as string, index });
              const previewUrl = await uploadGeneratedMedia({
                bytes: Buffer.from(screenshot.data, "base64"),
                mimeType: "image/png",
                pathPrefix: `public-identity/studios/${subjectId}/adaptive-previews/${job.id}/variant-${index}`,
              });
              return { ...variant, assets: [], previewUrl };
            }),
          );
          const layoutVariants = captures.map((result, index) => result.status === "fulfilled"
            ? result.value
            : { ...pendingVariants[index], previewUrl: null });
          if (!layoutVariants.some((variant) => variant.previewUrl)) {
            const firstFailure = captures.find((result): result is PromiseRejectedResult => result.status === "rejected");
            throw firstFailure?.reason instanceof Error ? firstFailure.reason : new Error("No se pudieron renderizar las propuestas.");
          }
          const { error: saveError } = await admin
            .from("vip_profile_generation_jobs")
            .update({ status: "awaiting_variant_selection", layout_variants: layoutVariants })
            .eq("id", job.id)
            .eq("status", "generating_variant_assets");
          if (saveError) throw new Error(saveError.message);
          return NextResponse.json({ ok: true, status: "awaiting_variant_selection", variantCount: layoutVariants.length });
        }

        // Player stays on its existing adaptive asset path while this product
        // iteration is intentionally scoped to the public Studio web.
        const copy = job.generated_copy as unknown as ProfileCopy;
        const professionalCategories = (job.identity_brief as unknown as IdentityBrief).professional_categories ?? [];
        const referenceImageUrls = (job.reference_image_urls as string[] | null) ?? [];
        const referenceImages = referenceImageUrls.length ? await fetchReferenceImages(referenceImageUrls) : undefined;
        const variantResults = await Promise.allSettled(
          pendingVariants.map(async (variant) => {
            const [coverResult, logoResult] = await Promise.allSettled([
              generateCoverAsset({ admin, entityPathPrefix, copy, professionalCategories, referenceImages }),
              generateLogoAsset({ admin, entityPathPrefix, copy, professionalCategories, referenceImages }),
            ]);
            if (coverResult.status !== "fulfilled") throw coverResult.reason;
            const assets: GeneratedAsset[] = [coverResult.value];
            if (logoResult.status === "fulfilled") assets.push(logoResult.value);
            return { ...variant, assets };
          }),
        );
        const layoutVariants = variantResults
          .filter((result): result is PromiseFulfilledResult<AdaptiveVariant> => result.status === "fulfilled")
          .map((result) => result.value);
        const costUsd = layoutVariants.reduce((sum, variant) => sum + variant.assets.reduce((s, a) => s + a.costUsd, 0), 0);
        if (layoutVariants.length === 0) throw new Error("No se pudo generar ninguna variante de diseño.");
        const { error: saveError } = await admin
          .from("vip_profile_generation_jobs")
          .update({
            status: "awaiting_variant_selection",
            layout_variants: layoutVariants,
            actual_cost_usd: Number((((job.actual_cost_usd as number | null) ?? 0) + costUsd).toFixed(6)),
          })
          .eq("id", job.id)
          .eq("status", "generating_variant_assets");
        if (saveError) throw new Error(saveError.message);
        return NextResponse.json({ ok: true, status: "awaiting_variant_selection", variantCount: layoutVariants.length });
      }
      case "assembling_profile": {
        const copy = job.generated_copy as unknown as ProfileCopy;
        const assets = (job.generated_assets as unknown as GeneratedAsset[] | null) ?? [];
        const cover = assets.find((a) => a.kind === "cover");
        const logo = assets.find((a) => a.kind === "logo");
        const sanitizedLayout = sanitizeLayoutConfig(job.generated_layout);
        if (sanitizedLayout && !sanitizedLayout.page_style?.palette?.accent) {
          const accent = pickAccentFromPalette(copy.palette);
          if (accent) {
            sanitizedLayout.page_style = { ...sanitizedLayout.page_style, palette: { ...sanitizedLayout.page_style?.palette, accent } };
          }
        }
        const layoutConfig = sanitizedLayout ?? {};

        const { data: lastVersion, error: lastVersionError } = await admin
          .from("player_profile_versions")
          .select("version_number")
          .eq(subjectColumn, subjectId)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastVersionError) throw new Error(lastVersionError.message);
        const nextVersion = ((lastVersion?.version_number as number | null) ?? 0) + 1;

        const { data: version, error: versionError } = await admin
          .from("player_profile_versions")
          .insert({
            player_id: job.player_id,
            studio_id: job.studio_id,
            generation_job_id: job.id,
            version_number: nextVersion,
            status: "draft",
            profile_level: "vip",
            template_key: "vip_default",
            copy_config: copy,
            visual_config: { energy: copy.visual_energy, tone: copy.visual_tone, palette: copy.palette },
            asset_references: [
              ...(cover ? [{ kind: "cover", url: cover.url }] : []),
              ...(logo ? [{ kind: "logo", url: logo.url }] : []),
            ],
            layout_config: layoutConfig,
            brand_asset_version_id: (job.brand_asset_version_id as string | null) ?? null,
            source_snapshot: job.source_snapshot ?? job.identity_brief,
          })
          .select("id")
          .single();
        if (versionError) throw new Error(versionError.message);

        const { error } = await admin
          .from("vip_profile_generation_jobs")
          .update({ status: "review_ready", completed_at: new Date().toISOString() })
          .eq("id", job.id)
          .eq("status", "assembling_profile");
        if (error) throw new Error(error.message);

        return NextResponse.json({ ok: true, status: "review_ready", versionId: version.id });
      }
      default:
        return NextResponse.json({ ok: true, status: job.status, note: "Sin paso siguiente implementado todavía." });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar el paso.";
    await admin
      .from("vip_profile_generation_jobs")
      .update({ status: "failed", error_message: message })
      .eq("id", job.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
