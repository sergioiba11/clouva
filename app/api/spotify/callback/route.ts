import { NextResponse } from "next/server";
import { exchangeSpotifyCode, getAdminSupabase, getSiteUrl, verifySpotifyState } from "@/lib/spotify/server";

type SpotifyMe = {
  id: string;
  display_name: string | null;
  email?: string;
  images?: Array<{ url: string }>;
  external_urls?: { spotify?: string };
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  const destination = new URL("/spotify", getSiteUrl());

  if (denied) {
    destination.searchParams.set("error", denied);
    return NextResponse.redirect(destination);
  }

  try {
    if (!code || !state) throw new Error("MISSING_OAUTH_PARAMS");
    const { userId } = verifySpotifyState(state);
    const tokens = await exchangeSpotifyCode(code);

    const profileResponse = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: "no-store",
    });
    if (!profileResponse.ok) throw new Error(`SPOTIFY_PROFILE_${profileResponse.status}`);
    const spotify = (await profileResponse.json()) as SpotifyMe;

    const supabase = getAdminSupabase();
    const { error } = await supabase.from("spotify_connections").upsert({
      user_id: userId,
      spotify_user_id: spotify.id,
      spotify_display_name: spotify.display_name,
      spotify_email: spotify.email || null,
      spotify_avatar_url: spotify.images?.[0]?.url || null,
      spotify_profile_url: spotify.external_urls?.spotify || null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope.split(" "),
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;

    destination.searchParams.set("connected", "1");
    return NextResponse.redirect(destination);
  } catch (error) {
    destination.searchParams.set("error", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return NextResponse.redirect(destination);
  }
}
