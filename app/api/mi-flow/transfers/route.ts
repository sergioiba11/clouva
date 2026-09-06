import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function transferErrorStatus(message: string) {
  if (/sesión requerida|sesión inválida|cuenta fue bloqueada/i.test(message)) return 401;
  if (/saldo de flows insuficiente|no hay suficientes flows|no está reconciliada|parcialmente registrada|ya pertenece a otra operación/i.test(message)) return 409;
  if (/no tiene un player|no podés pagarte|cantidad de flow|incompleta|inválida|actor no puede/i.test(message)) return 400;
  return 500;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const body = await request.json().catch(() => ({}));

    const recipientPlayerId = typeof body?.recipientPlayerId === "string" ? body.recipientPlayerId.trim() : "";
    const quantity = Number(body?.quantity);
    const bodyTransferId = typeof body?.transferId === "string" ? body.transferId.trim() : "";
    const headerTransferId = (request.headers.get("idempotency-key") ?? "").trim();

    if (!UUID_RE.test(recipientPlayerId)) {
      return NextResponse.json({ error: "El Player receptor es inválido." }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return NextResponse.json({ error: "La cantidad de FLOW debe ser un entero entre 1 y 50." }, { status: 400 });
    }
    if (bodyTransferId && headerTransferId && bodyTransferId !== headerTransferId) {
      return NextResponse.json({ error: "El transferId no coincide con Idempotency-Key." }, { status: 400 });
    }

    const transferId = bodyTransferId || headerTransferId;
    if (!UUID_RE.test(transferId)) {
      return NextResponse.json({ error: "Se requiere un transferId UUID estable para garantizar idempotencia." }, { status: 400 });
    }

    const { data: recipient, error: recipientError } = await admin
      .from("players")
      .select("id,owner_user_id,slug,username,display_name,profile_image_url,is_published,publication_status,privacy_status")
      .eq("id", recipientPlayerId)
      .maybeSingle();

    if (recipientError) throw new Error(recipientError.message);
    if (!recipient?.owner_user_id) {
      return NextResponse.json({ error: "El Player receptor no existe o no puede recibir FLOW." }, { status: 404 });
    }
    if (recipient.owner_user_id === user.id) {
      return NextResponse.json({ error: "No podés enviarte FLOW a vos mismo." }, { status: 400 });
    }

    const { data: receipt, error: transferError } = await admin.rpc("transfer_backed_flows", {
      p_sender_user_id: user.id,
      p_recipient_user_id: recipient.owner_user_id,
      p_quantity: quantity,
      p_transfer_id: transferId,
      p_actor_id: user.id,
    });

    if (transferError) throw new Error(transferError.message);

    return NextResponse.json({
      transfer: receipt,
      recipient: {
        playerId: recipient.id,
        slug: recipient.slug,
        username: recipient.username,
        displayName: recipient.display_name,
        profileImageUrl: recipient.profile_image_url,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo transferir FLOW.";
    const status = isAuthError(error) ? 401 : transferErrorStatus(message);
    return NextResponse.json({ error: status === 500 ? "No se pudo transferir FLOW." : message }, { status });
  }
}
