import { NextResponse } from "next/server";
import { buildSpotifyAuthorizeUrl, createSpotifyState, requireSupabaseUser } from "@/lib/spotify/server";

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const state = createSpotifyState(user.id);
    return NextResponse.json({ url: buildSpotifyAuthorizeUrl(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
