import { notFound } from "next/navigation";
import { StudioIdentityRenderer } from "@/components/public/StudioIdentityRenderer";
import { sanitizeLayoutConfig } from "@/lib/server/layout-config";
import { resolveStudioIdentityById } from "@/lib/server/public-identity-data";
import { verifyReferencePreview } from "@/lib/server/reference-fidelity-v3";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReferenceFidelityPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ versionId }, query] = await Promise.all([params, searchParams]);
  const token = query.token?.trim() ?? "";
  if (!verifyReferencePreview(versionId, token)) notFound();

  const admin = createAdminSupabase();
  const { data: version, error } = await admin
    .from("player_profile_versions")
    .select("id,studio_id,status,layout_config")
    .eq("id", versionId)
    .maybeSingle();
  if (error || !version?.studio_id || version.status !== "draft") notFound();

  const identity = await resolveStudioIdentityById(admin, version.studio_id as string);
  if (!identity) notFound();
  const layoutConfig = sanitizeLayoutConfig(version.layout_config);
  if (!layoutConfig) notFound();

  return (
    <main data-reference-fidelity-preview="true">
      <StudioIdentityRenderer data={{ ...identity, layoutConfig }} />
    </main>
  );
}
