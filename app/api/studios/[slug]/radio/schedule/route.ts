import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server/supabase";
import { resolveIgluStudio } from "@/lib/server/iglu-radio";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug.toLowerCase() !== IGLU_STUDIO_SLUG) return NextResponse.json({ error: "Radio no encontrada." }, { status: 404 });

  const admin = createAdminSupabase();
  try {
    const studio = await resolveIgluStudio(admin);
    const { data, error } = await admin
      .from("radio_schedule_blocks")
      .select("id,title,description,kind,day_of_week,start_time,end_time,starts_at,ends_at,timezone,status,playlist_id")
      .eq("studio_id", studio.id)
      .eq("status", "scheduled")
      .order("day_of_week", { ascending: true, nullsFirst: false })
      .order("start_time", { ascending: true, nullsFirst: false })
      .order("starts_at", { ascending: true, nullsFirst: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return NextResponse.json({ schedule: data ?? [] }, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar la programación.", schedule: [] }, { status: 500 });
  }
}
