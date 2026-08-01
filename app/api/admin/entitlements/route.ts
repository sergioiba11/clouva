import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { createNotification } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The only server-side way to grant/revoke CLOUVA VIP by hand. Replaces the
// old /admin/clientes "VIP" toggle, which only flipped profiles.is_vip -- a
// separate, unrelated store-badge flag that requireActiveVipEntitlement and
// /api/billing/vip never look at. Writes go through the service role (not
// the caller's own RLS-scoped session) specifically so this can also record
// an admin_audit_log row in the same call -- that table has no client-side
// insert policy by design, on purpose, so a manual VIP grant is always
// traceable to the admin who did it.
async function requireAdmin(request: NextRequest) {
  const { user } = await requireUser(request);
  const admin = createAdminSupabase();
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.role !== "admin") {
    const forbidden = new Error("No autorizado.");
    (forbidden as Error & { status?: number }).status = 403;
    throw forbidden;
  }
  return { adminUser: user, admin };
}

export async function POST(request: NextRequest) {
  try {
    const { adminUser, admin } = await requireAdmin(request);
    const body = (await request.json().catch(() => ({}))) as { userId?: string; action?: "grant" | "revoke" };
    if (!body.userId || (body.action !== "grant" && body.action !== "revoke")) {
      return NextResponse.json({ error: "Falta userId o action." }, { status: 400 });
    }

    const { data: existing, error: existingError } = await admin
      .from("user_entitlements")
      .select("id,status,source")
      .eq("user_id", body.userId)
      .eq("product_code", "clouva_vip")
      .eq("tier", "vip")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    let entitlement: Record<string, unknown> | null = null;

    if (body.action === "grant") {
      const values = {
        status: "active",
        source: "admin",
        starts_at: new Date().toISOString(),
        expires_at: null,
        cancelled_at: null,
        created_by: adminUser.id,
      };
      const result = existing
        ? await admin.from("user_entitlements").update(values).eq("id", existing.id).select("*").single()
        : await admin.from("user_entitlements").insert({ user_id: body.userId, product_code: "clouva_vip", tier: "vip", ...values }).select("*").single();
      if (result.error) throw new Error(result.error.message);
      entitlement = result.data;
      await createNotification(admin, {
        userId: body.userId,
        type: "vip_granted",
        title: "¡Ganaste VIP en CLOUVA!",
        body: "Ya podés crear tu Estudio y desbloquear las funciones VIP.",
        link: "/profile/memberships",
      }).catch((cause) => {
        // La notificación es best-effort: un fallo acá no debe revertir el VIP ya otorgado.
        console.error("No se pudo crear la notificación de VIP", cause);
      });
    } else {
      if (!existing || existing.status !== "active") {
        return NextResponse.json({ error: "Este usuario no tiene VIP activo para revocar." }, { status: 409 });
      }
      const result = await admin
        .from("user_entitlements")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (result.error) throw new Error(result.error.message);
      entitlement = result.data;
    }

    await admin.from("admin_audit_log").insert({
      admin_user_id: adminUser.id,
      action: body.action === "grant" ? "grant_vip" : "revoke_vip",
      entity_type: "user_entitlements",
      entity_id: body.userId,
      previous_data: existing ?? null,
      new_data: entitlement,
    });

    return NextResponse.json({ entitlement });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo actualizar el VIP.";
    return NextResponse.json({ error: message }, { status });
  }
}
