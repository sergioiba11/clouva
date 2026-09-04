import type { SupabaseClient } from "@supabase/supabase-js";

type AgendaInvitationEmailStatus = "sent" | "skipped" | "failed";
export type AgendaInvitationEmailResult = { status: AgendaInvitationEmailStatus; reason?: string; providerMessageId?: string };
const clean = (value: string | null | undefined) => (value ?? "").trim();
const escapeHtml = (value: string | null | undefined) => clean(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const baseUrl = () => clean(process.env.CLOUVA_APP_URL || "https://clouva.com.ar").replace(/\/+$/, "");

async function recipientEmail(admin: SupabaseClient, player: { owner_user_id: string | null; contact_email: string | null }) {
  if (player.owner_user_id) { const { data } = await admin.from("profiles").select("email").eq("id", player.owner_user_id).maybeSingle(); if (clean(data?.email)) return clean(data?.email); }
  return clean(player.contact_email) || null;
}

export async function sendAgendaInvitationEmail(args: { admin: SupabaseClient; agendaId: string; playerId: string }): Promise<AgendaInvitationEmailResult> {
  const [{ data: agenda }, { data: member }, { data: recipient }] = await Promise.all([
    args.admin.from("agendas").select("name").eq("id", args.agendaId).maybeSingle(),
    args.admin.from("agenda_members").select("invited_by_player_id,updated_at,invitation_token").eq("agenda_id", args.agendaId).eq("player_id", args.playerId).eq("status", "pending").maybeSingle(),
    args.admin.from("players").select("display_name,username,owner_user_id,contact_email").eq("id", args.playerId).maybeSingle(),
  ]);
  if (!agenda || !member || !recipient) return { status: "failed", reason: "AGENDA_INVITATION_CONTEXT_MISSING" };
  const to = await recipientEmail(args.admin, recipient);
  if (!to) return { status: "skipped", reason: "RECIPIENT_EMAIL_MISSING" };
  const { data: inviter } = member.invited_by_player_id ? await args.admin.from("players").select("display_name,username,profile_image_url").eq("id", member.invited_by_player_id).maybeSingle() : { data: null };
  const apiKey = clean(process.env.RESEND_API_KEY); if (!apiKey) return { status: "failed", reason: "EMAIL_PROVIDER_NOT_CONFIGURED" };
  const inviterName = clean(inviter?.display_name) || "Un Player de CLOUVA";
  const username = clean(inviter?.username).replace(/^@/, "");
  const acceptUrl = `${baseUrl()}/agenda/invite/${member.invitation_token}`;
  const playerUrl = username ? `${baseUrl()}/${encodeURIComponent(username)}` : baseUrl();
  const avatar = clean(inviter?.profile_image_url);
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#05090d;color:#eefaff;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#091118;border:1px solid #183442;border-radius:24px"><tr><td style="padding:28px"><div style="font-size:13px;font-weight:800;letter-spacing:.18em;color:#77ddff">CLOUVA</div><h1 style="font-size:25px;margin:10px 0 26px">CLOUVA Agenda</h1><p>Hola, ${escapeHtml(recipient.display_name || "Player")}.</p><p style="line-height:1.65;color:#c8d8df"><strong style="color:white">${escapeHtml(inviterName)}</strong> te invitó a conectar agendas en CLOUVA.</p><p style="line-height:1.65;color:#9fb3bc">Al aceptar, van a poder compartir disponibilidad y coordinar encuentros, sesiones, proyectos y eventos directamente desde CLOUVA.</p><div style="padding:18px;margin:24px 0;background:#071017;border:1px solid #153747;border-radius:18px">${avatar ? `<img src="${escapeHtml(avatar)}" width="54" height="54" alt="" style="border-radius:50%;object-fit:cover;display:block;margin-bottom:12px">` : ""}<b>${escapeHtml(inviterName)}</b>${username ? `<div style="color:#7fcce7;margin-top:4px">@${escapeHtml(username)}</div>` : ""}<div style="margin-top:15px;color:#7b939e;font-size:12px">${escapeHtml(agenda.name || "CLOUVA Agenda")}</div></div><a href="${escapeHtml(acceptUrl)}" style="display:block;padding:15px;text-align:center;background:#8ce7ff;color:#031016;text-decoration:none;border-radius:14px;font-weight:800">Aceptar invitación</a><p style="margin:22px 0 10px;color:#8fa6b0">También podés ver el Player antes de aceptar.</p><a href="${escapeHtml(playerUrl)}" style="color:#8ce7ff;font-weight:700;text-decoration:none">Ver Player →</a><p style="font-size:13px;line-height:1.6;color:#718892;margin-top:28px">Una vez conectados, cada Player mantiene el control sobre qué disponibilidad y eventos comparte.</p></td></tr><tr><td style="border-top:1px solid #15303c;padding:20px 28px;color:#718892;font-size:12px"><b style="color:#8ce7ff">CLOUVA</b><br>Vida de flows.</td></tr></table></td></tr></table></body></html>`;
  const text = `Hola, ${clean(recipient.display_name) || "Player"}.\n\n${inviterName} te invitó a conectar agendas en CLOUVA.\n\nAceptar invitación:\n${acceptUrl}\n\nVer Player:\n${playerUrl}\n\nCLOUVA — Vida de flows.`;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `agenda-invite/${args.agendaId}/${args.playerId}/${member.updated_at}` }, body: JSON.stringify({ from: clean(process.env.CLOUVA_EMAIL_FROM || "CLOUVA <admin@clouva.com.ar>"), to: [to], reply_to: "admin@clouva.com.ar", subject: `${inviterName} te invitó a conectar agendas en CLOUVA`, html, text, tags: [{ name: "category", value: "agenda_invite" }] }), cache: "no-store" });
  const payload = await response.json().catch(() => null) as { id?: string } | null;
  if (!response.ok) return { status: "failed", reason: `EMAIL_PROVIDER_${response.status}` };
  return { status: "sent", providerMessageId: payload?.id };
}
