import { notFound, redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/server/supabase";

export default async function StudioDashboardTeamPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const admin = createAdminSupabase();
  const { data: space, error } = await admin
    .from("spaces")
    .select("id")
    .eq("legacy_studio_id", studioId)
    .maybeSingle();

  if (error || !space) notFound();
  redirect(`/businesses/${space.id}/team`);
}
