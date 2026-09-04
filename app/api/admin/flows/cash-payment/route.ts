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
  return { adminUser: user, admin };
}

export async function POST(request: NextRequest) {
  try {
    const { adminUser, admin } = await requireAdmin(request);
    const body = (await request.json().catch(() => ({}))) as {
      payerPlayerId?: unknown;
      recipientPlayerId?: unknown;
      quantity?: unknown;
      reference?: unknown;
      note?: unknown;
      cashReceived?: unknown;
      idempotencyKey?: unknown;
    };

    const payerPlayerId = typeof body.payerPlayerId === "string" ? body.payerPlayerId.trim() : "";
    const recipientPlayerId = typeof body.recipientPlayerId === "string" ? body.recipientPlayerId.trim() : "";
    const quantity = Math.trunc(Number(body.quantity));
    const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 120) : "";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim().slice(0, 120) : "";

    if (!payerPlayerId || !recipientPlayerId || !Number.isFinite(quantity) || quantity < 1 || quantity > 1000 || !idempotencyKey) {
      return NextResponse.json({ error: "Faltan pagador, receptor, cantidad o clave de operación." }, { status: 400 });
    }
    if (body.cashReceived !== true) {
      return NextResponse.json({ error: "Tenés que confirmar explícitamente que CLOUVA recibió el efectivo." }, { status: 400 });
    }

    const { data, error } = await admin.rpc("register_flow_cash_payment", {
      p_payer_player_id: payerPlayerId,
      p_recipient_player_id: recipientPlayerId,
      p_quantity: quantity,
      p_reference: reference || null,
      p_note: note || null,
      p_idempotency_key: idempotencyKey,
      p_confirmed_by: adminUser.id,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json(data);
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo registrar el pago en efectivo.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    let playersQuery = admin
      .from("players")
      .select("id,display_name,slug,username,owner_user_id")
      .not("owner_user_id", "is", null)
      .limit(50);
    if (q) playersQuery = playersQuery.or(`display_name.ilike.%${q}%,slug.ilike.%${q}%,username.ilike.%${q}%`);

    const [{ data: players, error: playersError }, { data: pricing, error: pricingError }] = await Promise.all([
      playersQuery.order("display_name"),
      admin.from("flow_issuance_settings").select("flow_usd_value").eq("id", "canonical").single(),
    ]);
    if (playersError) throw new Error(playersError.message);
    if (pricingError) throw new Error(pricingError.message);

    return NextResponse.json({
      players: players ?? [],
      pricing: { flowUsdValue: Number(pricing.flow_usd_value), currency: "USD" },
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar los Players." }, { status });
  }
}
