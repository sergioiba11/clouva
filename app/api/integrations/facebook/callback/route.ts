import { NextResponse } from "next/server";
import {
  exchangeFacebookCode,
  fetchFacebookIdentity,
  fetchFacebookPages,
} from "@/core/integrations/facebook/client";
import { isFacebookEnabled } from "@/core/integrations/facebook/config";
import { encryptFacebookSecret } from "@/core/integrations/facebook/crypto";
import { consumeFacebookState } from "@/core/integrations/facebook/state";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase } from "@/lib/server/supabase";

function appOrigin() {
  return new URL(process.env.FACEBOOK_REDIRECT_URI?.trim() || "https://clouva.com.ar/api/integrations/facebook/callback").origin;
}

function redirectWith(path: string, params: Record<string, string>) {
  const url = new URL(path, appOrigin() + "/");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

function spotIdFromReturnPath(path: string) {
  try {
    return new URL(path, "https://clouva.com.ar").searchParams.get("spotId") || "";
  } catch {
    return "";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateRaw = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const providerError = url.searchParams.get("error");
  const admin = createAdminSupabase();

  if (!isFacebookEnabled()) return redirectWith("/mi-spot/publicador", { facebook: "disabled" });
  if (!stateRaw) return redirectWith("/mi-spot/publicador", { facebook: "invalid_state" });

  try {
    const state = await consumeFacebookState(admin, stateRaw);
    if (providerError || !code) return redirectWith(state.returnPath, { facebook: "cancelled" });

    const spotId = spotIdFromReturnPath(state.returnPath);
    if (!spotId) throw new Error("El OAuth de Facebook no tiene Spot destino.");
    await requireSpotAccess({ admin, userId: state.userId, spotId, capability: "content" });

    const token = await exchangeFacebookCode(code);
    const [identity, pages] = await Promise.all([
      fetchFacebookIdentity(token.access_token),
      fetchFacebookPages(token.access_token),
    ]);
    const expiresAt = token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : null;

    const { error: connectionError } = await admin.from("commerce_facebook_connections").upsert({
      user_id: state.userId,
      status: "connected",
      facebook_user_id: identity.id,
      display_name: identity.name,
      encrypted_access_token: encryptFacebookSecret(token.access_token),
      token_expires_at: expiresAt,
      scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"],
      last_verified_at: new Date().toISOString(),
      attention_reason: null,
      metadata: { page_count: pages.length },
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (connectionError) throw new Error(connectionError.message);

    for (const page of pages) {
      if (!page.id || !page.name || !page.access_token) continue;
      const existing = await admin.from("facebook_destinations")
        .select("id")
        .eq("user_id", state.userId)
        .eq("spot_id", spotId)
        .eq("type", "page")
        .eq("facebook_id", page.id)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);

      const row = {
        user_id: state.userId,
        spot_id: spotId,
        name: page.name,
        type: "page",
        facebook_url: "https://www.facebook.com/" + page.id,
        facebook_id: page.id,
        enabled: true,
        encrypted_access_token: encryptFacebookSecret(page.access_token),
        metadata: { tasks: page.tasks ?? [], source: "meta_pages_api" },
        updated_at: new Date().toISOString(),
      };
      const write = existing.data?.id
        ? await admin.from("facebook_destinations").update(row).eq("id", existing.data.id)
        : await admin.from("facebook_destinations").insert(row);
      if (write.error) throw new Error(write.error.message);
    }

    return redirectWith(state.returnPath, { facebook: "connected", pages: String(pages.length) });
  } catch {
    return redirectWith("/mi-spot/publicador", { facebook: "error" });
  }
}
