import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CartItemInput = { serviceId?: unknown; quantity?: unknown };

// Studio services are still paid into CLOUVA's own Mercado Pago account
// (single merchant, same as clouva_vip) -- per-studio payouts (Mercado Pago
// Connect/OAuth) are deferred until the avatar work is done. This endpoint
// only creates the order + checkout preference; server always recomputes
// prices from studio_services, never trusts a client-sent amount.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!isBillingEnabled()) return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    const { user } = await requireUser(request);
    if (!user.email) return NextResponse.json({ error: "Tu cuenta necesita un correo válido para pagar." }, { status: 400 });
    const { slug: studioId } = await params;

    const body = (await request.json().catch(() => ({}))) as { items?: CartItemInput[] };
    const requested = Array.isArray(body.items) ? body.items : [];
    if (requested.length === 0) return NextResponse.json({ error: "El carrito está vacío." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: studio, error: studioError } = await admin
      .from("studios")
      .select("id,name,slug")
      .eq("id", studioId)
      .maybeSingle();
    if (studioError) throw new Error(studioError.message);
    if (!studio) return NextResponse.json({ error: "El Estudio no existe." }, { status: 404 });

    const serviceIds = [...new Set(requested.map((item) => String(item.serviceId || "")).filter(Boolean))].slice(0, 20);
    if (serviceIds.length === 0) return NextResponse.json({ error: "El carrito está vacío." }, { status: 400 });

    const { data: services, error: servicesError } = await admin
      .from("studio_services")
      .select("id,name,price,currency,price_type,is_active")
      .eq("studio_id", studioId)
      .in("id", serviceIds);
    if (servicesError) throw new Error(servicesError.message);

    // Prices and quantities are recomputed server-side from studio_services --
    // the client only ever supplies which service IDs + how many.
    const items: Array<{ title: string; quantity: number; unitPrice: number; currency: string }> = [];
    const orderItems: Array<{ service_id: string; name: string; price: number; quantity: number }> = [];
    for (const requestedItem of requested) {
      const serviceId = String(requestedItem.serviceId || "");
      const quantity = Math.max(1, Math.min(50, Math.floor(Number(requestedItem.quantity) || 0)));
      const service = services?.find((s) => s.id === serviceId);
      if (!service || !service.is_active || service.price_type !== "fixed" || service.price == null) continue;
      items.push({ title: service.name, quantity, unitPrice: Number(service.price), currency: service.currency });
      orderItems.push({ service_id: service.id, name: service.name, price: Number(service.price), quantity });
    }
    if (items.length === 0) return NextResponse.json({ error: "Ninguno de los servicios elegidos está disponible." }, { status: 400 });

    const currency = items[0].currency;
    const totalAmount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const externalReference = randomUUID();

    const { data: order, error: orderError } = await admin
      .from("service_orders")
      .insert({
        studio_id: studioId,
        user_id: user.id,
        items: orderItems,
        total_amount: totalAmount,
        currency,
        status: "pending",
        payment_status: "pending",
        external_reference: externalReference,
      })
      .select("id")
      .single();
    if (orderError) throw new Error(orderError.message);

    const appBase = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
    try {
      const preference = await new MercadoPagoProvider().createPreference({
        items,
        externalReference,
        backUrls: {
          success: `${appBase}/studios/${studio.slug}?order=${order.id}&status=success`,
          failure: `${appBase}/studios/${studio.slug}?order=${order.id}&status=failure`,
          pending: `${appBase}/studios/${studio.slug}?order=${order.id}&status=pending`,
        },
        notificationUrl: `${appBase}/api/webhooks/mercadopago/service-orders`,
      });
      const initPoint = typeof preference.init_point === "string" ? preference.init_point : null;
      if (!initPoint) throw new Error("Mercado Pago no devolvió el checkout.");
      return NextResponse.json({ orderId: order.id, initPoint });
    } catch (preferenceError) {
      await admin.from("service_orders").update({ status: "cancelled" }).eq("id", order.id);
      throw preferenceError;
    }
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo iniciar el pago.";
    return NextResponse.json({ error: message }, { status });
  }
}
