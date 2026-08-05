import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = request.nextUrl.searchParams.get("token")?.trim() || "";
    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(token)) {
      return NextResponse.json({ error: "El acceso al pedido no es válido." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: order, error } = await admin
      .from("orders")
      .select("id,order_number,total,total_cents,currency,payment_status,shipping_status,status,paid_at")
      .eq("id", id)
      .eq("checkout_token", token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) {
      return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
    }

    return NextResponse.json(
      { order },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar el pedido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
