import { NextResponse } from "next/server";
import { exchangeSpotifyCode, spotifyApiFetch } from "@/core/integrations/spotify/client";
import { isSpotifyEnabled } from "@/core/integrations/spotify/config";
import { consumeSpotifyState } from "@/core/integrations/spotify/state";
import { persistSpotifyConnection, saveSpotifyUri } from "@/core/integrations/spotify/service";
import type { SpotifyMe } from "@/core/integrations/spotify/types";
import { createAdminSupabase } from "@/lib/server/supabase";

function redirectWith(request: Request, path: string, params: Record<string, string>) {
  const url = new URL(path, new URL(request.url).origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateRaw = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const providerError = url.searchParams.get("error");
  const admin = createAdminSupabase();

  if (!isSpotifyEnabled()) return redirectWith(request, "/settings/connections", { spotify: "disabled" });
  if (!stateRaw) return redirectWith(request, "/settings/connections", { spotify: "invalid_state" });

  try {
    const state = await consumeSpotifyState(admin, stateRaw);
    if (providerError || !code) return redirectWith(request, state.returnPath, { spotify: "cancelled" });

    const tokens = await exchangeSpotifyCode(code);
    const me = await spotifyApiFetch<SpotifyMe>({ accessToken: tokens.access_token, path: "/me" });
    await persistSpotifyConnection({ admin, userId: state.userId, tokens, me });

    let action = "none";
    if (state.pendingAction) {
      try {
        await saveSpotifyUri(admin, state.userId, state.pendingAction.uri);
        action = "completed";
      } catch {
        action = "failed";
      }
    }
    return redirectWith(request, state.returnPath, { spotify: "connected", action });
  } catch {
    return redirectWith(request, "/settings/connections", { spotify: "error" });
  }
}
