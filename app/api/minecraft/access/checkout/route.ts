import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { getRatcraftPlan } from "@/lib/ratcraft-access";
import { getRatcraftUsdArsRate, ratcraftArsAmount } from "@/lib/server/ratcraft-pricing";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAME_RE = /^[A-Za-z0-9_.-]{1,32}$/;

export async function POST(request: NextRequest) {
  let createdId: string | null = null;

  try {
    if (!isBillingEnabled()) {
      return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    }

    const { user } = await requireUser(request);
    if (!user.email) return NextResponse.json({ error: "Tu cuenta necesita un correo válido para pagar." }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as {
      planCode?: unknown;
      minecraftName?: unknown;
      edition?: unknown;
    };

    const plan = getRatcraftPlan(body.planCode);
    const minecraftName = typeof body.minecraftName === "string" ? body.minecraftName.trim() : "";
    const edition = body.edition === "bedrock" ? "bedrock" : body.edition === "java" ? "java" : "";

    if (!plan) return NextResponse.json({ error: "Elegí un rango Ratcraft válido." }, { status: 400 });
    if (!NAME_RE.test(minecraftName)) {
      return NextResponse.json({ error: "El nick solo puede usar letras, números, punto, guion y guion bajo." }, { status: 400 });
    }
    if (!edition) return NextResponse.json({ error: "Elegí Java o Bedrock." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: existing, error: existingError } = await admin
      .from("ratcraft_access_passes")
      .select("id,plan_code,status")
      .ilike("minecraft_name", minecraftName)
      .eq("status", "approved")
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      return NextResponse.json({ error: "Ese nick ya tiene un pase activo en Ratcraft." }, { status: 409 });
    }

    const fx = await getRatcraftUsdArsRate();
    const amountArs = ratcraftArsAmount(plan.priceUsd, fx.localPerUsd);
    const externalReference = randomUUID();

    const { data: pass, error: insertError } = await admin
      .from("ratcraft_access_passes")
      .insert({
        user_id: user.id,
        minecraft_name: minecraftName,
        edition,
        amount: amountArs,
        currency: "ARS",
        plan_code: plan.code,
        price_usd: plan.priceUsd,
        fx_local_per_usd: fx.localPerUsd,
        benefits: plan.benefits,
        status: "pending",
        whitelist_status: "pending",
        external_reference: externalReference,
        payer_email: user.email.toLowerCase(),
      })
      .select("id,public_token")
      .single();
    if (insertError) throw new Error(insertError.message);
    createdId = pass.id;

    const appBase = (process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar").replace(/\/$/, "");
    const returnBase = `${appBase}/minecraft/checkout?pass=${encodeURIComponent(pass.public_token)}`;

    const preference = await new MercadoPagoProvider().createPreference({
      items: [{
        title: `Ratcraft — ${plan.name} — ${minecraftName}`,
        quantity: 1,
        unitPrice: amountArs,
        currency: "ARS",
      }],
      payer: { email: user.email },
      externalReference,
      backUrls: {
        success: `${returnBase}&return=success`,
        pending: `${returnBase}&return=pending`,
        failure: `${returnBase}&return=failure`,
      },
      notificationUrl: `${appBase}/api/webhooks/mercadopago/ratcraft-access`,
    });

    const initPoint = typeof preference.init_point === "string" ? preference.init_point : null;
    if (!initPoint) throw new Error("Mercado Pago no devolvió el checkout.");

    await admin
      .from("ratcraft_access_passes")
      .update({
        preference_id: typeof preference.id === "string" ? preference.id : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pass.id);

    return NextResponse.json({
      initPoint,
      passToken: pass.public_token,
      plan,
      amountArs,
      fx: { localPerUsd: fx.localPerUsd, quotedAt: fx.quotedAt },
    });
  } catch (error) {
    if (createdId) {
      const admin = createAdminSupabase();
      await admin
        .from("ratcraft_access_passes")
        .update({
          status: "cancelled",
          failure_reason: error instanceof Error ? error.message.slice(0, 500) : "checkout_error",
          updated_at: new Date().toISOString(),
        })
        .eq("id", createdId);
    }

    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar el pago." }, { status });
  }
}
