import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  exchangeLongLivedToken,
  fetchInstagramSnapshot,
} from "@/core/integrations/instagram/client";
import { getInstagramConfig, isInstagramEnabled } from "@/core/integrations/instagram/config";
import { encryptSecret } from "@/core/integrations/instagram/crypto";
import { mapInstagramProfileToDraft } from "@/core/integrations/instagram/mapper";
import { consumeInstagramState } from "@/core/integrations/instagram/state";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appUrl(path: string) {
  const base = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
  return new URL(path, base);
}

function errorRedirect(message: string) {
  const url = appUrl("/onboarding/instagram");
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  if (!isInstagramEnabled()) return errorRedirect("La importación de Instagram no está activada.");

  const oauthError = request.nextUrl.searchParams.get("error_description") || request.nextUrl.searchParams.get("error");
  if (oauthError) return errorRedirect(oauthError);

  const code = request.nextUrl.searchParams.get("code")?.replace(/#_$/, "").trim();
  const state = request.nextUrl.searchParams.get("state")?.trim();
  if (!code || !state) return errorRedirect("Instagram no devolvió una autorización válida.");

  const admin = createAdminSupabase();
  try {
    const oauthState = await consumeInstagramState(admin, state);
    const shortToken = await exchangeAuthorizationCode(code);

    let accessToken = shortToken.access_token;
    let expiresAt: string | null = null;
    try {
      const longToken = await exchangeLongLivedToken(shortToken.access_token);
      accessToken = longToken.access_token;
      if (longToken.expires_in) {
        expiresAt = new Date(Date.now() + longToken.expires_in * 1000).toISOString();
      }
    } catch (exchangeError) {
      console.warn("instagram_long_lived_exchange_failed", {
        stateId: oauthState.id,
        message: exchangeError instanceof Error ? exchangeError.message : "unknown",
      });
    }

    const snapshot = await fetchInstagramSnapshot(accessToken, String(shortToken.user_id));
    const encrypted = encryptSecret(accessToken);
    const config = getInstagramConfig();
    const externalAccountId = snapshot.profile.id;

    const { data: existing, error: existingError } = await admin
      .from("social_connections")
      .select("id,user_id,status")
      .eq("provider", "instagram")
      .eq("external_account_id", externalAccountId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.user_id && oauthState.user_id && existing.user_id !== oauthState.user_id) {
      throw new Error("Esa cuenta de Instagram ya está conectada a otro usuario de CLOUVA.");
    }

    const connectionValues = {
      user_id: oauthState.user_id,
      provider: "instagram",
      external_account_id: externalAccountId,
      external_username: snapshot.profile.username ?? null,
      display_name: snapshot.profile.name ?? null,
      account_type: snapshot.profile.account_type ?? null,
      access_token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      token_auth_tag: encrypted.authTag,
      token_key_version: config.tokenKeyVersion,
      expires_at: expiresAt,
      scopes: config.scopes,
      status: oauthState.user_id ? "active" : "pending",
      continuation_hash: oauthState.continuation_hash,
      metadata: { profile: snapshot.profile },
      connected_at: oauthState.user_id ? new Date().toISOString() : null,
      last_synced_at: new Date().toISOString(),
    };

    let connectionId: string;
    if (existing) {
      const { data, error } = await admin
        .from("social_connections")
        .update(connectionValues)
        .eq("id", existing.id)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      connectionId = data.id as string;
    } else {
      const { data, error } = await admin
        .from("social_connections")
        .insert(connectionValues)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      connectionId = data.id as string;
    }

    if (!oauthState.user_id) {
      return NextResponse.redirect(appUrl("/login?continue=instagram"));
    }

    const { data: importSession, error: importError } = await admin
      .from("social_import_sessions")
      .insert({
        user_id: oauthState.user_id,
        connection_id: connectionId,
        provider: "instagram",
        status: "ready",
        available_profile_data: {
          ...mapInstagramProfileToDraft(snapshot.profile),
          source: snapshot.profile,
        },
        available_media: snapshot.media,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (importError) throw new Error(importError.message);

    const destination = appUrl(oauthState.return_path || "/onboarding/instagram/select");
    destination.searchParams.set("importSession", importSession.id as string);
    return NextResponse.redirect(destination);
  } catch (error) {
    console.error("instagram_oauth_callback_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return errorRedirect(error instanceof Error ? error.message : "No se pudo conectar Instagram.");
  }
}
