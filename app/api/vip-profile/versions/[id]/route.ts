import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE_COPY_FIELDS = [
  "tagline", "short_bio", "seo_title", "seo_description", "share_title", "share_description",
] as const;

function sanitizeCopyPatch(body: unknown) {
  if (!body || typeof body !== "object") return {};
  const raw = body as Record<string, unknown>;
  const patch: Record<string, string | null> = {};
  for (const field of EDITABLE_COPY_FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    patch[field] = typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
  }
  return patch;
}

// Lets the VIP owner (or an admin) edit the Gemini-proposed copy on their own
// draft version before publishing -- spec section 16/22: "puedo revisarla,
// puedo editarla". Only touches whitelisted copy_config fields, and only
// while the version is still a draft (a published/archived version is a
// fixed snapshot -- editing it would silently rewrite history).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const { data: version, error: versionError } = await admin
      .from("player_profile_versions")
      .select("id,player_id,studio_id,status,copy_config")
      .eq("id", id)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);
    if (!version) return NextResponse.json({ error: "La versión no existe." }, { status: 404 });
    if (version.status !== "draft") {
      return NextResponse.json({ error: "Solo se puede editar una versión en borrador." }, { status: 409 });
    }

    await requireActiveVipEntitlement({
      admin,
      userId: user.id,
      playerId: (version.player_id as string | null) ?? undefined,
      studioId: (version.studio_id as string | null) ?? undefined,
    });

    const body = await request.json().catch(() => ({}));
    const patch = sanitizeCopyPatch(body);
    const nextCopyConfig = { ...(version.copy_config as Record<string, unknown>), ...patch };

    const { data: updated, error: updateError } = await admin
      .from("player_profile_versions")
      .update({ copy_config: nextCopyConfig })
      .eq("id", id)
      .eq("status", "draft")
      .select("id,copy_config")
      .single();
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ version: updated });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo editar la versión.";
    return NextResponse.json({ error: message }, { status });
  }
}
