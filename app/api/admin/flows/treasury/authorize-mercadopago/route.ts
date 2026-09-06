import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig, isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReserveAccount = {
  id: string;
  name: string;
  account_reference: string | null;
  authorized_for_flow: boolean;
  metadata: Record<string, unknown> | null;
};

async function requireAdmin(request: NextRequest) {
  const { user } = await requireUser(request);
  const admin = createAdminSupabase();
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.role !== "admin") {
    const forbidden = new Error("No autorizado.");
    (forbidden as Error & { status?: number }).status = 403;
    throw forbidden;
  }
  return { admin, user };
}

function collectorLabel(value: string) {
  return value.length <= 6 ? value : `••••${value.slice(-6)}`;
}

export async function POST(request: NextRequest) {
  try {
    if (!isBillingEnabled()) {
      return NextResponse.json({ error: "Mercado Pago no está habilitado." }, { status: 503 });
    }

    const { admin, user } = await requireAdmin(request);
    const config = getMercadoPagoConfig();
    const mercadoPago = new MercadoPagoProvider(config);
    const currentUser = await mercadoPago.getCurrentUser();
    const reportedCollectorId = currentUser.id == null ? "" : String(currentUser.id);

    if (!reportedCollectorId || reportedCollectorId !== config.userId) {
      return NextResponse.json(
        {
          error: "La cuenta autenticada en Mercado Pago no coincide con el collector configurado para CLOUVA. No se autorizó ninguna reserva.",
          configuredCollectorId: collectorLabel(config.userId),
          reportedCollectorId: reportedCollectorId ? collectorLabel(reportedCollectorId) : null,
        },
        { status: 409 },
      );
    }

    const { data: rows, error: reserveError } = await admin
      .from("flow_reserve_accounts")
      .select("id,name,account_reference,authorized_for_flow,metadata")
      .eq("provider", "mercadopago")
      .eq("currency", "ARS")
      .eq("is_active", true)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (reserveError) throw new Error(reserveError.message);

    const accounts = (rows ?? []) as ReserveAccount[];
    const exact = accounts.find((account) => account.account_reference === config.userId);
    const candidate = exact ?? accounts.find((account) => account.account_reference == null);
    if (!candidate) {
      return NextResponse.json(
        { error: "No existe una Cuenta de Reserva CLOUVA disponible para autorizar este collector. No se creó una cuenta automáticamente." },
        { status: 409 },
      );
    }

    if (candidate.authorized_for_flow && candidate.account_reference === config.userId) {
      return NextResponse.json({
        ok: true,
        alreadyAuthorized: true,
        reserveAccountId: candidate.id,
        reserveName: candidate.name,
        collectorId: collectorLabel(config.userId),
      });
    }

    const authorizedAt = new Date().toISOString();
    const existingMetadata = candidate.metadata && typeof candidate.metadata === "object" && !Array.isArray(candidate.metadata)
      ? candidate.metadata
      : {};
    const { data: updated, error: updateError } = await admin
      .from("flow_reserve_accounts")
      .update({
        account_reference: config.userId,
        authorized_for_flow: true,
        authorized_at: authorizedAt,
        authorized_by: user.id,
        metadata: {
          ...existingMetadata,
          purpose: "flow_reserve",
          authorizationMode: "explicit_admin_verified_provider",
          authorizedAt,
          mercadoPagoEnvironment: config.environment,
          mercadoPagoApplicationId: config.applicationId,
          providerIdentityVerified: true,
        },
        updated_at: authorizedAt,
      })
      .eq("id", candidate.id)
      .eq("is_active", true)
      .eq("status", "active")
      .select("id,name,account_reference,authorized_for_flow,authorized_at")
      .single();
    if (updateError) throw new Error(updateError.message);
    if (!updated?.authorized_for_flow || updated.account_reference !== config.userId) {
      throw new Error("La Cuenta de Reserva no quedó autorizada correctamente.");
    }

    return NextResponse.json({
      ok: true,
      alreadyAuthorized: false,
      reserveAccountId: updated.id,
      reserveName: updated.name,
      collectorId: collectorLabel(config.userId),
      authorizedAt: updated.authorized_at,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo autorizar la Cuenta de Reserva FLOW.";
    console.error("flow_reserve_authorization_failed", { message });
    return NextResponse.json({ error: message }, { status });
  }
}
