import { notFound } from "next/navigation";
import { FacebookPublisher } from "@/components/commerce/FacebookPublisher";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export default async function BusinessFacebookPublisherPage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const admin = createAdminSupabase();
  const { data: space, error } = await admin
    .from("spaces")
    .select("id,type,business_kind,status,legacy_commerce_spot_id")
    .eq("id", spaceId)
    .maybeSingle();

  if (error || !space || space.status !== "active") notFound();

  const isBusiness =
    space.business_kind === "digital_business"
    || space.business_kind === "physical_business"
    || (space.type === "business" && space.business_kind !== "studio");

  if (!isBusiness || !space.legacy_commerce_spot_id) notFound();
  return <FacebookPublisher spaceId={space.id} />;
}
