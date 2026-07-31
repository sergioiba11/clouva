import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig } from "@/core/billing/providers/mercadopago/config";
import { isApprovedPayment } from "@/core/billing/providers/mercadopago/mapper";
import { verifyMercadoPagoSignature } from "@/core/billing/providers/mercadopago/signature";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

// Same signature/ownership/amount verification as
// /api/webhooks/mercadopago/service-orders, targeting commerce_orders
// instead. On confirmed payment it also: decrements stock (only now, never
// at checkout time, so an abandoned checkout never locks stock), and grants
// commerce_inventory -- cloning the seller's clothing_items row for
// avatar_item purchases (spec: purchase adds to inventory, the Analyzer
// never re-runs, equipping stays a separate explicit action).
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: string | number;
      type?: string;
      topic?: string;
      data?: { id?: string | number };
    };
    const topic = text(body.type || body.topic).toLowerCase();
    const resourceId = text(body.data?.id || request.nextUrl.searchParams.get("data.id") || request.nextUrl.searchParams.get("id"));
    if (!topic || !resourceId) return NextResponse.json({ error: "Notificación sin tipo o recurso." }, { status: 400 });
    if (topic !== "payment") return NextResponse.json({ received: true, ignored: true, topic });

    const requestId = request.headers.get("x-request-id") || "";
    const signatureHeader = request.headers.get("x-signature") || "";
    const config = getMercadoPagoConfig("production");
    if (!verifyMercadoPagoSignature({ xSignature: signatureHeader, xRequestId: requestId, dataId: resourceId, secret: config.webhookSecret })) {
      return NextResponse.json({ error: "Firma de Mercado Pago inválida." }, { status: 401 });
    }

    const provider = new MercadoPagoProvider(config);
    const payment = await provider.getPayment(resourceId);
    if (payment.application_id && text(payment.application_id) !== config.applicationId) {
      return NextResponse.json({ error: "El pago pertenece a otra aplicación." }, { status: 400 });
    }
    if (payment.collector_id && text(payment.collector_id) !== config.userId) {
      return NextResponse.json({ error: "El pago pertenece a otro vendedor." }, { status: 400 });
    }

    const externalReference = text(payment.external_reference);
    if (!externalReference) return NextResponse.json({ error: "El pago no tiene external_reference." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: order, error: orderError } = await admin
      .from("commerce_orders")
      .select("id,buyer_id,total,currency,payment_status")
      .eq("external_reference", externalReference)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) return NextResponse.json({ error: "No encontramos la orden interna de ese pago." }, { status: 404 });

    if (order.payment_status === "paid") return NextResponse.json({ received: true, duplicate: true });

    if (!isApprovedPayment(payment.status)) {
      await admin.from("commerce_orders").update({ payment_status: "failed" }).eq("id", order.id).eq("payment_status", "pending");
      return NextResponse.json({ received: true, processed: false, reason: `payment_${text(payment.status) || "unknown"}` });
    }

    const amount = Number(payment.transaction_amount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(order.total)) > 0.01) {
      throw new Error("El importe del pago no coincide con la orden.");
    }
    if (text(payment.currency_id) !== order.currency) {
      throw new Error("La moneda del pago no coincide con la orden.");
    }

    const { data: updatedOrder, error: updateError } = await admin
      .from("commerce_orders")
      .update({ payment_status: "paid", status: "confirmed", external_payment_id: resourceId, paid_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("payment_status", "pending")
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updatedOrder) return NextResponse.json({ received: true, duplicate: true });

    const { data: orderItems, error: itemsError } = await admin
      .from("commerce_order_items")
      .select("id,product_id,product_type,quantity")
      .eq("order_id", order.id);
    if (itemsError) throw new Error(itemsError.message);

    for (const item of orderItems ?? []) {
      // Best-effort stock decrement -- doesn't fail the whole webhook if a
      // product was deleted since checkout; the payment is already real.
      await admin.rpc("decrement_commerce_product_stock", { p_product_id: item.product_id, p_quantity: item.quantity }).then(
        () => {},
        () => {},
      );

      let clothingItemId: string | null = null;
      if (item.product_type === "avatar_item") {
        const { data: product } = await admin.from("commerce_products").select("avatar_asset_id").eq("id", item.product_id).maybeSingle();
        if (product?.avatar_asset_id) {
          const { data: sourceGarment } = await admin
            .from("clothing_items")
            .select("name,category,fit,color,model_url,thumbnail_url,metadata")
            .eq("id", product.avatar_asset_id)
            .maybeSingle();
          if (sourceGarment) {
            const { data: cloned } = await admin
              .from("clothing_items")
              .insert({
                user_id: order.buyer_id,
                name: sourceGarment.name,
                category: sourceGarment.category,
                fit: sourceGarment.fit,
                color: sourceGarment.color,
                model_url: sourceGarment.model_url,
                thumbnail_url: sourceGarment.thumbnail_url,
                status: "ready",
                metadata: { ...(sourceGarment.metadata as Record<string, unknown> ?? {}), purchased_from_product_id: item.product_id },
              })
              .select("id")
              .single();
            clothingItemId = cloned?.id ?? null;
          }
        }
      }

      await admin.from("commerce_inventory").insert({
        user_id: order.buyer_id,
        order_item_id: item.id,
        product_id: item.product_id,
        clothing_item_id: clothingItemId,
      });
    }

    return NextResponse.json({ received: true, processed: true, orderId: order.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar la notificación.";
    console.error("mercadopago_commerce_orders_webhook_failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
