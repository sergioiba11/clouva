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
      buyerPlayerId?: unknown;
      recipientPlayerId?: unknown;
      quantity?: unknown;
      amount?: unknown;
      currency?: unknown;
      reference?: unknown;
      note?: unknown;
    };
    const buyerPlayerId = typeof body.buyerPlayerId === "string" ? body.buyerPlayerId.trim() : "";
    const recipientPlayerId = typeof body.recipientPlayerId === "string" ? body.recipientPlayerId.trim() : "";
    const quantity = Math.trunc(Number(body.quantity));
    const amount = Number(body.amount);
    const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase().slice(0, 8) : "USD";
    const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 120) : "";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

    if (!recipientPlayerId || !Number.isFinite(quantity) || quantity < 1 || quantity > 1000 || !Number.isFinite(amount) || amount < 0 || !reference) {
      return NextResponse.json({ error: "Faltan receptor, cantidad, importe o referencia del pago manual." }, { status: 400 });
    }

    const playerIds = [recipientPlayerId, ...(buyerPlayerId ? [buyerPlayerId] : [])];
    const { data: players, error: playersError } = await admin
      .from("players")
      .select("id,owner_user_id,display_name,slug")
      .in("id", playerIds);
    if (playersError) throw new Error(playersError.message);

    const recipient = players?.find((player) => player.id === recipientPlayerId);
    const buyer = buyerPlayerId ? players?.find((player) => player.id === buyerPlayerId) : null;
    if (!recipient?.owner_user_id) return NextResponse.json({ error: "El Player receptor no tiene cuenta CLOUVA vinculada." }, { status: 422 });
    if (buyerPlayerId && !buyer) return NextResponse.json({ error: "No encontramos al Player comprador." }, { status: 404 });

    const providerReference = `manual:${reference}`;
    const { data: existing, error: existingError } = await admin
      .from("flow_purchase_operations")
      .select("id,status,issued_at")
      .eq("provider_reference", providerReference)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      const { data: issued, error: issueError } = await admin.rpc("issue_flows_for_operation", {
        p_operation_id: existing.id,
        p_confirmed_by: adminUser.id,
      });
      if (issueError) throw new Error(issueError.message);
      return NextResponse.json({ operationId: existing.id, duplicate: true, issued });
    }

    const { data: operation, error: insertError } = await admin
      .from("flow_purchase_operations")
      .insert({
        buyer_user_id: buyer?.owner_user_id ?? null,
        buyer_player_id: buyer?.id ?? null,
        recipient_user_id: recipient.owner_user_id,
        recipient_player_id: recipient.id,
        provider: "manual",
        provider_reference: providerReference,
        payment_method: "physical_manual",
        quantity,
        unit_usd: quantity ? (currency === "USD" ? amount / quantity : 1) : 1,
        amount,
        currency,
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        created_by: adminUser.id,
        metadata: { reference, note: note || null, buyerName: buyer?.display_name ?? null, recipientName: recipient.display_name },
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);

    const { data: issued, error: issueError } = await admin.rpc("issue_flows_for_operation", {
      p_operation_id: operation.id,
      p_confirmed_by: adminUser.id,
    });
    if (issueError) throw new Error(issueError.message);

    return NextResponse.json({ operationId: operation.id, duplicate: false, issued });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo registrar el pago manual.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    let query = admin.from("players").select("id,display_name,slug,username,owner_user_id").not("owner_user_id", "is", null).limit(30);
    if (q) query = query.or(`display_name.ilike.%${q}%,slug.ilike.%${q}%,username.ilike.%${q}%`);
    const { data, error } = await query.order("display_name");
    if (error) throw new Error(error.message);
    return NextResponse.json({ players: data ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar los Players." }, { status });
  }
}
