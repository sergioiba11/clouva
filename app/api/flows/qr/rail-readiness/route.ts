import { NextRequest, NextResponse } from "next/server";
import { getBindQrConfig, getBindQrReadiness } from "@/core/flows/payments/providers/bind/config";
import { isAdminEmail, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    if (!isAdminEmail(user.email)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const readiness = getBindQrReadiness(getBindQrConfig());
    return NextResponse.json({
      provider: readiness.provider,
      environment: readiness.environment,
      configured: readiness.configured,
      executionEnabled: readiness.executionEnabled,
      paymentExecutionReady: readiness.paymentExecutionReady,
      productionEnabled: readiness.productionEnabled,
      missing: readiness.missing,
      externalBlockers: [
        "Contrato/onboarding con BIND PSP para Wallet/QR interoperable",
        "Credenciales OAuth del ambiente correspondiente",
        "Cuenta/CVU de origen habilitada y fondeada para PCT",
        "Configuración de webhook PAGO_QR y CONTRACARGO_PAGO_QR",
        "Whitelist de IPs o mTLS acordado con BIND para webhooks",
        "Validación/homologación de QR interoperable antes de activar producción",
      ],
      webhookSecurity: readiness.webhookSecurity,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar el rail." }, { status: 401 });
  }
}
