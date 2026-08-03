import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sha256 } from "@/core/integrations/instagram/crypto";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["owner", "admin", "manager", "editor", "finance", "bookings", "support"]);

function authorized(request: NextRequest) {
  const expected = process.env.INTERNAL_RECONCILIATION_SECRET?.trim();
  const received = request.headers.get("x-clouva-internal-secret")?.trim();
  return Boolean(expected && received && expected === received);
}

export async function POST(request: NextRequest) {
  try {
    if (!authorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as {
      studioSlug?: string;
      invitedEmail?: string;
      invitedUserId?: string;
      role?: string;
      expiresInHours?: number;
      createdBy?: string;
    };
    const studioSlug = body.studioSlug?.trim().toLowerCase();
    const invitedEmail = body.invitedEmail?.trim().toLowerCase() || null;
    const invitedUserId = body.invitedUserId?.trim() || null;
    const role = body.role?.trim().toLowerCase() || "manager";
    if (!studioSlug || (!invitedEmail && !invitedUserId) || !ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: "Completá Estudio, identidad invitada y rol válido." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: studio, error: studioError } = await admin
      .from("studios")
      .select("id,slug,name,studio_os_status")
      .eq("slug", studioSlug)
      .maybeSingle();
    if (studioError) throw new Error(studioError.message);
    if (!studio) return NextResponse.json({ error: "No encontramos ese Estudio." }, { status: 404 });

    await admin
      .from("studio_access_claims")
      .update({ status: "cancelled" })
      .eq("studio_id", studio.id)
      .eq("status", "pending")
      .or([
        invitedEmail ? `invited_email.eq.${invitedEmail}` : "",
        invitedUserId ? `invited_user_id.eq.${invitedUserId}` : "",
      ].filter(Boolean).join(","));

    const rawToken = randomBytes(32).toString("base64url");
    const expiresInHours = Math.max(1, Math.min(720, Number(body.expiresInHours) || 168));
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
    const { data: claim, error } = await admin
      .from("studio_access_claims")
      .insert({
        studio_id: studio.id,
        invited_email: invitedEmail,
        invited_user_id: invitedUserId,
        role,
        token_hash: sha256(rawToken),
        requires_vip: false,
        status: "pending",
        expires_at: expiresAt,
        created_by: body.createdBy || null,
      })
      .select("id,studio_id,role,requires_vip,expires_at")
      .single();
    if (error) throw new Error(error.message);

    const base = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
    return NextResponse.json({
      claim,
      claimUrl: `${base}/studio-access/claim?token=${encodeURIComponent(rawToken)}`,
      token: rawToken,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la invitación.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
