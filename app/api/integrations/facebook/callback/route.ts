import { NextResponse } from "next/server";
import { getFacebookConfig, isFacebookEnabled } from "@/core/integrations/facebook/config";
import { encryptFacebookSecret } from "@/core/integrations/facebook/crypto";
import { consumeFacebookState } from "@/core/integrations/facebook/state";
import { resolveBusinessPublisherAccess } from "@/lib/server/facebook-publisher";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; code?: number };
};

type PageRow = {
  id: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
};

function redirect(spaceId: string, status: string) {
  const url = new URL(`/businesses/${spaceId}/publicador`, "https://clouva.com.ar");
  url.searchParams.set("facebook", status);
  return NextResponse.redirect(url);
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T;
  if (!response.ok) {
    const errorMessage = (payload as TokenResponse).error?.message;
    throw new Error(errorMessage || `Meta respondió HTTP ${response.status}.`);
  }
  return payload;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawState = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const providerError = url.searchParams.get("error");
  if (!rawState) return NextResponse.redirect("https://clouva.com.ar/businesses?facebook=invalid_state");

  const admin = createAdminSupabase();
  let state: { userId: string; spaceId: string; returnPath: string } | null = null;

  try {
    state = await consumeFacebookState(admin, rawState);
    if (!isFacebookEnabled()) return redirect(state.spaceId, "not_configured");
    if (providerError || !code) return redirect(state.spaceId, "cancelled");

    const config = getFacebookConfig();
    await resolveBusinessPublisherAccess({ admin, userId: state.userId, spaceId: state.spaceId });

    const tokenUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", config.appId);
    tokenUrl.searchParams.set("client_secret", config.appSecret);
    tokenUrl.searchParams.set("redirect_uri", config.redirectUri);
    tokenUrl.searchParams.set("code", code);
    const shortToken = await readJson<TokenResponse>(await fetch(tokenUrl, { cache: "no-store" }));
    if (!shortToken.access_token) throw new Error("Meta no devolvió un access token.");

    let accessToken = shortToken.access_token;
    let expiresIn = shortToken.expires_in ?? null;
    const longUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", config.appId);
    longUrl.searchParams.set("client_secret", config.appSecret);
    longUrl.searchParams.set("fb_exchange_token", accessToken);
    const longResponse = await fetch(longUrl, { cache: "no-store" });
    if (longResponse.ok) {
      const longToken = await longResponse.json() as TokenResponse;
      if (longToken.access_token) {
        accessToken = longToken.access_token;
        expiresIn = longToken.expires_in ?? expiresIn;
      }
    }

    const meUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/me`);
    meUrl.searchParams.set("fields", "id,name");
    meUrl.searchParams.set("access_token", accessToken);
    const me = await readJson<{ id?: string; name?: string }>(await fetch(meUrl, { cache: "no-store" }));
    if (!me.id) throw new Error("No se pudo identificar la cuenta de Facebook.");

    const pagesUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/me/accounts`);
    pagesUrl.searchParams.set("fields", "id,name,access_token,tasks");
    pagesUrl.searchParams.set("access_token", accessToken);
    const pages = await readJson<{ data?: PageRow[] }>(await fetch(pagesUrl, { cache: "no-store" }));
    const encrypted = encryptFacebookSecret(accessToken);
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    const context = await resolveBusinessPublisherAccess({ admin, userId: state.userId, spaceId: state.spaceId });
    const spotId = String(context.spot.id);
    const connectionRow = {
      spot_id: spotId,
      user_id: state.userId,
      status: "connected",
      facebook_user_id: me.id,
      facebook_name: me.name || null,
      access_token_ciphertext: encrypted.ciphertext,
      access_token_iv: encrypted.iv,
      access_token_auth_tag: encrypted.authTag,
      token_key_version: config.tokenKeyVersion,
      scopes: config.scopes,
      expires_at: expiresAt,
      last_verified_at: new Date().toISOString(),
      metadata: { pages_found: pages.data?.length ?? 0 },
      updated_at: new Date().toISOString(),
    };
    const existingConnection = await admin.from("facebook_connections").select("id").eq("spot_id", spotId).eq("user_id", state.userId).maybeSingle();
    if (existingConnection.error) throw new Error(existingConnection.error.message);
    const connection = existingConnection.data?.id
      ? await admin.from("facebook_connections").update(connectionRow).eq("id", existingConnection.data.id)
      : await admin.from("facebook_connections").insert(connectionRow);
    if (connection.error) throw new Error(connection.error.message);

    for (const page of pages.data ?? []) {
      if (!page.id || !page.access_token) continue;
      const existingDestination = await admin
        .from("facebook_destinations")
        .select("id")
        .eq("spot_id", spotId)
        .eq("user_id", state.userId)
        .eq("type", "page")
        .eq("facebook_id", page.id)
        .maybeSingle();
      if (existingDestination.error) throw new Error(existingDestination.error.message);

      const destinationRow = {
        spot_id: spotId,
        user_id: state.userId,
        name: page.name || `Facebook Page ${page.id}`,
        type: "page",
        facebook_id: page.id,
        facebook_url: `https://www.facebook.com/${page.id}`,
        enabled: true,
        updated_at: new Date().toISOString(),
      };
      const destinationResult = existingDestination.data?.id
        ? await admin.from("facebook_destinations").update(destinationRow).eq("id", existingDestination.data.id).select("id").single()
        : await admin.from("facebook_destinations").insert(destinationRow).select("id").single();
      if (destinationResult.error) throw new Error(destinationResult.error.message);

      const pageEncrypted = encryptFacebookSecret(page.access_token);
      const credentialRow = {
        spot_id: spotId,
        user_id: state.userId,
        destination_id: destinationResult.data.id,
        page_id: page.id,
        page_name: page.name || null,
        access_token_ciphertext: pageEncrypted.ciphertext,
        access_token_iv: pageEncrypted.iv,
        access_token_auth_tag: pageEncrypted.authTag,
        token_key_version: config.tokenKeyVersion,
        tasks: page.tasks ?? [],
        updated_at: new Date().toISOString(),
      };
      const existingCredential = await admin.from("facebook_page_credentials").select("id").eq("destination_id", destinationResult.data.id).eq("user_id", state.userId).maybeSingle();
      if (existingCredential.error) throw new Error(existingCredential.error.message);
      const credential = existingCredential.data?.id
        ? await admin.from("facebook_page_credentials").update(credentialRow).eq("id", existingCredential.data.id)
        : await admin.from("facebook_page_credentials").insert(credentialRow);
      if (credential.error) throw new Error(credential.error.message);
    }

    return redirect(state.spaceId, "connected");
  } catch {
    return state ? redirect(state.spaceId, "error") : NextResponse.redirect("https://clouva.com.ar/businesses?facebook=error");
  }
}
