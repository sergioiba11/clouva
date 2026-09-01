import { NextRequest, NextResponse } from "next/server";
import { requirePlayerBasics } from "@/lib/server/player-basics";
import { requireSpaceTeamReviewAccess } from "@/lib/server/space-team-access";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUESTED_ROLES = new Set(["partner", "manager", "admin", "team"]);

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function responseError(error: unknown, fallback: string) {
  const typed = error as Error & { status?: number; code?: string };
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback, ...(typed.code ? { code: typed.code } : {}) },
    { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
  );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spaceId } = await params;
    const admin = createAdminSupabase();
    await requireSpaceTeamReviewAccess(admin, user.id, spaceId);

    const { data, error } = await admin
      .from("space_management_requests")
      .select("id,space_id,user_id,player_id,requested_role,message,status,reviewed_at,reviewed_by,decision_message,created_at,updated_at,player:players(id,display_name,username,profile_image_url)")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return NextResponse.json({ requests: data ?? [] });
  } catch (error) {
    return responseError(error, "No se pudieron cargar las solicitudes.");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spaceId } = await params;
    const body = (await request.json().catch(() => ({}))) as { requestedRole?: unknown; message?: unknown };
    const requestedRole = short(body.requestedRole, 40);
    const message = short(body.message, 2000);
    if (!REQUESTED_ROLES.has(requestedRole)) {
      return NextResponse.json({ error: "Elegí un rol válido.", code: "INVALID_REQUESTED_ROLE" }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const player = await requirePlayerBasics(admin, user.id);
    const { data: space, error: spaceError } = await admin
      .from("spaces")
      .select("id,public_enabled,status,owner_player_id")
      .eq("id", spaceId)
      .maybeSingle();
    if (spaceError) throw new Error(spaceError.message);
    if (!space || !space.public_enabled || space.status !== "active") {
      return NextResponse.json({ error: "Ese negocio o espacio no está disponible para solicitudes." }, { status: 404 });
    }
    if (String(space.owner_player_id) === player.id) {
      return NextResponse.json({ error: "Ya sos propietario de este espacio." }, { status: 409 });
    }

    const { data: member, error: memberError } = await admin
      .from("space_members")
      .select("id,role,status")
      .eq("space_id", spaceId)
      .eq("player_id", player.id)
      .eq("status", "active")
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (member) return NextResponse.json({ error: "Ya formás parte del equipo de este espacio." }, { status: 409 });

    const { data, error } = await admin
      .from("space_management_requests")
      .insert({
        space_id: spaceId,
        user_id: user.id,
        player_id: player.id,
        requested_role: requestedRole,
        message: message || null,
        status: "pending",
      })
      .select("id,space_id,user_id,player_id,requested_role,message,status,created_at")
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Ya tenés una solicitud pendiente para este espacio.", code: "REQUEST_ALREADY_PENDING" }, { status: 409 });
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ request: data, submitted: true, redirectTo: "/" }, { status: 201 });
  } catch (error) {
    return responseError(error, "No se pudo enviar la solicitud.");
  }
}
