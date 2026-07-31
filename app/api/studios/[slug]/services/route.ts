import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { studioServicesSelect } from "@/lib/players-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeServiceInput(body: unknown) {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 200) : "";
  if (!name) throw new Error("El nombre del servicio es obligatorio.");

  const priceType = raw.priceType === "consultar" ? "consultar" : "fixed";
  const price = priceType === "fixed" ? Number(raw.price) : null;
  if (priceType === "fixed" && (!Number.isFinite(price) || (price as number) < 0)) {
    throw new Error("El precio tiene que ser un número mayor o igual a 0.");
  }

  const ctaType = ["contratar", "reservar", "presupuesto"].includes(String(raw.ctaType)) ? String(raw.ctaType) : "contratar";

  return {
    name,
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 2000) || null : null,
    category: typeof raw.category === "string" ? raw.category.trim().slice(0, 100) || null : null,
    price_type: priceType,
    price,
    currency: typeof raw.currency === "string" && raw.currency.trim() ? raw.currency.trim().slice(0, 3).toUpperCase() : "ARS",
    duration_minutes: Number.isFinite(Number(raw.durationMinutes)) && raw.durationMinutes ? Math.max(0, Math.floor(Number(raw.durationMinutes))) : null,
    cta_type: ctaType,
    image_url: typeof raw.imageUrl === "string" ? raw.imageUrl.trim() || null : null,
    is_active: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });

    const { data, error } = await admin
      .from("studio_services")
      .select(studioServicesSelect)
      .eq("studio_id", studioId)
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);

    return NextResponse.json({ services: data ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudieron cargar los servicios.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });

    const body = await request.json().catch(() => ({}));
    const values = sanitizeServiceInput(body);

    const { data: last } = await admin
      .from("studio_services")
      .select("display_order")
      .eq("studio_id", studioId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await admin
      .from("studio_services")
      .insert({ ...values, studio_id: studioId, created_by: user.id, display_order: ((last?.display_order as number | null) ?? -1) + 1 })
      .select(studioServicesSelect)
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ service: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo crear el servicio.";
    return NextResponse.json({ error: message }, { status: message.includes("obligatorio") || message.includes("número") ? 400 : status });
  }
}
