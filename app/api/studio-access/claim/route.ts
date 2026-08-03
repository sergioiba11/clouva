import { NextRequest, NextResponse } from "next/server";
import { sha256 } from "@/core/integrations/instagram/crypto";
import { createAdminSupabase, createUserSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token")?.trim();
    if (!token) return NextResponse.json({ error: "Falta el token de invitación." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("studio_access_claims")
      .select("id,role,status,expires_at,studio:studios(id,slug,name,logo_url,cover_url,studio_os_status)")
      .eq("token_hash", sha256(token))
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.status !== "pending" || new Date(data.expires_at as string) <= new Date()) {
      return NextResponse.json({ error: "La invitación venció, fue cancelada o ya fue utilizada." }, { status: 410 });
    }

    return NextResponse.json({
      claim: {
        role: data.role,
        requiresVip: false,
        expiresAt: data.expires_at,
        studio: data.studio,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo revisar la invitación.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = body.token?.trim();
    if (!token) return NextResponse.json({ error: "Falta el token de invitación." }, { status: 400 });

    const client = createUserSupabase(accessToken);
    const { data, error } = await client.rpc("claim_studio_access", { p_token_hash: sha256(token) });
    if (error) {
      const status = /otro usuario|correo autorizado/i.test(error.message) ? 403 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (!result) throw new Error("La invitación no pudo reclamarse.");

    return NextResponse.json({
      claimed: true,
      studioId: result.studio_id,
      studioSlug: result.studio_slug,
      studioName: result.studio_name,
      role: result.claimed_role,
      dashboardUrl: `/studio-dashboard/${result.studio_id}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo reclamar el acceso.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
