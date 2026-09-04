import { redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";
export default async function AgendaInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminSupabase();
  const { data: invite } = await admin.from("agenda_members").select("agenda_id,status,invited_by_player_id").eq("invitation_token", token).maybeSingle();
  if (!invite) return <main style={{minHeight:"100vh",background:"#05090d",color:"white",padding:"48px 20px",fontFamily:"Arial"}}><h1>Invitación no encontrada</h1><p>Este enlace de CLOUVA Agenda no es válido.</p></main>;
  if (invite.status !== "pending") return <main style={{minHeight:"100vh",background:"#05090d",color:"white",padding:"48px 20px",fontFamily:"Arial"}}><div style={{color:"#8ce7ff",fontWeight:800}}>CLOUVA</div><h1>Invitación {invite.status === "active" ? "aceptada" : "finalizada"}</h1><p>El estado ya está sincronizado en CLOUVA Agenda.</p></main>;
  const { data: inviter } = invite.invited_by_player_id ? await admin.from("players").select("display_name,username,profile_image_url").eq("id",invite.invited_by_player_id).maybeSingle() : {data:null};
  redirect(`/agenda/conexiones?invite=${encodeURIComponent(token)}&agendaId=${encodeURIComponent(invite.agenda_id)}&from=${encodeURIComponent(inviter?.username||inviter?.display_name||"player")}`);
}
