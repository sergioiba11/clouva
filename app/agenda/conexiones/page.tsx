"use client";

import { Check, Link2, Loader2, Search, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Context = {
  agendaId: string;
  role: "owner" | "editor" | "participant" | "viewer";
  presentation: { displayName: string; avatar: string | null; identityType: string };
};
type Player = { id: string; displayName: string; username: string | null; avatar: string | null; status?: "active" | "pending" };
const AGENDA_DRAFT_STORAGE_KEY = "clouva:agenda-draft:v1";
type Connection = {
  agendaId: string;
  playerId: string;
  displayName: string;
  username: string | null;
  avatar: string | null;
  role: "editor" | "participant" | "viewer";
  status: string;
  invitedBy: { displayName: string; username: string | null } | null;
  createdAt: string;
};
type Invitation = {
  agendaId: string;
  agendaName: string;
  role: string;
  createdAt: string;
  inviter: { displayName: string; username: string | null; avatar: string | null } | null;
};

function Avatar({ src, label }: { src: string | null; label: string }) {
  return <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06] text-xs font-bold">{src ? <img src={src} alt="" className="h-full w-full object-cover" /> : label.slice(0, 1).toUpperCase()}</span>;
}

export default function AgendaConnectionsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [contexts, setContexts] = useState<Context[]>([]);
  const [agendaId, setAgendaId] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [role, setRole] = useState<"viewer" | "participant" | "editor">("participant");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editableContexts = useMemo(() => contexts.filter((context) => context.role === "owner" || context.role === "editor"), [contexts]);
  const active = useMemo(() => contexts.find((context) => context.agendaId === agendaId) || null, [agendaId, contexts]);

  const loadConnections = useCallback(async (selectedAgendaId = agendaId) => {
    const suffix = selectedAgendaId ? `?agendaId=${encodeURIComponent(selectedAgendaId)}` : "";
    const response = await authenticatedFetch(`/api/agenda/connections${suffix}`);
    const payload = await readApiJson<{ connections: Connection[]; invitations: Invitation[] }>(response);
    setConnections(payload.connections || []);
    setInvitations(payload.invitations || []);
  }, [agendaId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/agenda/conexiones");
      return;
    }
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/agenda/contexts");
        const payload = await readApiJson<{ contexts: Context[] }>(response);
        setContexts(payload.contexts || []);
        const first = (payload.contexts || []).find((context) => context.role === "owner" || context.role === "editor");
        setAgendaId(first?.agendaId || "");
        await loadConnections(first?.agendaId || "");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar las conexiones.");
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, loadConnections, router, user]);

  async function changeContext(nextAgendaId: string) {
    setAgendaId(nextAgendaId);
    setLoading(true);
    setError(null);
    try { await loadConnections(nextAgendaId); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron cargar las conexiones."); } finally { setLoading(false); }
  }

  async function searchPlayers() {
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/agenda/players?q=${encodeURIComponent(query)}`);
      const payload = await readApiJson<{ players: Player[] }>(response);
      setPlayers(payload.players || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron buscar Players.");
    } finally { setBusy(false); }
  }

  async function invite(playerId: string) {
    if (!agendaId) return;
    const invitedPlayer = players.find((player) => player.id === playerId) || null;
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/agenda/connections", { method: "POST", body: JSON.stringify({ agendaId, playerId, role }) });
      await readApiJson(response);
      setPlayers((current) => current.filter((player) => player.id !== playerId));
      await loadConnections(agendaId);
      if (invitedPlayer) {
        const rawDraft = window.sessionStorage.getItem(AGENDA_DRAFT_STORAGE_KEY);
        if (rawDraft) {
          try {
            const draft = JSON.parse(rawDraft) as Record<string, unknown> & { connectedPlayers?: Player[] };
            const connectedPlayers = Array.isArray(draft.connectedPlayers) ? draft.connectedPlayers : [];
            draft.connectedPlayers = [...connectedPlayers.filter((player) => player.id !== invitedPlayer.id), { ...invitedPlayer, status: "pending" }];
            draft.quickShareOpen = true;
            window.sessionStorage.setItem(AGENDA_DRAFT_STORAGE_KEY, JSON.stringify(draft));
            router.push("/agenda");
          } catch {
            // La conexión persiste aunque un draft local viejo sea inválido.
          }
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar la conexión.");
    } finally { setBusy(false); }
  }

  async function respond(targetAgendaId: string, accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/agenda/connections", {
        method: "PATCH",
        body: JSON.stringify({ agendaId: targetAgendaId, accept }),
      });
      await readApiJson(response);
      const contextsResponse = await authenticatedFetch("/api/agenda/contexts");
      const contextsPayload = await readApiJson<{ contexts: Context[] }>(contextsResponse);
      setContexts(contextsPayload.contexts || []);
      await loadConnections(agendaId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo responder la conexión.");
    } finally { setBusy(false); }
  }

  if (authLoading || loading) return <main className="grid min-h-screen place-items-center bg-[#08080d] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;

  return (
    <main className="min-h-screen bg-[#08080d] px-4 pb-28 pt-8 text-white sm:px-6 md:pb-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/10 text-violet-200"><Link2 size={20} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">AGENDA CLOUVA</p><h1 className="text-2xl font-semibold">Conexiones</h1></div></div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/45">Compartí tu Agenda con otros Players. La conexión controla acceso; los eventos siguen siendo entidades únicas y solamente aparecen donde estén compartidos o invitados.</p>

        {error ? <div className="mt-5 flex justify-between gap-3 rounded-2xl border border-red-300/15 bg-red-300/[0.07] p-4 text-sm text-red-100"><span>{error}</span><button onClick={() => setError(null)}><X size={15} /></button></div> : null}

        {invitations.length ? <section className="mt-7"><h2 className="text-sm font-semibold">Invitaciones pendientes</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{invitations.map((invitation) => <article key={invitation.agendaId} className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.055] p-4"><div className="flex items-center gap-3"><Avatar src={invitation.inviter?.avatar || null} label={invitation.inviter?.displayName || invitation.agendaName} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{invitation.agendaName}</p><p className="mt-0.5 text-xs text-white/40">{invitation.inviter ? `${invitation.inviter.displayName} · ` : ""}acceso {invitation.role}</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={busy} onClick={() => void respond(invitation.agendaId, true)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2.5 text-xs text-emerald-100"><Check size={14} /> Aceptar</button><button disabled={busy} onClick={() => void respond(invitation.agendaId, false)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-white/55"><X size={14} /> Rechazar</button></div></article>)}</div></section> : null}

        <section className="mt-7 rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">Conectar agenda</p><h2 className="mt-1 text-lg font-semibold">Invitar un Player</h2></div><select value={agendaId} onChange={(event) => void changeContext(event.target.value)} className="rounded-xl border border-white/10 bg-[#111119] px-3 py-2.5 text-sm outline-none">{editableContexts.map((context) => <option key={context.agendaId} value={context.agendaId}>{context.presentation.displayName}</option>)}</select></div>
          {active ? <p className="mt-2 text-xs text-white/35">Compartiendo: {active.presentation.displayName} · permiso actual {active.role}</p> : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_170px_auto]"><label className="flex items-center rounded-xl border border-white/10 bg-black/20 px-3"><Search size={15} className="text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchPlayers(); }} placeholder="Nombre o @ del Player" className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-white/25" /></label><select value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="rounded-xl border border-white/10 bg-[#111119] px-3 text-sm outline-none"><option value="viewer">Viewer</option><option value="participant">Participant</option><option value="editor">Editor</option></select><button disabled={busy || !query.trim()} onClick={() => void searchPlayers()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin" /> : "Buscar"}</button></div>
          {players.length ? <div className="mt-4 grid gap-2 md:grid-cols-2">{players.map((player) => <div key={player.id} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/20 p-3"><Avatar src={player.avatar} label={player.displayName} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{player.displayName}</p>{player.username ? <p className="text-[11px] text-white/35">@{player.username}</p> : null}</div><button disabled={busy} onClick={() => void invite(player.id)} className="grid h-9 w-9 place-items-center rounded-xl border border-violet-300/20 bg-violet-300/10 text-violet-200"><UserPlus size={15} /></button></div>)}</div> : null}
        </section>

        <section className="mt-7"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Accesos de esta Agenda</h2><span className="text-xs text-white/30">{connections.length}</span></div>{connections.length ? <div className="mt-3 grid gap-3 md:grid-cols-2">{connections.map((connection) => <article key={connection.playerId} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><Avatar src={connection.avatar} label={connection.displayName} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{connection.displayName}</p><p className="text-[11px] text-white/35">{connection.username ? `@${connection.username} · ` : ""}{connection.role} · {connection.status}</p></div></article>)}</div> : <div className="mt-3 rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">Todavía no conectaste esta Agenda con otros Players.</div>}</section>
      </div>
    </main>
  );
}
