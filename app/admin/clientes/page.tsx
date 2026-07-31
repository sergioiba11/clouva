"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type EntitlementRow = {
  user_id: string;
  status: string;
  source: string;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type PlayerRow = {
  id: string;
  display_name: string | null;
  slug: string;
  is_published: boolean;
  publication_status: string | null;
};

type UserRow = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed_at: string | null;
  providers: string[];
  full_name: string;
  avatar_url: string | null;
  is_vip: boolean;
  is_blocked: boolean;
  clouva_id: string | null;
  username: string | null;
  role: string;
  onboarding_status: "pending" | "exploring" | "player_created" | "published";
  onboarding_completed_at: string | null;
  player: PlayerRow | null;
  vip_entitlement: EntitlementRow | null;
};

const SOURCE_LABEL: Record<string, string> = {
  payment: "pago",
  admin: "admin",
  promotion: "promo",
  invitation: "invitación",
  signup: "signup",
};

const ONBOARDING_LABEL: Record<UserRow["onboarding_status"], string> = {
  pending: "Debe elegir categoría",
  exploring: "Solo explora La Matrix",
  player_created: "Player creado · falta publicar",
  published: "Perfil publicado",
};

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "Nunca";
}

export default function Page() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/admin/users");
      const payload = await readApiJson<{ users: UserRow[] }>(response);
      setRows(payload.users);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los usuarios.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const patchProfile = async (id: string, fields: { is_vip?: boolean; is_blocked?: boolean }) => {
    setBusyId(id);
    setError(null);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { error: updateError } = await supabase.from("profiles").update(fields).eq("id", id);
      if (updateError) throw updateError;
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "No se pudo actualizar la cuenta.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleVip = async (id: string, isActive: boolean) => {
    setBusyId(id);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/admin/entitlements", {
        method: "POST",
        body: JSON.stringify({ userId: id, action: isActive ? "revoke" : "grant" }),
      });
      await readApiJson(response);
      await load();
    } catch (vipError) {
      setError(vipError instanceof Error ? vipError.message : "No se pudo actualizar el VIP.");
    } finally {
      setBusyId(null);
    }
  };

  const vipLabel = (row: UserRow) => {
    const entitlement = row.vip_entitlement;
    if (!entitlement || entitlement.status !== "active") return "Sin VIP";
    const expiry = entitlement.expires_at ? ` · vence ${new Date(entitlement.expires_at).toLocaleDateString("es-AR")}` : " · sin vencimiento";
    return `VIP activo (${SOURCE_LABEL[entitlement.source] ?? entitlement.source})${expiry}`;
  };

  return (
    <div className="panel p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="mt-1 text-sm text-white/50">Cuentas reales de Supabase Auth, su onboarding y el Player asociado.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm">
          {loading ? "Cargando…" : `${rows.length} usuarios registrados`}
        </div>
      </div>

      {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      <div className="mt-5 space-y-3">
        {loading ? <p className="text-sm text-white/50">Cargando usuarios reales…</p> : null}
        {!loading && rows.length === 0 ? <p className="text-sm text-white/50">No hay usuarios registrados.</p> : null}

        {rows.map((row) => {
          const isActive = row.vip_entitlement?.status === "active";
          return (
            <article key={row.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{row.full_name}</p>
                  <p className="mt-1 text-sm text-white/65">{row.email || "Sin correo visible"}</p>
                  <p className="mt-1 text-xs text-white/40">{row.clouva_id || row.id} · Rol: {row.role}</p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs ${row.onboarding_status === "published" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-100"}`}>
                  {ONBOARDING_LABEL[row.onboarding_status]}
                </span>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-white/55 sm:grid-cols-3">
                <p>Creado: {dateLabel(row.created_at)}</p>
                <p>Último ingreso: {dateLabel(row.last_sign_in_at)}</p>
                <p>Acceso: {row.providers.length ? row.providers.join(", ") : "email"}</p>
              </div>

              <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-sm">
                {row.player ? (
                  <p>Player: <strong>{row.player.display_name || row.player.slug}</strong> · {row.player.is_published ? "Publicado" : row.player.publication_status || "Borrador"}</p>
                ) : (
                  <p className="text-white/50">Todavía no creó un Player.</p>
                )}
                <p className="mt-1 text-xs text-white/50">{vipLabel(row)} · Insignia tienda: {row.is_vip ? "Sí" : "No"} · Bloqueado: {row.is_blocked ? "Sí" : "No"}</p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={busyId === row.id} onClick={() => void toggleVip(row.id, isActive)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs disabled:opacity-50">
                  {busyId === row.id ? "..." : isActive ? "Revocar VIP" : "Otorgar VIP"}
                </button>
                <button disabled={busyId === row.id} onClick={() => void patchProfile(row.id, { is_vip: !row.is_vip })} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs disabled:opacity-50">Insignia tienda</button>
                <button disabled={busyId === row.id} onClick={() => void patchProfile(row.id, { is_blocked: !row.is_blocked })} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs disabled:opacity-50">
                  {row.is_blocked ? "Desbloquear" : "Bloquear"}
                </button>
                {row.player?.slug ? <Link href={`/${row.player.slug}`} className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs text-violet-200">Ver Player</Link> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
