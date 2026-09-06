import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function cleanText(value: unknown, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function maskReference(value: string) {
  return value.length <= 6 ? value : `••••${value.slice(-6)}`;
}

export async function POST(request: NextRequest) {
  try {
    const { admin, user } = await requireAdmin(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = cleanText(body.name, 120);
    const provider = cleanText(body.provider, 80).toLowerCase();
    const accountType = cleanText(body.accountType, 80).toLowerCase();
    const currency = cleanText(body.currency, 3).toUpperCase();
    const accountReference = cleanText(body.accountReference, 180);

    if (!name || !provider || !accountType || !/^[A-Z]{3}$/.test(currency) || !accountReference) {
      return NextResponse.json({ error: "Faltan nombre, proveedor, tipo, moneda o referencia real de la Reserva." }, { status: 400 });
    }

    const { data: collisions, error: collisionError } = await admin
      .from("flow_reserve_accounts")
      .select("id,name,provider,flow_account_role,account_reference,status,is_active")
      .eq("account_reference", accountReference)
      .eq("is_active", true)
      .eq("status", "active")
      .limit(5);
    if (collisionError) throw new Error(collisionError.message);
    if ((collisions ?? []).some((row) => row.flow_account_role === "collection_rail")) {
      return NextResponse.json(
        { error: "La cuenta de cobro no puede reutilizarse como Reserva FLOW. Elegí una cuenta externa separada." },
        { status: 409 },
      );
    }
    if ((collisions ?? []).length) {
      return NextResponse.json({ error: "Esa referencia ya está registrada como una cuenta CLOUVA activa." }, { status: 409 });
    }

    const now = new Date().toISOString();
    const { data: created, error } = await admin
      .from("flow_reserve_accounts")
      .insert({
        name,
        provider,
        account_type: accountType,
        currency,
        account_reference: accountReference,
        flow_account_role: "reserve",
        authorized_for_collection: false,
        authorized_for_flow: true,
        authorized_at: now,
        authorized_by: user.id,
        status: "active",
        is_active: true,
        metadata: {
          purpose: "flow_reserve",
          authorizationMode: "explicit_admin_external_custody",
          authorizedAt: now,
          externalAccountCreatedByClouva: false,
          declaration: "Admin confirmó que esta referencia corresponde a una cuenta externa real y separada del rail de cobro.",
        },
        updated_at: now,
      })
      .select("id,name,provider,account_type,currency,account_reference,authorized_at")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      reserveAccount: {
        id: created.id,
        name: created.name,
        provider: created.provider,
        accountType: created.account_type,
        currency: created.currency,
        accountReference: maskReference(created.account_reference),
        authorizedAt: created.authorized_at,
      },
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo registrar la Reserva CLOUVA." }, { status });
  }
}
