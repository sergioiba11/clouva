import { NextResponse } from "next/server";
import { getAdminSupabase, requireSupabaseUser, spotifyFetch } from "@/lib/spotify/server";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const supabase = getAdminSupabase();
    const { data: connection } = await supabase
      .from("spotify_connections")
      .select("spotify_user_id, spotify_display_name, spotify_avatar_url, spotify_profile_url, connected_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!connection) return NextResponse.json({ connected: false });

    const [topTracks, topArtists, recentlyPlayed, currentlyPlaying] = await Promise.all([
      spotifyFetch(user.id, "/me/top/tracks?limit=10&time_range=medium_term"),
      spotifyFetch(user.id, "/me/top/artists?limit=10&time_range=medium_term"),
      spotifyFetch(user.id, "/me/player/recently-played?limit=10"),
      spotifyFetch(user.id, "/me/player/currently-playing"),
    ]);

    return NextResponse.json({
      connected: true,
      connection,
      topTracks,
      topArtists,
      recentlyPlayed,
      currentlyPlaying,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message === "UNAUTHORIZED" ? 401 : message === "SPOTIFY_NOT_CONNECTED" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const supabase = getAdminSupabase();
    const { error } = await supabase.from("spotify_connections").delete().eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
