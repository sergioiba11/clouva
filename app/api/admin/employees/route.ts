import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(request: NextRequest) {
  const { user } = await requireUser(request);
  const admin = createAdminSupabase();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("role,role_v2")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (profile?.role !== "admin" && profile?.role_v2 !== "admin") {
    const forbidden = new Error("No autorizado.");
    (forbidden as Error & { status?: number }).status = 403;
    throw forbidden;
  }

  return { admin, user };
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin(request);
    const { data, error } = await admin
      .from("profiles")
      .select("id,display_name,full_name,email,role,role_v2")
      .or("role.eq.empleado,role_v2.eq.empleado,role.eq.admin,role_v2.eq.admin")
      .order("display_name", { ascending: true })
      .limit(200);

    if (error) throw new Error(error.message);
    return NextResponse.json({ employees: data ?? [] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudieron cargar los empleados.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, user: actor } = await requireAdmin(request);
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) return NextResponse.json({ error: "Falta el email del usuario." }, { status: 400 });

    const { data: profile, error: findError } = await admin
      .from("profiles")
      .select("id,email,role,role_v2")
      .ilike("email", email)
      .maybeSingle();

    if (findError) throw new Error(findError.message);
    if (!profile?.id) return NextResponse.json({ error: "No existe un perfil CLOUVA con ese email." }, { status: 404 });
    if (profile.id === actor.id) return NextResponse.json({ error: "No podés cambiar tu propia cuenta administrativa desde Empleados." }, { status: 400 });
    if (profile.role === "admin" || profile.role_v2 === "admin") {
      return NextResponse.json({ error: "La cuenta ya es administradora y no se modifica desde Empleados." }, { status: 409 });
    }

    const { data: updated, error: updateError } = await admin
      .from("profiles")
      .update({ role: "empleado", role_v2: "empleado" })
      .eq("id", profile.id)
      .select("id,display_name,full_name,email,role,role_v2")
      .single();

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json(
      { employee: updated, message: "Empleado habilitado correctamente. No recibió permisos de administrador." },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo habilitar el empleado.";
    return NextResponse.json({ error: message }, { status });
  }
}
