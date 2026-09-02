import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BookingRpcRow = { booking_id: string; agenda_event_id: string };

async function createCanonicalBooking(args: {
  admin: ReturnType<typeof createAdminSupabase>;
  serviceId: string;
  studioId: string;
  buyerUserId: string;
  scheduledAt: string;
  durationMinutes: number;
  price: number | null;
  currency: string;
  paymentStatus: "not_required" | "pending";
  externalReference?: string | null;
  notes?: string | null;
}) {
  const { data, error } = await args.admin.rpc("create_studio_booking_with_agenda", {
    p_service_id: args.serviceId,
    p_studio_id: args.studioId,
    p_buyer_user_id: args.buyerUserId,
    p_scheduled_at: args.scheduledAt,
    p_duration_minutes: args.durationMinutes,
    p_price: args.price,
    p_currency: args.currency,
    p_payment_status: args.paymentStatus,
    p_external_reference: args.externalReference ?? null,
    p_notes: args.notes ?? null,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as BookingRpcRow | null;
  if (!row?.booking_id || !row?.agenda_event_id) throw new Error("No se pudo crear la reserva canónica.");
  return row;
}

// Booking and Agenda are one scheduling operation. The DB RPC creates the
// booking, its canonical event, participants and collision-protected slot in
// one transaction. Checkout Pro is still the existing payment layer.
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
      const canonical = await createCanonicalBooking({
        admin,
        serviceId: service.id,
        studioId,
        buyerUserId: user.id,
        scheduledAt: scheduledAt.toISOString(),
        durationMinutes,
        price: null,
        currency: service.currency || "ARS",
        paymentStatus: "not_required",
        notes,
      });
      const { data: booking, error: bookingError } = await admin.from("bookings").select("*").eq("id", canonical.booking_id).single();
      if (bookingError) throw new Error(bookingError.message);
      return NextResponse.json({ booking, agendaEventId: canonical.agenda_event_id, initPoint: null });
    }

    if (!isBillingEnabled()) return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    if (!user.email) return NextResponse.json({ error: "Tu cuenta necesita un correo válido para pagar." }, { status: 400 });

    const externalReference = randomUUID();
    const canonical = await createCanonicalBooking({
      admin,
      serviceId: service.id,
      studioId,
      buyerUserId: user.id,
      scheduledAt: scheduledAt.toISOString(),
      durationMinutes,
      price: Number(service.price),
      currency: service.currency,
      paymentStatus: "pending",
      externalReference,
      notes,
    });

    const { data: studio, error: studioError } = await admin.from("studios").select("slug").eq("id", studioId).maybeSingle();
    if (studioError) throw new Error(studioError.message);

    const appBase = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
    try {
      const preference = await new MercadoPagoProvider().createPreference({
        items: [{ title: `Reserva: ${service.name}`, quantity: 1, unitPrice: Number(service.price), currency: service.currency }],
        externalReference,
        backUrls: {
          success: `${appBase}/studios/${studio?.slug ?? studioId}?booking=${canonical.booking_id}&status=success`,
          failure: `${appBase}/studios/${studio?.slug ?? studioId}?booking=${canonical.booking_id}&status=failure`,
          pending: `${appBase}/studios/${studio?.slug ?? studioId}?booking=${canonical.booking_id}&status=pending`,
        },
        notificationUrl: `${appBase}/api/webhooks/mercadopago/bookings`,
      });
      const initPoint = typeof preference.init_point === "string" ? preference.init_point : null;
      if (!initPoint) throw new Error("Mercado Pago no devolvió el checkout.");
      return NextResponse.json({ bookingId: canonical.booking_id, agendaEventId: canonical.agenda_event_id, initPoint });
    } catch (preferenceError) {
      // The booking trigger also cancels the canonical event and releases its slot.
      await admin.from("bookings").update({ status: "cancelled", payment_status: "failed" }).eq("id", canonical.booking_id);
      throw preferenceError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la reserva.";
    const conflict = /horario ya no está disponible|conflict|overlap|23P01/i.test(message);
    const status = conflict ? 409 : ((error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500));
    return NextResponse.json({ error: conflict ? "Ese horario ya no está disponible." : message }, { status });
  }
}
