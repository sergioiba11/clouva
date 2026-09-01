import { NextRequest, NextResponse } from "next/server";
import {
  isSpotRole,
  SPOT_ROLE_LABELS,
  SPOT_ROLES,
  type SpotRole,
} from "@/lib/commerce/spot-permissions";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSIGNABLE = new Set<SpotRole>(SPOT_ROLES.filter((role) => role !== "owner"));

function isAssignableRole(value: unknown): value is SpotRole {
  return isSpotRole(value) && value !== "owner" && ASSIGNABLE.has(value);
}

function mapRole(role: SpotRole) {
  return { id: role, label: SPOT_ROLE_LABELS[role] };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "settings" });
    const [membersResult, spaceResult] = await Promise.all([
      admin
        .from("commerce_spot_members")
        .select("id,spot_id,user_id,role,status,created_at,updated_at")
        .eq("spot_id", spotId)
        .order("created_at"),
      admin
        .from("spaces")
        .select("id")
        .eq("legacy_commerce_spot_id", spotId)
        .maybeSingle(),
    ]);
    if (membersResult.error) throw new Error(membersResult.error.message);
    if (spaceResult.error) throw new Error(spaceResult.error.message);
    return NextResponse.json({
      members: membersResult.data ?? [],
      roles: SPOT_ROLES.map(mapRole),
      spaceId: spaceResult.data?.id ?? null,
      requestsHref: spaceResult.data?.id ? `/businesses/${spaceResult.data.id}/team` : null,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar el equipo." }, { status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "team" });
    const body = (await request.json().catch(() => ({}))) as { userId?: string; role?: unknown };
    if (!body.userId || !isAssignableRole(body.role)) {
      return NextResponse.json({ error: "Usuario o rol inválido." }, { status: 400 });
    }
    const { data, error } = await admin
      .from("commerce_spot_members")
      .upsert({ spot_id: spotId, user_id: body.userId, role: body.role, status: "active", updated_at: new Date().toISOString() }, { onConflict: "spot_id,user_id" })
      .select("id,spot_id,user_id,role,status,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ member: data }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo guardar el miembro." }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "team" });
    const body = (await request.json().catch(() => ({}))) as { memberId?: string; role?: unknown; status?: unknown };
    if (!body.memberId) return NextResponse.json({ error: "Miembro inválido." }, { status: 400 });
    if (body.role !== undefined && !isAssignableRole(body.role)) return NextResponse.json({ error: "Ese rol no se puede asignar desde esta pantalla." }, { status: 400 });
    if (body.status !== undefined && (typeof body.status !== "string" || !["active", "invited", "disabled"].includes(body.status))) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.role !== undefined) patch.role = body.role;
    if (body.status !== undefined) patch.status = body.status;
    const { data, error } = await admin
      .from("commerce_spot_members")
      .update(patch)
      .eq("id", body.memberId)
      .eq("spot_id", spotId)
      .neq("role", "owner")
      .select("id,spot_id,user_id,role,status,created_at,updated_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "No podés modificar al propietario desde roles." }, { status: 409 });
    return NextResponse.json({ member: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el miembro." }, { status });
  }
}
