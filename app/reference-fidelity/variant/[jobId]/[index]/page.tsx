import { notFound } from "next/navigation";
import { StudioIdentityRenderer } from "@/components/public/StudioIdentityRenderer";
import { sanitizeLayoutConfig } from "@/lib/server/layout-config";
import { resolveStudioIdentityById } from "@/lib/server/public-identity-data";
import { verifyAdaptiveVariantPreview } from "@/lib/server/reference-fidelity-v3";
import { designInputFromSnapshot } from "@/lib/server/studio-design-input";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdaptiveVariantPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string; index: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ jobId, index: rawIndex }, query] = await Promise.all([params, searchParams]);
  const index = Number.parseInt(rawIndex, 10);
  if (!Number.isInteger(index) || index < 0 || index > 2) notFound();
  const token = query.token?.trim() ?? "";
  if (!verifyAdaptiveVariantPreview(jobId, index, token)) notFound();

  const admin = createAdminSupabase();
  const { data: job, error } = await admin
    .from("vip_profile_generation_jobs")
    .select("id,studio_id,status,layout_variants,source_snapshot,reference_image_urls")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job?.studio_id) notFound();
  if (!["generating_variant_assets", "awaiting_variant_selection", "generating_assets"].includes(String(job.status))) notFound();

  const variants = (job.layout_variants as Array<{ layout?: unknown }> | null) ?? [];
  const variant = variants[index];
  const layout = sanitizeLayoutConfig(variant?.layout);
  if (!layout) notFound();

  const identity = await resolveStudioIdentityById(admin, job.studio_id as string);
  if (!identity) notFound();
  const designInput = designInputFromSnapshot(job.source_snapshot, job.reference_image_urls);
  const themeAsset = designInput.realPhotos[0] ?? designInput.themeImages[0] ?? identity.studio.cover_url ?? null;
  const logoAsset = identity.studio.logo_url ?? null;
  const layoutConfig = sanitizeLayoutConfig({
    ...layout,
    image_slots: {
      ...layout.image_slots,
      ...(themeAsset ? { cover: themeAsset, "hero-primary": themeAsset, "background-0": themeAsset } : {}),
      ...(logoAsset ? { logo: logoAsset, "brand-lockup": logoAsset, avatar: logoAsset } : {}),
    },
  });
  if (!layoutConfig) notFound();

  return (
    <main data-adaptive-variant-preview="true" data-job-id={jobId} data-variant-index={index}>
      <StudioIdentityRenderer data={{ ...identity, layoutConfig }} />
    </main>
  );
}
