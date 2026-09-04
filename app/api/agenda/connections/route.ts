import { NextRequest, NextResponse } from "next/server";
import { inviteAgendaMember, respondAgendaInvite } from "@/lib/server/agenda";
import { sendAgendaInvitationEmail } from "@/lib/server/agenda-invitation-email";
import { sendAgendaInvitationWhatsApp } from "@/lib/server/agenda-invitation-whatsapp";
import { listAgendaConnections, listPendingAgendaInvites } from "@/lib/server/agenda/settings";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiError(error: unknown, fallback: string) {
  const typed = error as Error & { status?: number; code?: string };
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback, ...(typed.code ? { code: typed.code } : {}) },
    { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
  );
}

async function saveDelivery(
  admin: ReturnType<typeof createAdminSupabase>,
  agendaId: string,
  playerId: string,
  channel: "email" | "whatsapp" | "notification",
  result: { status: string; reason?: string; providerMessageId?: string | null },
) {
  const { data: current } = await admin
    .from("agenda_invitation_deliveries")
    .select("attempts")
    .eq("agenda_id", agendaId)
    .eq("player_id", playerId)
    .eq("channel", channel)
    .maybeSingle();
  await admin.from("agenda_invitation_deliveries").upsert(
    {
      agenda_id: agendaId,
      player_id: playerId,
      channel,
      status: result.status,
      provider_message_id: result.providerMessageId || null,
      failure_reason: result.reason || null,
      attempts: Number(current?.attempts || 0) + 1,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "agenda_id,player_id,channel" },
  );
}

function providerMessageId(result: object) {
  return "providerMessageId" in result && typeof result.providerMessageId === "string"
    ? result.providerMessageId
    : null;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const agendaId = request.nextUrl.searchParams.get("agendaId") || "";
    const [invitations, connections] = await Promise.all([
      listPendingAgendaInvites({ admin, userId: user.id }),
      agendaId ? listAgendaConnections({ admin, userId: user.id, agendaId }) : Promise.resolve([]),
    ]);
    return NextResponse.json({ invitations, connections }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "No se pudieron cargar las conexiones.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = await request.json().catch(() => ({})) as {
      agendaId?: string;
      playerId?: string;
      role?: "viewer" | "participant" | "editor";
    };
    if (!body.agendaId || !body.playerId || !body.role) {
      return NextResponse.json({ error: "agendaId, playerId y role son obligatorios." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const result = await inviteAgendaMember({ admin, userId: user.id, agendaId: body.agendaId, playerId: body.playerId, role: body.role });
    if (!result.shouldDeliver) return NextResponse.json({ ...result, deliverySkipped: true }, { status: 200 });

    const [{ data: recipient }, { data: inviter }] = await Promise.all([
      admin.from("players").select("owner_user_id,display_name,username,profile_image_url").eq("id", body.playerId).maybeSingle(),
      admin.from("players").select("id,display_name,username,profile_image_url").eq("id", result.invitedByPlayerId).maybeSingle(),
    ]);
    const invitationLink = result.invitationToken ? `/agenda/invite/${encodeURIComponent(result.invitationToken)}` : "/agenda/conexiones";
    let notificationId: string | null = null;
    if (recipient?.owner_user_id) {
      const inviterName = inviter?.display_name || inviter?.username || "Un Player";
      const inviterAlias = inviter?.username ? `@${inviter.username} · ` : "";
      const { data: notification, error: notificationError } = await admin.from("notifications").insert({
        user_id: recipient.owner_user_id,
        actor_player_id: inviter?.id || result.invitedByPlayerId,
        type: "agenda_invitation",
        title: `${inviterName} te invitó a conectar Agenda`,
        body: `${inviterAlias}Aceptá para sincronizar sus agendas.`,
        link: invitationLink,
        metadata: { kind: "agenda_invitation", agendaId: body.agendaId, playerId: body.playerId, invitationToken: result.invitationToken },
      }).select("id").single();
      if (notificationError) throw new Error(notificationError.message);
      notificationId = notification?.id ? String(notification.id) : null;
      if (notificationId) {
        await Promise.all([
          admin.from("agenda_members").update({ notification_id: notificationId }).eq("agenda_id", body.agendaId).eq("player_id", body.playerId),
          saveDelivery(admin, body.agendaId, body.playerId, "notification", { status: "sent", providerMessageId: notificationId }),
        ]);
      }
    }

    const [email, whatsapp] = await Promise.all([
      sendAgendaInvitationEmail({ admin, agendaId: body.agendaId, playerId: body.playerId }).catch(() => ({ status: "failed" as const, reason: "EMAIL_DELIVERY_ERROR" })),
      sendAgendaInvitationWhatsApp({ admin, agendaId: body.agendaId, playerId: body.playerId }).catch(() => ({ status: "failed" as const, reason: "WHATSAPP_DELIVERY_ERROR" })),
    ]);
    const emailProviderMessageId = providerMessageId(email);
    const whatsappProviderMessageId = providerMessageId(whatsapp);
    await Promise.all([
      saveDelivery(admin, body.agendaId, body.playerId, "email", { ...email, providerMessageId: emailProviderMessageId }),
      saveDelivery(admin, body.agendaId, body.playerId, "whatsapp", { ...whatsapp, providerMessageId: whatsappProviderMessageId }),
      admin.from("agenda_members").update({
        email_delivery_status: email.status,
        email_provider_message_id: emailProviderMessageId,
        whatsapp_delivery_status: whatsapp.status,
        whatsapp_provider_message_id: whatsappProviderMessageId,
      }).eq("agenda_id", body.agendaId).eq("player_id", body.playerId),
    ]);
    return NextResponse.json({ ...result, notificationId, emailDelivery: email, whatsappDelivery: whatsapp }, { status: 201 });
  } catch (error) {
    return apiError(error, "No se pudo conectar la Agenda.");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = await request.json().catch(() => ({})) as { agendaId?: string; accept?: boolean };
    if (!body.agendaId || typeof body.accept !== "boolean") return NextResponse.json({ error: "agendaId y accept son obligatorios." }, { status: 400 });
    return NextResponse.json(await respondAgendaInvite({ admin: createAdminSupabase(), userId: user.id, agendaId: body.agendaId, accept: body.accept }));
  } catch (error) {
    return apiError(error, "No se pudo responder la conexión.");
  }
}
