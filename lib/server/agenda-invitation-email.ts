import type { SupabaseClient } from "@supabase/supabase-js";

type AgendaInvitationEmailStatus = "sent" | "skipped" | "failed";

export type AgendaInvitationEmailResult = {
  status: AgendaInvitationEmailStatus;
  reason?: string;
  providerMessageId?: string;
};

type PlayerEmailRow = {
  display_name: string | null;
  username: string | null;
  owner_user_id: string | null;
  contact_email: string | null;
};

type InviterRow = {
  display_name: string | null;
  username: string | null;
};

type AgendaRow = {
  name: string | null;
};

type MembershipRow = {
  invited_by_player_id: string | null;
  updated_at: string;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function escapeHtml(value: string | null | undefined) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function appBaseUrl() {
  return clean(process.env.CLOUVA_APP_URL || "https://clouva.com.ar").replace(/\/+$/, "");
}

function sender() {
  return clean(process.env.CLOUVA_EMAIL_FROM || "CLOUVA <admin@clouva.com.ar>");
}

async function resolveRecipientEmail(admin: SupabaseClient, player: PlayerEmailRow) {
  if (player.owner_user_id) {
    const { data, error } = await admin
      .from("profiles")
      .select("email")
      .eq("id", player.owner_user_id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    const accountEmail = clean(data?.email);
    if (accountEmail) return accountEmail;
  }

  return clean(player.contact_email) || null;
}

function renderHtml(args: {
  recipientName: string;
  inviterName: string;
  inviterUsername: string | null;
  agendaName: string;
  acceptUrl: string;
  playerUrl: string | null;
}) {
  const recipientName = escapeHtml(args.recipientName);
  const inviterName = escapeHtml(args.inviterName);
  const inviterUsername = args.inviterUsername ? `@${escapeHtml(args.inviterUsername.replace(/^@/, ""))}` : "";
  const agendaName = escapeHtml(args.agendaName);
  const acceptUrl = escapeHtml(args.acceptUrl);
  const playerUrl = args.playerUrl ? escapeHtml(args.playerUrl) : null;

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#08080d;color:#f7f5ff;font-family:Inter,Arial,sans-serif;">
    <div style="padding:32px 16px;">
      <div style="max-width:600px;margin:0 auto;border:1px solid rgba(255,255,255,.10);border-radius:24px;background:#111119;overflow:hidden;">
        <div style="padding:28px 28px 18px;border-bottom:1px solid rgba(255,255,255,.08);">
          <div style="font-size:12px;letter-spacing:.18em;font-weight:800;color:#a78bfa;">CLOUVA</div>
          <h1 style="margin:10px 0 0;font-size:24px;line-height:1.2;color:#ffffff;">Invitación de Agenda</h1>
        </div>

        <div style="padding:28px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#f5f3ff;">Hola, ${recipientName}.</p>
          <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#ddd6fe;"><strong style="color:#ffffff;">${inviterName}</strong> te invitó a conectar agendas en CLOUVA.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#b7b3c7;">Al aceptar, vas a poder compartir disponibilidad, coordinar encuentros, sesiones, proyectos o eventos directamente desde CLOUVA.</p>

          <div style="margin:0 0 24px;padding:18px;border-radius:16px;background:#0b0b12;border:1px solid rgba(167,139,250,.18);">
            <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#777386;">Invitación de</div>
            <div style="margin-top:5px;font-size:17px;font-weight:700;color:#ffffff;">${inviterName}</div>
            ${inviterUsername ? `<div style="margin-top:2px;font-size:13px;color:#9b96aa;">${inviterUsername}</div>` : ""}
            <div style="margin-top:16px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#777386;">Agenda</div>
            <div style="margin-top:5px;font-size:15px;font-weight:650;color:#ede9fe;">${agendaName}</div>
          </div>

          <a href="${acceptUrl}" style="display:block;text-align:center;text-decoration:none;background:#7c3aed;color:#ffffff;font-weight:800;padding:14px 18px;border-radius:14px;">Aceptar invitación</a>

          ${playerUrl ? `<p style="margin:24px 0 10px;font-size:14px;line-height:1.6;color:#aaa6b7;">También podés ver el Player antes de aceptar.</p>
          <a href="${playerUrl}" style="display:inline-block;text-decoration:none;color:#c4b5fd;font-weight:700;font-size:14px;">Ver Player →</a>` : ""}

          <p style="margin:26px 0 0;font-size:13px;line-height:1.65;color:#888494;">Una vez conectados, cada uno mantiene el control sobre qué horarios y eventos comparte.</p>
        </div>

        <div style="padding:20px 28px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:#777386;">
          <strong style="color:#d8b4fe;">CLOUVA</strong><br />
          Vida de flows.
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function renderText(args: {
  recipientName: string;
  inviterName: string;
  inviterUsername: string | null;
  agendaName: string;
  acceptUrl: string;
  playerUrl: string | null;
}) {
  const username = args.inviterUsername ? `\n@${args.inviterUsername.replace(/^@/, "")}` : "";
  const player = args.playerUrl ? `\n\nTambién podés ver el Player antes de aceptar:\n${args.playerUrl}` : "";

  return `Hola, ${args.recipientName}.

${args.inviterName} te invitó a conectar agendas en CLOUVA.

Al aceptar, vas a poder compartir disponibilidad, coordinar encuentros, sesiones, proyectos o eventos directamente desde CLOUVA.

Invitación de
${args.inviterName}${username}

Agenda
${args.agendaName}

Aceptar invitación:
${args.acceptUrl}${player}

Una vez conectados, cada uno mantiene el control sobre qué horarios y eventos comparte.

CLOUVA
Vida de flows.`;
}

export async function sendAgendaInvitationEmail(args: {
  admin: SupabaseClient;
  agendaId: string;
  playerId: string;
}): Promise<AgendaInvitationEmailResult> {
  const [{ data: agenda, error: agendaError }, { data: member, error: memberError }, { data: recipient, error: recipientError }] =
    await Promise.all([
      args.admin.from("agendas").select("name").eq("id", args.agendaId).maybeSingle(),
      args.admin
        .from("agenda_members")
        .select("invited_by_player_id,updated_at")
        .eq("agenda_id", args.agendaId)
        .eq("player_id", args.playerId)
        .eq("status", "pending")
        .maybeSingle(),
      args.admin
        .from("players")
        .select("display_name,username,owner_user_id,contact_email")
        .eq("id", args.playerId)
        .maybeSingle(),
    ]);

  if (agendaError) throw new Error(agendaError.message);
  if (memberError) throw new Error(memberError.message);
  if (recipientError) throw new Error(recipientError.message);

  const agendaRow = agenda as AgendaRow | null;
  const memberRow = member as MembershipRow | null;
  const recipientRow = recipient as PlayerEmailRow | null;
  if (!agendaRow || !memberRow || !recipientRow) {
    return { status: "failed", reason: "AGENDA_INVITATION_CONTEXT_MISSING" };
  }

  const recipientEmail = await resolveRecipientEmail(args.admin, recipientRow);
  if (!recipientEmail) {
    return { status: "skipped", reason: "RECIPIENT_EMAIL_MISSING" };
  }

  let inviter: InviterRow | null = null;
  if (memberRow.invited_by_player_id) {
    const { data, error } = await args.admin
      .from("players")
      .select("display_name,username")
      .eq("id", memberRow.invited_by_player_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    inviter = data as InviterRow | null;
  }

  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) {
    return { status: "failed", reason: "EMAIL_PROVIDER_NOT_CONFIGURED" };
  }

  const recipientName = clean(recipientRow.display_name) || "Player";
  const inviterName = clean(inviter?.display_name) || "Un Player de CLOUVA";
  const inviterUsername = clean(inviter?.username) || null;
  const agendaName = clean(agendaRow.name) || "CLOUVA Agenda";
  const baseUrl = appBaseUrl();
  const acceptUrl = `${baseUrl}/agenda/conexiones`;
  const playerAlias = inviterUsername?.replace(/^@/, "");
  const playerUrl = playerAlias ? `${baseUrl}/${encodeURIComponent(playerAlias)}` : null;
  const emailArgs = { recipientName, inviterName, inviterUsername, agendaName, acceptUrl, playerUrl };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `agenda-invite/${args.agendaId}/${args.playerId}/${memberRow.updated_at}`,
    },
    body: JSON.stringify({
      from: sender(),
      to: [recipientEmail],
      reply_to: "admin@clouva.com.ar",
      subject: `${inviterName} te invitó a conectar agendas en CLOUVA`,
      html: renderHtml(emailArgs),
      text: renderText(emailArgs),
      tags: [{ name: "category", value: "agenda_invite" }],
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
  if (!response.ok) {
    const detail = clean(payload?.message || payload?.name) || `HTTP_${response.status}`;
    console.error("[agenda-invite-email] Resend rejected the email", {
      agendaId: args.agendaId,
      playerId: args.playerId,
      status: response.status,
      detail,
    });
    return { status: "failed", reason: `EMAIL_PROVIDER_${response.status}` };
  }

  return {
    status: "sent",
    ...(payload?.id ? { providerMessageId: payload.id } : {}),
  };
}
