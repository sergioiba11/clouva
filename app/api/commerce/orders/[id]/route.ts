import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, readBearerToken } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const checkoutToken = request.nextUrl.searchParams.get("token")?.trim() || "";
    const accessToken = readBearerToken(request);

    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "El identificador del pedido no es válido." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: order, error: orderError } = await admin
      .from("commerce_orders")
      .select(
        "id,buyer_id,seller_type,seller_player_id,seller_studio_id,subtotal,shipping_subtotal,total,currency,status,payment_status,fulfillment_status,checkout_token,created_at,paid_at,completed_at,refunded_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) {
      return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
    }

    let authorized = UUID_PATTERN.test(checkoutToken) && checkoutToken === order.checkout_token;
    if (!authorized && accessToken) {
      const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
      authorized = !authError && authData.user?.id === order.buyer_id;
    }
    if (!authorized) {
      return NextResponse.json({ error: "No tenés acceso a este pedido." }, { status: 403 });
    }

    const [{ data: items, error: itemsError }, { data: shipment, error: shipmentError }, { data: events, error: eventsError }] =
      await Promise.all([
        admin
          .from("commerce_order_items")
          .select(
            "id,product_id,variant_id,product_name,product_type,sku_snapshot,variant_snapshot,quantity,unit_price,total,delivery_status,delivered_at",
          )
          .eq("order_id", id)
          .order("id"),
        admin
          .from("commerce_shipments")
          .select(
            "id,recipient_name,recipient_phone,recipient_email,address_line_1,address_line_2,city,province,postal_code,country,delivery_method,carrier,shipping_cost,status,tracking_number,tracking_url,label_url,shipping_method_snapshot,shipped_at,delivered_at,created_at,updated_at",
          )
          .eq("order_id", id)
          .eq("shipment_group", "primary")
          .maybeSingle(),
        admin
          .from("commerce_order_events")
          .select("id,event_type,note,metadata,created_at")
          .eq("order_id", id)
          .order("created_at", { ascending: true }),
      ]);
    if (itemsError || shipmentError || eventsError) {
      throw new Error(itemsError?.message || shipmentError?.message || eventsError?.message);
    }

    const publicOrder = {
      id: order.id,
      seller_type: order.seller_type,
      subtotal: order.subtotal,
      shipping_subtotal: order.shipping_subtotal,
      total: order.total,
      currency: order.currency,
      status: order.status,
      payment_status: order.payment_status,
      fulfillment_status: order.fulfillment_status,
      created_at: order.created_at,
      paid_at: order.paid_at,
      completed_at: order.completed_at,
      refunded_at: order.refunded_at,
    };

    return NextResponse.json(
      { order: publicOrder, items: items ?? [], shipment: shipment ?? null, events: events ?? [] },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar el pedido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
