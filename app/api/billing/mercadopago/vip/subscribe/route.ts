import { NextRequest, NextResponse } from "next/server";
import { createVipSubscription } from "@/core/billing/service";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (!isBillingEnabled()) return NextResponse.json({ error: "CLOUVA VIP todavía no está habilitado." }, { status: 503 });
    const { user } = await requireUser(request);
    if (!user.email) return NextResponse.json({ error: "Tu cuenta necesita un correo válido para suscribirse." }, { status: 400 });

    const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return NextResponse.json({ error: "Falta una clave de idempotencia válida." }, { status: 400 });
    }

    const result = await createVipSubscription({
      admin: createAdminSupabase(),
      userId: user.id,
      payerEmail: user.email,
      idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar CLOUVA VIP.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
