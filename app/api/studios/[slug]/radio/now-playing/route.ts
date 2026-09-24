import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server/supabase";
import { getIgluNowPlaying, resolveIgluStudio } from "@/lib/server/iglu-radio";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug.toLowerCase() !== IGLU_STUDIO_SLUG) {
    return NextResponse.json({ error: "Radio no encontrada." }, { status: 404 });
  }

  const admin = createAdminSupabase();
  try {
    const studio = await resolveIgluStudio(admin);
    const [signal, settingsResult] = await Promise.all([
      getIgluNowPlaying(),
      admin.from("radio_station_settings").select("autodj_enabled,timezone").eq("studio_id", studio.id).maybeSingle(),
    ]);
    if (settingsResult.error) throw new Error(settingsResult.error.message);

    return NextResponse.json({
      station: signal.station,
      configured: signal.configured,
      reachable: signal.reachable,
      live: signal.isLive,
      streamer: signal.streamer,
      listeners: signal.listeners,
      listenUrl: signal.listenUrl,
      autodj: settingsResult.data?.autodj_enabled === true,
      timezone: settingsResult.data?.timezone ?? "America/Argentina/Buenos_Aires",
      nowPlaying: signal.nowPlaying,
      playingNext: signal.playingNext,
      history: signal.history,
      updatedAt: signal.updatedAt,
    }, { headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=10" } });
  } catch (error) {
    return NextResponse.json({
      station: "IGLÚ RADIO",
      configured: false,
      reachable: false,
      live: false,
      autodj: false,
      nowPlaying: null,
      playingNext: null,
      history: [],
      error: error instanceof Error ? error.message : "No se pudo leer la señal.",
      updatedAt: new Date().toISOString(),
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
