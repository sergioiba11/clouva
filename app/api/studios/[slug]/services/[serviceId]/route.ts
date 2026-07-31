import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { studioServicesSelect } from "@/lib/players-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = new Set([
  "name", "description", "category", "priceType", "price", "currency",
  "durationMinutes", "ctaType", "imageUrl", "isActive", "displayOrder",
]);

function sanitizePatch(body: unknown) {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!EDITABLE_FIELDS.has(key)) continue;
    const value = raw[key];
    switch (key) {
      case "name":
        if (typeof value === "string" && value.trim()) patch.name = value.trim().slice(0, 200);
        break;
      case "description":
        patch.description = typeof value === "string" ? value.trim().slice(0, 2000) || null : null;
        break;
      case "category":
        patch.category = typeof value === "string" ? value.trim().slice(0, 100) || null : null;
        break;
      case "priceType":
        if (value === "fixed" || value === "consultar") patch.price_type = value;
        break;
      case "price":
        patch.price = value === null ? null : Number(value);
        break;
      case "currency":
        if (typeof value === "string" && value.trim()) patch.currency = value.trim().slice(0, 3).toUpperCase();
        break;
      case "durationMinutes":
        patch.duration_minutes = value ? Math.max(0, Math.floor(Number(value))) : null;
        break;
      case "ctaType":
        if (["contratar", "reservar", "presupuesto"].includes(String(value))) patch.cta_type = value;
        break;
      case "imageUrl":
        patch.image_url = typeof value === "string" ? value.trim() || null : null;
        break;
      case "isActive":
        patch.is_active = Boolean(value);
        break;
      case "displayOrder":
        patch.display_order = Math.floor(Number(value)) || 0;
        break;
    }
  }
  return patch;
}

async function loadService(admin: ReturnType<typeof createAdminSupabase>, studioId: string, serviceId: string) {
  const { data, error } = await admin
    .from("studio_services")
    .select("id,studio_id")
    .eq("id", serviceId)
    .eq("studio_id", studioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const notFound = new Error("El servicio no existe.");
    (notFound as Error & { status?: number }).status = 404;
    throw notFound;
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string; serviceId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId, serviceId } = await params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });
    await loadService(admin, studioId, serviceId);

    const patch = sanitizePatch(await request.json().catch(() => ({})));
    const { data, error } = await admin
      .from("studio_services")
      .update(patch)
      .eq("id", serviceId)
      .select(studioServicesSelect)
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ service: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo editar el servicio.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string; serviceId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId, serviceId } = await params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });
    await loadService(admin, studioId, serviceId);

    const { error } = await admin.from("studio_services").delete().eq("id", serviceId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo borrar el servicio.";
    return NextResponse.json({ error: message }, { status });
  }
}
