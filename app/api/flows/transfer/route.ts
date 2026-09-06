import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanToken(value: unknown) {
  if (typeof value !== "string") return "";
  const token = value.trim();
  return token.length >= 32 && token.length <= 160 && /^[A-Za-z0-9_-]+$/.test(token) ? token : "";
}

function cleanQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 50 ? quantity : null;
}

function statusForMessage(message: string) {
  if (/Saldo de Flows insuficiente|No hay suficientes FLOWS/i.test(message)) return 409;
  if (/reconciliad|respalda|reserva|custodia/i.test(message)) return 409;
  if (/otro Player|vos mismo|cantidad|incompleta|inválida/i.test(message)) return 400;
  return 500;
}

async function getOrCreateTransferIntent(args: {
  admin: ReturnType<typeof createAdminSupabase>;
  senderUserId: string;
  recipientUserId: string;
  recipientPlayerId: string;
  publicToken: string;
  quantity: number;
  transferId: string;
}) {
  const { data: existing, error: existingError } = await args.admin
    .from("flow_transfer_intents")
    .select("id,sender_user_id,recipient_user_id,recipient_player_id,required_quantity,available_at_creation,missing_quantity,transfer_id,status,purchase_operation_id,expires_at,completed_at,last_safe_message")
    .eq("transfer_id", args.transferId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing) {
    if (
      existing.sender_user_id !== args.senderUserId ||
      existing.recipient_user_id !== args.recipientUserId ||
      existing.recipient_player_id !== args.recipientPlayerId ||
      Number(existing.required_quantity) !== args.quantity
    ) {
      throw new Error("La clave de idempotencia ya pertenece a otra transferencia FLOW.");
    }
    return existing;
  }

  const [{ data: wallet, error: walletError }, { data: senderPlayer, error: senderPlayerError }] = await Promise.all([
    args.admin.from("flows_wallets").select("balance").eq("user_id", args.senderUserId).maybeSingle(),
    args.admin.from("players").select("id").eq("owner_user_id", args.senderUserId).maybeSingle(),
  ]);
  if (walletError) throw new Error(walletError.message);
  if (senderPlayerError) throw new Error(senderPlayerError.message);

  const available = Math.max(0, Math.trunc(Number(wallet?.balance) || 0));
  const missing = Math.max(args.quantity - available, 0);
  if (missing <= 0) return null;

  const { data: created, error: createError } = await args.admin
    .from("flow_transfer_intents")
    .insert({
      sender_user_id: args.senderUserId,
      sender_player_id: senderPlayer?.id ?? null,
      recipient_user_id: args.recipientUserId,
      recipient_player_id: args.recipientPlayerId,
      public_token: args.publicToken,
      required_quantity: args.quantity,
      available_at_creation: available,
      missing_quantity: missing,
      transfer_id: args.transferId,
      status: "awaiting_funding",
      metadata: { origin: "player_qr", buyOnlyMissing: true },
    })
    .select("id,required_quantity,available_at_creation,missing_quantity,transfer_id,status,purchase_operation_id,expires_at,completed_at,last_safe_message")
    .single();
  if (createError) {
    if (createError.code === "23505") {
      const retry = await args.admin
        .from("flow_transfer_intents")
        .select("id,required_quantity,available_at_creation,missing_quantity,transfer_id,status,purchase_operation_id,expires_at,completed_at,last_safe_message")
        .eq("transfer_id", args.transferId)
        .maybeSingle();
      if (retry.error) throw new Error(retry.error.message);
      return retry.data;
    }
    throw new Error(createError.message);
  }
  return created;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const publicToken = cleanToken(body?.publicToken);
    const quantity = cleanQuantity(body?.quantity);
    const transferId = request.headers.get("idempotency-key")?.trim() || "";

    if (!publicToken) return NextResponse.json({ error: "QR CLOUVA inválido." }, { status: 400 });
    if (!quantity) return NextResponse.json({ error: "La cantidad debe estar entre 1 y 50 FLOW." }, { status: 400 });
    if (!UUID_RE.test(transferId)) {
      return NextResponse.json({ error: "Falta una clave de idempotencia válida para el pago." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: registry, error: registryError } = await admin
      .from("clouva_qr_registry")
      .select("entity_type,entity_id,status,is_canonical")
      .eq("public_token", publicToken)
      .eq("status", "ACTIVE")
      .eq("is_canonical", true)
      .maybeSingle();

    if (registryError) throw new Error(registryError.message);
    if (!registry || registry.entity_type !== "USER") {
      return NextResponse.json({ error: "Este QR no corresponde a un Player que pueda recibir FLOW." }, { status: 404 });
    }

    const recipientUserId = String(registry.entity_id || "");
    if (!recipientUserId || recipientUserId === user.id) {
      return NextResponse.json({ error: "No podés pagarte FLOW a vos mismo." }, { status: 400 });
    }

    const { data: recipientPlayer, error: playerError } = await admin
      .from("players")
      .select("id")
      .eq("owner_user_id", recipientUserId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (playerError) throw new Error(playerError.message);
    if (!recipientPlayer) {
      return NextResponse.json({ error: "El QR existe, pero su Player receptor no está disponible." }, { status: 404 });
    }

    const { data, error } = await admin.rpc("transfer_backed_flows", {
      p_sender_user_id: user.id,
      p_recipient_user_id: recipientUserId,
      p_quantity: quantity,
      p_transfer_id: transferId,
      p_actor_id: user.id,
    });
    if (error) {
      const message = error.message || "No se pudo completar el pago en FLOW.";
      if (/Saldo de Flows insuficiente|No hay suficientes FLOWS/i.test(message)) {
        const intent = await getOrCreateTransferIntent({
          admin,
          senderUserId: user.id,
          recipientUserId,
          recipientPlayerId: recipientPlayer.id,
          publicToken,
          quantity,
          transferId,
        });
        if (intent) {
          return NextResponse.json({
            error: `Te faltan ${intent.missing_quantity} FLOW para completar este pago.`,
            code: "FLOW_INSUFFICIENT",
            intent: {
              id: intent.id,
              status: intent.status,
              requiredQuantity: intent.required_quantity,
              availableAtCreation: intent.available_at_creation,
              missingQuantity: intent.missing_quantity,
              transferId: intent.transfer_id,
              purchaseOperationId: intent.purchase_operation_id,
              expiresAt: intent.expires_at,
              completedAt: intent.completed_at,
              message: intent.last_safe_message,
            },
          }, { status: 409 });
        }
      }
      return NextResponse.json({ error: message }, { status: statusForMessage(message) });
    }

    return NextResponse.json({ transfer: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo completar el pago en FLOW." },
      { status },
    );
  }
}
