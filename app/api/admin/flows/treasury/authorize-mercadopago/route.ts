import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig, isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CollectionRailAccount = {
  id: string;
  name: string;
  account_reference: string | null;
  flow_account_role: string;
  authorized_for_collection: boolean;
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
          error: "La cuenta autenticada en Mercado Pago no coincide con el collector configurado para CLOUVA. No se autorizó el rail de cobro.",
          configuredCollectorId: collectorLabel(config.userId),
          reportedCollectorId: reportedCollectorId ? collectorLabel(reportedCollectorId) : null,
        },
        { status: 409 },
      );
    }

    const { data: rows, error: railError } = await admin
      .from("flow_reserve_accounts")
      .select("id,name,account_reference,flow_account_role,authorized_for_collection,metadata")
      .eq("provider", "mercadopago")
      .eq("currency", "ARS")
      .eq("is_active", true)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (railError) throw new Error(railError.message);

    const accounts = (rows ?? []) as CollectionRailAccount[];
    const exact = accounts.find((account) => account.account_reference === config.userId);
    const candidate = exact ?? accounts.find((account) => account.account_reference == null);
    if (!candidate) {
      return NextResponse.json(
        { error: "No existe una cuenta CLOUVA disponible para vincular este collector como rail de cobro. No se creó una cuenta automáticamente." },
        { status: 409 },
      );
    }

    if (
      candidate.flow_account_role === "collection_rail"
      && candidate.authorized_for_collection
      && candidate.account_reference === config.userId
    ) {
      return NextResponse.json({
        ok: true,
        alreadyAuthorized: true,
        collectionRailAccountId: candidate.id,
        collectionRailName: candidate.name,
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
        flow_account_role: "collection_rail",
        authorized_for_collection: true,
        collection_authorized_at: authorizedAt,
        collection_authorized_by: user.id,
        authorized_for_flow: false,
        authorized_at: null,
        authorized_by: null,
        metadata: {
          ...existingMetadata,
          purpose: "flow_collection_rail",
          authorizationMode: "explicit_admin_verified_provider",
          authorizedAt,
          mercadoPagoEnvironment: config.environment,
          mercadoPagoApplicationId: config.applicationId,
          providerIdentityVerified: true,
          processorIsNotReserve: true,
        },
        updated_at: authorizedAt,
      })
      .eq("id", candidate.id)
      .eq("is_active", true)
      .eq("status", "active")
      .select("id,name,account_reference,flow_account_role,authorized_for_collection,collection_authorized_at")
      .single();
    if (updateError) throw new Error(updateError.message);
    if (
      !updated?.authorized_for_collection
      || updated.flow_account_role !== "collection_rail"
      || updated.account_reference !== config.userId
    ) {
      throw new Error("El rail de cobro Mercado Pago no quedó autorizado correctamente.");
    }

    return NextResponse.json({
      ok: true,
      alreadyAuthorized: false,
      collectionRailAccountId: updated.id,
      collectionRailName: updated.name,
      collectorId: collectorLabel(config.userId),
      authorizedAt: updated.collection_authorized_at,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo autorizar el rail de cobro Mercado Pago.";
    console.error("flow_collection_rail_authorization_failed", { message });
    return NextResponse.json({ error: message }, { status });
  }
}
