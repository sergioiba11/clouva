import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { studioMembershipPlansSelect } from "@/lib/players-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = new Set([
  "name", "description", "price", "currency", "billingInterval", "benefits",
  "isActive", "isPublic", "displayOrder", "publicRoleKey", "publicRoleLabel",
  "areaKey", "areaLabel", "joinPolicy", "requiresApproval", "displayBadge",
]);
const JOIN_POLICIES = new Set(["automatic", "approval", "invitation_only"]);

function sanitizePatch(body: unknown) {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!EDITABLE_FIELDS.has(key)) continue;
    const value = raw[key];
    switch (key) {
      case "name":
        if (typeof value === "string" && value.trim()) patch.name = value.trim().slice(0, 100);
        break;
      case "description":
        patch.description = typeof value === "string" ? value.trim().slice(0, 2000) || null : null;
        break;
      case "price": {
        if (value !== null) {
          const price = Number(value);
          if (!Number.isFinite(price) || price < 0) throw new Error("El precio tiene que ser un número mayor o igual a 0.");
          patch.price = price;
        }
        break;
      }
      case "currency":
        if (typeof value === "string" && value.trim()) patch.currency = value.trim().slice(0, 3).toUpperCase();
        break;
      case "billingInterval":
        if (value === "month" || value === "year") patch.billing_interval = value;
        break;
      case "benefits":
        if (Array.isArray(value)) patch.benefits = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 200)).slice(0, 20);
        break;
      case "isActive": patch.is_active = Boolean(value); break;
      case "isPublic": patch.is_public = Boolean(value); break;
      case "displayOrder": patch.display_order = Math.floor(Number(value)) || 0; break;
      case "publicRoleKey":
        if (typeof value === "string" && value.trim()) patch.public_role_key = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 60);
        break;
      case "publicRoleLabel":
        if (typeof value === "string" && value.trim()) patch.public_role_label = value.trim().slice(0, 80);
        break;
      case "areaKey":
        if (typeof value === "string" && value.trim()) patch.area_key = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 60);
        break;
      case "areaLabel":
        if (typeof value === "string" && value.trim()) patch.area_label = value.trim().slice(0, 80);
        break;
      case "joinPolicy":
        if (typeof value === "string" && JOIN_POLICIES.has(value)) {
          patch.join_policy = value;
          patch.requires_approval = value === "approval";
        }
        break;
      case "requiresApproval": patch.requires_approval = Boolean(value); break;
      case "displayBadge": patch.display_badge = typeof value === "string" ? value.trim().slice(0, 40) || null : null; break;
    }
  }
  return patch;
}

async function loadPlan(admin: ReturnType<typeof createAdminSupabase>, studioId: string, planId: string) {
  const { data, error } = await admin.from("studio_membership_plans").select("id,studio_id,is_free").eq("id", planId).eq("studio_id", studioId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const notFound = new Error("El plan no existe.");
    (notFound as Error & { status?: number }).status = 404;
    throw notFound;
  }
  return data;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string; planId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId, planId } = await params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });
    const plan = await loadPlan(admin, studioId, planId);
    const patch = sanitizePatch(await request.json().catch(() => ({})));
    if (plan.is_free && (patch.price !== undefined || patch.billing_interval !== undefined)) throw new Error("Un plan gratuito no tiene precio ni frecuencia.");

    const { data, error } = await admin.from("studio_membership_plans").update(patch).eq("id", planId).select(studioMembershipPlansSelect).single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ plan: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo editar el plan.";
    return NextResponse.json({ error: message }, { status: message.includes("gratuito") || message.includes("número") ? 400 : status });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string; planId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId, planId } = await params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });
    await loadPlan(admin, studioId, planId);

    const { count, error: membersError } = await admin.from("studio_memberships").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    if (membersError) throw new Error(membersError.message);
    if (count && count > 0) {
      const conflict = new Error("No se puede borrar un plan con miembros. Desactivalo en su lugar.");
      (conflict as Error & { status?: number }).status = 409;
      throw conflict;
    }

    const { error } = await admin.from("studio_membership_plans").delete().eq("id", planId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo borrar el plan." }, { status });
  }
}
