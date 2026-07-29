import { NextRequest, NextResponse } from "next/server";
import { fetchInstagramSnapshot } from "@/core/integrations/instagram/client";
import { decryptSecret, sha256 } from "@/core/integrations/instagram/crypto";
import { mapInstagramProfileToDraft } from "@/core/integrations/instagram/mapper";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const continuation = request.cookies.get("clouva_ig_continuation")?.value;
    if (!continuation) {
      return NextResponse.json({ error: "No encontramos una conexión pendiente de Instagram." }, { status: 404 });
    }

    const admin = createAdminSupabase();
    const { data: connection, error } = await admin
      .from("social_connections")
      .select("id,external_account_id,access_token_ciphertext,token_iv,token_auth_tag")
      .eq("provider", "instagram")
      .eq("status", "pending")
      .eq("continuation_hash", sha256(continuation))
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!connection) {
      return NextResponse.json({ error: "La conexión pendiente venció o ya fue utilizada." }, { status: 410 });
    }

    const accessToken = decryptSecret({
      ciphertext: connection.access_token_ciphertext as string,
      iv: connection.token_iv as string,
      authTag: connection.token_auth_tag as string,
    });
    const snapshot = await fetchInstagramSnapshot(accessToken, connection.external_account_id as string);

    const { error: updateError } = await admin
      .from("social_connections")
      .update({
        user_id: user.id,
        status: "active",
        continuation_hash: null,
        connected_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        metadata: { profile: snapshot.profile },
      })
      .eq("id", connection.id)
      .eq("status", "pending");
    if (updateError) throw new Error(updateError.message);

    const { data: importSession, error: importError } = await admin
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
    if (importError) throw new Error(importError.message);

    const response = NextResponse.json({ importSessionId: importSession.id });
    response.cookies.set("clouva_ig_continuation", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo asociar Instagram.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
