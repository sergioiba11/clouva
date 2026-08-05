import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FULFILLMENT_STATES = new Set(["preparing", "ready_to_ship", "shipped", "delivered", "cancelled", "returned"]);

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

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "El identificador del pedido no es válido." }, { status: 400 });
    }

    const { adminUser, admin } = await requireAdmin(request);
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      fulfillmentStatus?: unknown;
      carrier?: unknown;
      trackingNumber?: unknown;
      trackingUrl?: unknown;
      labelUrl?: unknown;
      note?: unknown;
    };
    const action = cleanText(body.action, 80);

    if (action === "resolve_stock_conflict") {
      const { data, error } = await admin.rpc("admin_resolve_commerce_stock_conflict", {
        p_order_id: id,
        p_admin_user_id: adminUser.id,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ result: data });
    }

    if (action === "update_fulfillment") {
      const fulfillmentStatus = cleanText(body.fulfillmentStatus, 40);
      if (!FULFILLMENT_STATES.has(fulfillmentStatus)) {
        return NextResponse.json({ error: "El estado de preparación no está permitido." }, { status: 400 });
      }

      const { data, error } = await admin.rpc("admin_set_commerce_fulfillment", {
        p_order_id: id,
        p_fulfillment_status: fulfillmentStatus,
        p_carrier: cleanText(body.carrier, 160) || null,
        p_tracking_number: cleanText(body.trackingNumber, 200) || null,
        p_tracking_url: cleanText(body.trackingUrl, 1000) || null,
        p_label_url: cleanText(body.labelUrl, 1000) || null,
        p_note: cleanText(body.note, 500) || null,
        p_admin_user_id: adminUser.id,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ result: data });
    }

    return NextResponse.json({ error: "Acción administrativa no permitida." }, { status: 400 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo actualizar el pedido.";
    return NextResponse.json({ error: message }, { status });
  }
}
