import { notFound, redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export default async function BusinessAiPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  const admin = createAdminSupabase();
  const { data: space, error } = await admin
    .from("spaces")
    .select("id,type,business_kind,legacy_commerce_spot_id")
    .eq("id", spaceId)
    .maybeSingle();

  if (error || !space) notFound();
  const isBusiness = space.business_kind === "digital_business" || space.business_kind === "physical_business" || (space.type === "business" && space.business_kind !== "studio");
  if (!isBusiness || !space.legacy_commerce_spot_id) notFound();

  redirect(`/mi-spot/${space.legacy_commerce_spot_id}/business?businessSpaceId=${encodeURIComponent(space.id)}`);
}
