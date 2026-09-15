import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server/supabase";
import { getIgluAzuraStatus, getIgluNowPlaying, radioApiConfig, resolveIgluStudio } from "@/lib/server/iglu-radio";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug.toLowerCase() !== IGLU_STUDIO_SLUG) return NextResponse.json({ error: "Radio no encontrada." }, { status: 404 });

  const admin = createAdminSupabase();
  try {
    const studio = await resolveIgluStudio(admin);
    const [signal, server, settingsResult] = await Promise.all([
      getIgluNowPlaying(),
      getIgluAzuraStatus(),
      admin.from("radio_station_settings").select("autodj_enabled").eq("studio_id", studio.id).maybeSingle(),
    ]);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    const config = radioApiConfig();
    return NextResponse.json({
      ok: signal.reachable,
      station: signal.station,
      stream: Boolean(process.env.NEXT_PUBLIC_IGLU_RADIO_STREAM_URL?.trim()),
      azuracastConfigured: config.publicConfigured,
      azuracastReachable: signal.reachable || server.reachable,
      controllable: server.controllable,
      autodj: settingsResult.data?.autodj_enabled === true,
      live: signal.isLive,
      updatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      station: "IGLÚ RADIO",
      stream: Boolean(process.env.NEXT_PUBLIC_IGLU_RADIO_STREAM_URL?.trim()),
      azuracastConfigured: radioApiConfig().publicConfigured,
      azuracastReachable: false,
      controllable: false,
      autodj: false,
      live: false,
      error: error instanceof Error ? error.message : "No se pudo comprobar la radio.",
      updatedAt: new Date().toISOString(),
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
