import { NextRequest, NextResponse } from "next/server";
import { handleMercadoPagoWebhook } from "@/core/billing/webhook";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const result = await handleMercadoPagoWebhook({
      request,
      admin: createAdminSupabase(),
      environment: "production",
    });
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    const status = (error as Error & { status?: number }).status || 500;
    const message = error instanceof Error ? error.message : "No se pudo procesar la notificación.";
    console.error("mercadopago_webhook_failed", { environment: "production", message });
    return NextResponse.json({ error: message }, { status });
  }
}
