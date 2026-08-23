import { NextResponse } from "next/server";
import { createPublicSupabase } from "@/lib/server/public-supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createPublicSupabase();
  const { data: player } = await supabase
    .from("players")
    .select("id,display_name")
    .eq("slug", "clouva")
    .eq("is_published", true)
    .maybeSingle();
  if (!player) return NextResponse.json({ ok: true, track: null });
  const { data, error } = await supabase
    .from("external_music_tracks")
    .select("external_track_id,external_track_uri,external_album_id,title,artist_name,album_name,cover_url,external_url,release_date")
    .eq("player_id", player.id)
    .eq("provider", "spotify")
    .order("release_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ ok: true, track: null });
  return NextResponse.json({
    ok: true,
    track: {
      provider: "spotify",
      id: data.external_track_id,
      uri: data.external_track_uri,
      albumId: data.external_album_id,
      title: data.title,
      artist: data.artist_name,
      album: data.album_name,
      coverUrl: data.cover_url,
      externalUrl: data.external_url,
      releaseDate: data.release_date,
    },
  });
}
