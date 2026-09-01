import { NextResponse } from "next/server";
import { exchangeYoutubeCode } from "@/core/integrations/youtube/client";
import { CLOUVA_YOUTUBE_REDIRECT_URI, isYoutubeEnabled } from "@/core/integrations/youtube/config";
import { consumeYoutubeState } from "@/core/integrations/youtube/state";
import { fetchYoutubeChannelWithAccessToken, persistYoutubeConnection, syncYoutubeVideos } from "@/core/integrations/youtube/service";
import { createAdminSupabase } from "@/lib/server/supabase";

function appOrigin() {
  return new URL(process.env.YOUTUBE_REDIRECT_URI?.trim() || CLOUVA_YOUTUBE_REDIRECT_URI).origin;
}

function redirectWith(path: string, params: Record<string, string>) {
  const url = new URL(path, `${appOrigin()}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateRaw = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const providerError = url.searchParams.get("error");
  const admin = createAdminSupabase();

  if (!isYoutubeEnabled()) return redirectWith("/profile/edit?section=youtube", { youtube: "disabled" });
  if (!stateRaw) return redirectWith("/profile/edit?section=youtube", { youtube: "invalid_state" });

  try {
    const state = await consumeYoutubeState(admin, stateRaw);
    if (providerError || !code) return redirectWith(state.returnPath, { youtube: "cancelled" });
    const tokens = await exchangeYoutubeCode(code);
    const channel = await fetchYoutubeChannelWithAccessToken(tokens.access_token);
    await persistYoutubeConnection({ admin, userId: state.userId, tokens, channel });
    const sync = await syncYoutubeVideos(admin, state.userId);
    return redirectWith(state.returnPath, { youtube: "connected", synced: String(sync.synced) });
  } catch {
    return redirectWith("/profile/edit?section=youtube", { youtube: "error" });
  }
}
