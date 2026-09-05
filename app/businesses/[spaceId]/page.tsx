import { notFound } from "next/navigation";
import { SpaceCommerceWorkspace } from "@/components/commerce/SpaceCommerceWorkspace";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/**
 * A Business is a CLOUVA Space with its own commerce scope.
 *
 * Do not build a parallel business dashboard here: shops such as Rapafernalia
 * use the exact same operational manager as Studios (catalog, scanner,
 * inventory, POS, sales, orders, codes and QR), while keeping their data in
 * their own commerce Spot.
 */
export default async function BusinessManagerPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  const admin = createAdminSupabase();

  const { data: space, error } = await admin
    .from("spaces")
    .select("id,type,business_kind,legacy_commerce_spot_id,status")
    .eq("id", spaceId)
    .maybeSingle();

  if (error || !space || space.status !== "active") notFound();

  const isBusiness =
    space.business_kind === "digital_business"
    || space.business_kind === "physical_business"
    || (space.type === "business" && space.business_kind !== "studio");

  if (!isBusiness || !space.legacy_commerce_spot_id) notFound();

  return <SpaceCommerceWorkspace commerceScopeId={`spot:${space.legacy_commerce_spot_id}`} />;
}
