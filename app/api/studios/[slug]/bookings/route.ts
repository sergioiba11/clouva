import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// cta_type = 'reservar' finally has a backend. price_type 'consultar'
// services just create a requested booking for the studio to confirm by
// hand -- no invented price. price_type 'fixed' services go through the
// same Checkout Pro pattern as service_orders (still CLOUVA's own Mercado
// Pago account, no per-studio payouts yet, matching studio_services_and_orders).
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as { serviceId?: unknown; scheduledAt?: unknown; durationMinutes?: unknown; notes?: unknown };

    const serviceId = String(body.serviceId || "");
    const scheduledAtRaw = String(body.scheduledAt || "");
    const scheduledAt = new Date(scheduledAtRaw);
    if (!serviceId || Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: "Falta el servicio o la fecha de la reserva." }, { status: 400 });
    }
    if (scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "La fecha de la reserva debe ser futura." }, { status: 400 });
    }
    const durationMinutes = Math.max(15, Math.min(480, Math.floor(Number(body.durationMinutes) || 60)));
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : null;

    const admin = createAdminSupabase();
    const { data: service, error: serviceError } = await admin
      .from("studio_services")
      .select("id,studio_id,name,price,currency,price_type,cta_type,is_active")
      .eq("id", serviceId)
      .eq("studio_id", studioId)
      .maybeSingle();
    if (serviceError) throw new Error(serviceError.message);
    if (!service || !service.is_active) return NextResponse.json({ error: "El servicio no existe o no está activo." }, { status: 404 });
    if (service.cta_type !== "reservar") return NextResponse.json({ error: "Este servicio no acepta reservas." }, { status: 400 });

    if (service.price_type !== "fixed" || service.price == null) {
      const { data: booking, error: bookingError } = await admin
        .from("bookings")
        .insert({
          service_id: service.id,
          studio_id: studioId,
          buyer_id: user.id,
          scheduled_at: scheduledAt.toISOString(),
          duration_minutes: durationMinutes,
          status: "requested",
          price: null,
          payment_status: "not_required",
          notes,
        })
        .select("*")
        .single();
      if (bookingError) throw new Error(bookingError.message);
      return NextResponse.json({ booking, initPoint: null });
    }

    if (!isBillingEnabled()) return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    if (!user.email) return NextResponse.json({ error: "Tu cuenta necesita un correo válido para pagar." }, { status: 400 });

    const externalReference = randomUUID();
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .insert({
        service_id: service.id,
        studio_id: studioId,
        buyer_id: user.id,
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: durationMinutes,
        status: "requested",
        price: service.price,
        currency: service.currency,
        payment_status: "pending",
        external_reference: externalReference,
        notes,
      })
      .select("id")
      .single();
    if (bookingError) throw new Error(bookingError.message);

    const { data: studio, error: studioError } = await admin.from("studios").select("slug").eq("id", studioId).maybeSingle();
    if (studioError) throw new Error(studioError.message);

    const appBase = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
    try {
      const preference = await new MercadoPagoProvider().createPreference({
        items: [{ title: `Reserva: ${service.name}`, quantity: 1, unitPrice: Number(service.price), currency: service.currency }],
        externalReference,
        backUrls: {
          success: `${appBase}/studios/${studio?.slug ?? studioId}?booking=${booking.id}&status=success`,
          failure: `${appBase}/studios/${studio?.slug ?? studioId}?booking=${booking.id}&status=failure`,
          pending: `${appBase}/studios/${studio?.slug ?? studioId}?booking=${booking.id}&status=pending`,
        },
        notificationUrl: `${appBase}/api/webhooks/mercadopago/bookings`,
      });
      const initPoint = typeof preference.init_point === "string" ? preference.init_point : null;
      if (!initPoint) throw new Error("Mercado Pago no devolvió el checkout.");
      return NextResponse.json({ bookingId: booking.id, initPoint });
    } catch (preferenceError) {
      await admin.from("bookings").update({ status: "cancelled" }).eq("id", booking.id);
      throw preferenceError;
    }
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo crear la reserva.";
    return NextResponse.json({ error: message }, { status });
  }
}
