"use client";

import { ArrowLeft, Check, Clock3, Loader2, UserRoundPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Player = { id: string; display_name: string | null; username: string | null; profile_image_url: string | null };
type Member = { id: string; player_id: string; role: string; status: string; player: Player | null };
type ManagementRequest = {
  id: string;
  requested_role: string;
  message: string | null;
  status: string;
  created_at: string;
  decision_message: string | null;
  player: Player | null;
};
type TeamPayload = {
  space: {
    id: string;
    name: string;
    type: string;
    business_kind: string | null;
    legacy_studio_id: string | null;
    legacy_commerce_spot_id: string | null;
  };
  members: Member[];
  invitations: Member[];
};

type Tab = "active" | "requests" | "invitations";

const ROLE_LABELS: Record<string, string> = {
  owner: "Propietario",
  partner: "Socio",
  admin: "Administrador",
  manager: "Manager",
  team: "Integrante del equipo",
  viewer: "Integrante del equipo",
  catalog: "Catálogo",
  inventory: "Inventario",
  sales: "Ventas",
  finance: "Finanzas",
  content: "Contenido",
  support: "Soporte",
};

function PlayerIdentity({ player }: { player: Player | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-white/35">
        {player?.profile_image_url ? <img src={player.profile_image_url} alt="" className="h-full w-full object-cover" /> : <Users size={17} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{player?.display_name || "Player"}</span>
        <span className="block truncate text-xs text-white/35">{player?.username ? `@${player.username}` : "Sin @ público"}</span>
      </span>
    </div>
  );
}

export default function BusinessTeamPage() {
  const params = useParams<{ spaceId: string }>();
  const spaceId = String(params.spaceId || "");
  const { user, loading: authLoading } = useAuth();
  const [team, setTeam] = useState<TeamPayload | null>(null);
  const [requests, setRequests] = useState<ManagementRequest[]>([]);
  const [tab, setTab] = useState<Tab>("active");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !spaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [teamResponse, requestResponse] = await Promise.all([
        authenticatedFetch(`/api/spaces/${encodeURIComponent(spaceId)}/team`),
        authenticatedFetch(`/api/spaces/${encodeURIComponent(spaceId)}/management-requests`),
      ]);
      const [teamPayload, requestPayload] = await Promise.all([
        readApiJson<TeamPayload>(teamResponse),
        readApiJson<{ requests: ManagementRequest[] }>(requestResponse),
      ]);
      setTeam(teamPayload);
      setRequests(requestPayload.requests ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el equipo.");
    } finally {
      setLoading(false);
    }
  }, [spaceId, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    void load();
  }, [authLoading, load, user]);

  const pendingRequests = useMemo(() => requests.filter((request) => request.status === "pending"), [requests]);
  const backHref = team?.space.legacy_studio_id
    ? `/studio-dashboard/${team.space.legacy_studio_id}`
    : team?.space.legacy_commerce_spot_id
      ? `/mi-spot/${team.space.legacy_commerce_spot_id}`
      : "/profile/memberships";

  async function review(requestId: string, decision: "approved" | "rejected") {
    setBusyId(requestId);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/spaces/${encodeURIComponent(spaceId)}/management-requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        body: JSON.stringify({ decision }),
      });
      await readApiJson(response);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo revisar la solicitud.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm text-white/42 transition hover:text-white"><ArrowLeft size={15} /> Volver</Link>
        <section className="mt-5 rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0f0b18] to-[#09080f] p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[0.07] text-violet-300"><Users size={21} /></span>
            <div><p className="text-xs uppercase tracking-[0.15em] text-white/35">Equipo</p><h1 className="mt-1 text-3xl font-semibold">{team?.space.name || "Negocio / espacio"}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">Los accesos se crean desde relaciones reales del Space Core. Una solicitud pendiente no habilita administración.</p></div>
          </div>
        </section>

        <div className="mt-5 flex flex-wrap gap-2 rounded-2xl border border-white/[0.08] bg-[#0b0912] p-2">
          {([
            ["active", `Activos${team ? ` · ${team.members.length}` : ""}`],
            ["requests", `Solicitudes${pendingRequests.length ? ` · ${pendingRequests.length}` : ""}`],
            ["invitations", `Invitaciones${team?.invitations.length ? ` · ${team.invitations.length}` : ""}`],
          ] as Array<[Tab, string]>).map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-xl px-4 py-2 text-sm transition ${tab === id ? "bg-violet-600 text-white" : "text-white/45 hover:bg-white/[0.04] hover:text-white"}`}>{label}</button>)}
        </div>

        {error ? <p className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}
        {loading ? <p className="mt-6 flex items-center gap-2 text-sm text-white/40"><Loader2 size={15} className="animate-spin" /> Cargando equipo…</p> : null}

        {!loading && tab === "active" ? (
          <section className="mt-5 rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6">
            {!team?.members.length ? <p className="text-sm text-white/35">No hay miembros activos.</p> : <div className="divide-y divide-white/[0.06]">{team.members.map((member) => <div key={member.id} className="flex items-center justify-between gap-4 py-4"><PlayerIdentity player={member.player} /><span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white/55">{ROLE_LABELS[member.role] || member.role}</span></div>)}</div>}
          </section>
        ) : null}

        {!loading && tab === "requests" ? (
          <section className="mt-5 rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6">
            {!pendingRequests.length ? <p className="text-sm text-white/35">No hay solicitudes pendientes.</p> : <div className="divide-y divide-white/[0.06]">{pendingRequests.map((request) => <div key={request.id} className="py-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><PlayerIdentity player={request.player} /><div className="flex shrink-0 gap-2"><button type="button" disabled={Boolean(busyId)} onClick={() => void review(request.id, "rejected")} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/45 hover:text-white disabled:opacity-45">{busyId === request.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Rechazar</button><button type="button" disabled={Boolean(busyId)} onClick={() => void review(request.id, "approved")} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold disabled:opacity-45">{busyId === request.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Aceptar</button></div></div><div className="mt-3 rounded-xl border border-white/[0.06] bg-black/15 p-3"><p className="text-xs font-medium text-violet-200/80">{ROLE_LABELS[request.requested_role] || request.requested_role}</p>{request.message ? <p className="mt-2 text-sm leading-6 text-white/45">{request.message}</p> : null}<p className="mt-2 flex items-center gap-1.5 text-[11px] text-white/25"><Clock3 size={11} /> {new Date(request.created_at).toLocaleString("es-AR")}</p></div></div>)}</div>}
          </section>
        ) : null}

        {!loading && tab === "invitations" ? (
          <section className="mt-5 rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6">
            {!team?.invitations.length ? <div className="flex items-center gap-3 text-sm text-white/35"><UserRoundPlus size={17} /> No hay invitaciones pendientes en Space Core.</div> : <div className="divide-y divide-white/[0.06]">{team.invitations.map((member) => <div key={member.id} className="flex items-center justify-between gap-4 py-4"><PlayerIdentity player={member.player} /><span className="rounded-lg border border-amber-300/15 bg-amber-300/[0.05] px-2.5 py-1 text-xs text-amber-100/70">{ROLE_LABELS[member.role] || member.role}</span></div>)}</div>}
          </section>
        ) : null}
      </div>
    </main>
  );
}
