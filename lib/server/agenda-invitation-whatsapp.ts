import type { SupabaseClient } from "@supabase/supabase-js";

type Result = { status: "sent" | "skipped" | "failed"; reason?: string; providerMessageId?: string };
const clean = (v: string | null | undefined) => (v ?? "").trim();

function phoneFromWhatsappUrl(value: string | null | undefined) {
  const raw = clean(value);
  if (!raw) return null;
  const match = raw.match(/(?:wa\.me\/|phone=)(\+?\d{8,15})/i);
  return match?.[1]?.replace(/^\+/, "") || null;
}

export async function sendAgendaInvitationWhatsApp(args: { admin: SupabaseClient; agendaId: string; playerId: string }): Promise<Result> {
  const [{ data: member }, { data: recipient }] = await Promise.all([
    args.admin.from("agenda_members").select("invited_by_player_id,invitation_token").eq("agenda_id", args.agendaId).eq("player_id", args.playerId).eq("status", "pending").maybeSingle(),
    args.admin.from("players").select("whatsapp_url").eq("id", args.playerId).maybeSingle(),
  ]);
  if (!member || !recipient) return { status: "failed", reason: "AGENDA_INVITATION_CONTEXT_MISSING" };
  const phone = phoneFromWhatsappUrl(recipient.whatsapp_url);
  if (!phone) return { status: "skipped", reason: "RECIPIENT_WHATSAPP_MISSING" };
  const token = clean(process.env.WHATSAPP_ACCESS_TOKEN);
  const phoneNumberId = clean(process.env.WHATSAPP_PHONE_NUMBER_ID);
  const template = clean(process.env.WHATSAPP_AGENDA_INVITE_TEMPLATE);
  if (!token || !phoneNumberId || !template) return { status: "failed", reason: "WHATSAPP_PROVIDER_NOT_CONFIGURED" };
  const { data: inviter } = member.invited_by_player_id ? await args.admin.from("players").select("display_name,username").eq("id", member.invited_by_player_id).maybeSingle() : { data: null };
  const base = clean(process.env.CLOUVA_APP_URL || "https://clouva.com.ar").replace(/\/+$/, "");
  const inviteUrl = `${base}/agenda/invite/${member.invitation_token}`;
  const alias = clean(inviter?.username).replace(/^@/, "");
  const playerUrl = alias ? `${base}/${encodeURIComponent(alias)}` : base;
  const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "template", template: { name: template, language: { code: clean(process.env.WHATSAPP_AGENDA_INVITE_LANGUAGE) || "es_AR" }, components: [{ type: "body", parameters: [{ type: "text", text: clean(inviter?.display_name) || "Un Player de CLOUVA" }, { type: "text", text: alias ? `@${alias}` : "CLOUVA" }, { type: "text", text: inviteUrl }, { type: "text", text: playerUrl }] }] } }) });
  const payload = await response.json().catch(() => null) as { messages?: Array<{ id?: string }> } | null;
  if (!response.ok) return { status: "failed", reason: `WHATSAPP_PROVIDER_${response.status}` };
  return { status: "sent", providerMessageId: payload?.messages?.[0]?.id };
}
