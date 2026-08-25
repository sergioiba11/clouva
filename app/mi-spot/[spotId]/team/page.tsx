"use client";

import { ArrowLeft, Loader2, ShieldCheck, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Member = {
  id: string;
  spot_id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
};
type RoleOption = { id: string; label: string };

type TeamPayload = { members: Member[]; roles: RoleOption[] };

export default function SpotTeamPage() {
  const params = useParams<{ spotId: string }>();
  const spotId = String(params.spotId || "");
  const { user, loading: authLoading } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("viewer");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !spotId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}/team`);
      const payload = await readApiJson<TeamPayload>(response);
      setMembers(payload.members ?? []);
      setRoles((payload.roles ?? []).filter((option) => option.id !== "owner"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el equipo.");
    } finally {
      setLoading(false);
    }
  }, [spotId, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, load, user]);

  async function addMember() {
    if (!userId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}/team`, {
        method: "POST",
        body: JSON.stringify({ userId: userId.trim(), role }),
      });
      await readApiJson(response);
      setUserId("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo agregar el miembro.");
    } finally {
      setBusy(false);
    }
  }

  async function updateMember(memberId: string, nextRole: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}/team`, {
        method: "PATCH",
        body: JSON.stringify({ memberId, role: nextRole }),
      });
      await readApiJson(response);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar el rol.");
    } finally {
      setBusy(false);
    }
  }

  async function disableMember(memberId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}/team`, {
        method: "PATCH",
        body: JSON.stringify({ memberId, status: "disabled" }),
      });
      await readApiJson(response);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo desactivar el acceso.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
        <Link href={`/mi-spot/${spotId}`} className="inline-flex items-center gap-2 text-sm text-white/42 transition hover:text-white"><ArrowLeft size={15} /> Volver al Spot</Link>
        <section className="mt-5 rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0f0b18] to-[#09080f] p-6 sm:p-8">
          <div className="flex items-start gap-4"><span className="grid h-12 w-12 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[0.07] text-violet-300"><Users size={21} /></span><div><p className="text-xs uppercase tracking-[0.15em] text-white/35">Roles del negocio</p><h1 className="mt-1 text-3xl font-semibold">Equipo de MI SPOT</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">Los permisos se validan server-side. Ser manager de un Spot no convierte a nadie en beneficiario de su dinero.</p></div></div>
        </section>

        {error ? <p className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}

        <section className="mt-5 rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6">
          <div className="flex items-center gap-2"><UserPlus size={17} className="text-violet-300" /><h2 className="font-semibold">Agregar acceso</h2></div>
          <p className="mt-2 text-xs leading-5 text-white/35">Ingresá el ID de usuario CLOUVA. Esta pantalla no busca personas por email ni expone directorios privados.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]"><input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="User ID" className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm outline-none" /><select value={role} onChange={(event) => setRole(event.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm outline-none">{roles.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><button type="button" onClick={() => void addMember()} disabled={busy || !userId.trim()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-45">Agregar</button></div>
        </section>

        <section className="mt-5 rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6">
          <div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.15em] text-white/30">Accesos activos</p><h2 className="mt-1 text-lg font-semibold">Miembros</h2></div><ShieldCheck size={19} className="text-emerald-300" /></div>
          {loading ? <p className="mt-6 flex items-center gap-2 text-sm text-white/40"><Loader2 size={15} className="animate-spin" /> Cargando…</p> : null}
          {!loading && !members.length ? <p className="mt-6 text-sm text-white/35">No hay miembros adicionales.</p> : null}
          <div className="mt-4 divide-y divide-white/[0.06]">{members.map((member) => <div key={member.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-xs text-white/65">{member.user_id}</p><p className="mt-1 text-xs text-white/30">{member.status} · {member.role}</p></div>{member.role === "owner" ? <span className="rounded-lg border border-violet-300/15 bg-violet-300/[0.06] px-2.5 py-1 text-xs text-violet-200">Propietario</span> : <div className="flex flex-wrap gap-2"><select disabled={busy} value={member.role} onChange={(event) => void updateMember(member.id, event.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none">{roles.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>{member.status !== "disabled" ? <button type="button" disabled={busy} onClick={() => void disableMember(member.id)} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/45 hover:text-white">Desactivar</button> : null}</div>}</div>)}</div>
        </section>
      </div>
    </main>
  );
}
