import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export default async function BusinessPlayerLayout({ children, params }: { children: ReactNode; params: Promise<{ spotId: string }> }) {
  const { spotId } = await params;
  const admin = createAdminSupabase();
  const { data: space } = await admin
    .from("spaces")
    .select("id,type,business_kind")
    .eq("legacy_commerce_spot_id", spotId)
    .maybeSingle();

  if (space && (space.business_kind === "studio" || space.type === "studio")) {
    redirect("/businesses");
  }

  return children;
}
