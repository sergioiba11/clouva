import { NextRequest, NextResponse } from "next/server";
import { fetchInstagramSnapshot } from "@/core/integrations/instagram/client";
import { decryptSecret } from "@/core/integrations/instagram/crypto";
import { mapInstagramProfileToDraft } from "@/core/integrations/instagram/mapper";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const { data: connection, error } = await admin
      .from("social_connections")
      .select("id,external_account_id,access_token_ciphertext,token_iv,token_auth_tag,status,expires_at")
      .eq("user_id", user.id)
      .eq("provider", "instagram")
      .in("status", ["active", "expired"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!connection) return NextResponse.json({ error: "Instagram no está conectado." }, { status: 404 });
    if (connection.expires_at && new Date(connection.expires_at as string) <= new Date()) {
      await admin.from("social_connections").update({ status: "expired" }).eq("id", connection.id);
      return NextResponse.json({ error: "La conexión venció. Reconectá Instagram." }, { status: 409 });
    }

    const accessToken = decryptSecret({
      ciphertext: connection.access_token_ciphertext as string,
      iv: connection.token_iv as string,
      authTag: connection.token_auth_tag as string,
    });
    const snapshot = await fetchInstagramSnapshot(accessToken, connection.external_account_id as string);

    await admin.from("social_connections").update({
      external_username: snapshot.profile.username ?? null,
      display_name: snapshot.profile.name ?? null,
      account_type: snapshot.profile.account_type ?? null,
      status: "active",
      last_synced_at: new Date().toISOString(),
      metadata: { profile: snapshot.profile },
    }).eq("id", connection.id);

    const { data: session, error: sessionError } = await admin
      .from("social_import_sessions")
      .insert({
        user_id: user.id,
        connection_id: connection.id,
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
    if (sessionError) throw new Error(sessionError.message);

    return NextResponse.json({ importSessionId: session.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar Instagram.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
