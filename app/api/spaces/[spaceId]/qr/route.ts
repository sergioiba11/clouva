import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getOrCreateClouvaQr, serializeClouvaQr } from "@/lib/server/clouva-qr";
import { getSpaceAdminEligibility, requireSpaceAdminPlan } from "@/lib/server/space-access";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QR_ADMIN_ROLES = new Set(["owner", "admin", "manager"]);

async function controlledPlayerIds(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const [owned, memberships] = await Promise.all([
    admin.from("players").select("id").eq("owner_user_id", userId),
    admin.from("player_members").select("player_id,role").eq("user_id", userId).eq("status", "active").in("role", ["owner", "manager", "editor"]),
  ]);
  if (owned.error) throw new Error(owned.error.message);
  if (memberships.error) throw new Error(memberships.error.message);
  return new Set([
    ...(owned.data ?? []).map((row) => String(row.id)),
    ...(memberships.data ?? []).map((row) => String(row.player_id)),
  ]);
}

async function requireSpaceQrAccess(admin: ReturnType<typeof createAdminSupabase>, userId: string, spaceId: string) {
  const eligibility = await requireSpaceAdminPlan({ admin, userId });
  const { data: space, error } = await admin
    .from("spaces")
    .select("id,slug,name,type,owner_player_id,legacy_studio_id,legacy_commerce_spot_id,public_enabled,status")
    .eq("id", spaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!space) {
    const notFound = new Error("El espacio no existe.") as Error & { status?: number };
    notFound.status = 404;
    throw notFound;
  }
  if (eligibility.isGlobalAdmin) return space;

  const controlled = await controlledPlayerIds(admin, userId);
  if (controlled.has(String(space.owner_player_id))) return space;

  const { data: memberships, error: membershipError } = await admin
    .from("space_members")
    .select("player_id,role,status")
    .eq("space_id", spaceId)
    .eq("status", "active");
  if (membershipError) throw new Error(membershipError.message);
  const allowed = (memberships ?? []).some((membership) => controlled.has(String(membership.player_id)) && QR_ADMIN_ROLES.has(String(membership.role)));
  if (allowed) return space;

  const denied = new Error("No tenés permiso para administrar el QR de este espacio.") as Error & { status?: number; code?: string };
  denied.status = 403;
  denied.code = "SPACE_ROLE_FORBIDDEN";
  throw denied;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spaceId } = await params;
    const admin = createAdminSupabase();
    const space = await requireSpaceQrAccess(admin, user.id, spaceId);

    let destinationPath = `/spaces/${encodeURIComponent(space.slug)}`;
    let studioId: string | null = null;
    if (space.legacy_studio_id) {
      const { data: studio, error } = await admin.from("studios").select("id,slug").eq("id", space.legacy_studio_id).maybeSingle();
      if (error) throw new Error(error.message);
      if (studio) {
        studioId = studio.id;
        destinationPath = `/studios/${encodeURIComponent(studio.slug)}`;
      }
    }

    const allocated = await getOrCreateClouvaQr({
      admin,
      entityType: "SPACE",
      entityId: space.id,
      actorId: user.id,
      studioId,
      destinationPath,
      metadata: { space_type: space.type, space_slug: space.slug },
    });
    const qrDataUrl = await QRCode.toDataURL(allocated.url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 768,
    });
    const publicUrl = `${siteUrl.replace(/\/$/, "")}${destinationPath}`;

    return NextResponse.json({
      space: {
        id: space.id,
        name: space.name,
        slug: space.slug,
        type: space.type,
        publicEnabled: space.public_enabled,
        status: space.status,
      },
      publicUrl,
      qrDataUrl,
      qr: serializeClouvaQr(allocated.qr, allocated.created),
    });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    const status = typed.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo cargar el QR del espacio.",
      ...(typed.code ? { code: typed.code } : {}),
    }, { status });
  }
}
