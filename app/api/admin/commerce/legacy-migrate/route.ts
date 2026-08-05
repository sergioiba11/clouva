import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin(request);
    const [{ data: status, error: statusError }, { data: issues, error: issuesError }] = await Promise.all([
      admin.from("commerce_legacy_compatibility_status").select("*").single(),
      admin
        .from("commerce_legacy_import_issues")
        .select("id,legacy_entity_type,legacy_id,issue_code,detail,metadata,first_seen_at,last_seen_at")
        .is("resolved_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(100),
    ]);
    if (statusError || issuesError) throw new Error(statusError?.message || issuesError?.message);
    return NextResponse.json({ status, issues: issues ?? [] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar la compatibilidad clásica.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { adminUser, admin } = await requireAdmin(request);
    const { data, error } = await admin.rpc("admin_migrate_legacy_store_to_commerce", {
      p_admin_user_id: adminUser.id,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo ejecutar la compatibilidad clásica.";
    return NextResponse.json({ error: message }, { status });
  }
}
