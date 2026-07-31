"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type ProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_vip: boolean | null;
  is_blocked: boolean | null;
  clouva_id: string | null;
  username: string | null;
};

type EntitlementRow = {
  user_id: string;
  status: string;
  source: string;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
};

const SOURCE_LABEL: Record<string, string> = {
  payment: "pago",
  admin: "admin",
  promotion: "promo",
  invitation: "invitación",
  signup: "signup",
};

export default function Page() {
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [entitlements, setEntitlements] = useState<Record<string, EntitlementRow>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { supabase } = await import("@/lib/supabase");
    const [{ data: profiles }, { data: ents }] = await Promise.all([
      supabase.from("profiles").select("id,full_name,avatar_url,is_vip,is_blocked,clouva_id,username").order("full_name"),
      supabase.from("user_entitlements").select("user_id,status,source,starts_at,expires_at,created_at").eq("tier", "vip").order("created_at", { ascending: false }),
    ]);
    setRows((profiles ?? []) as ProfileRow[]);
    // Already sorted created_at desc -- first hit per user_id is the latest.
    const latestByUser: Record<string, EntitlementRow> = {};
    for (const row of (ents ?? []) as EntitlementRow[]) {
      if (!latestByUser[row.user_id]) latestByUser[row.user_id] = row;
    }
    setEntitlements(latestByUser);
  };

  useEffect(() => {
    void load();
  }, []);

  const patchProfile = async (id: string, fields: Partial<ProfileRow>) => {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("profiles").update(fields).eq("id", id);
    void load();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el VIP.");
    } finally {
      setBusyId(null);
    }
  };

  const vipLabel = (id: string) => {
    const ent = entitlements[id];
    if (!ent || ent.status !== "active") return "Sin VIP";
    const expiry = ent.expires_at ? ` · vence ${new Date(ent.expires_at).toLocaleDateString("es-AR")}` : " · sin vencimiento";
    return `VIP activo (${SOURCE_LABEL[ent.source] ?? ent.source})${expiry}`;
  };

  return (
    <div className="panel p-6">
      <h1 className="text-2xl font-bold">Clientes</h1>
      <p className="mt-1 text-sm text-white/50">
        &quot;VIP&quot; acá es el plan real de CLOUVA VIP (user_entitlements) -- el mismo que revisan /profile/edit y el checkout. &quot;Insignia tienda&quot; es un flag aparte, sin relación con el plan pago.
      </p>
      {error ? <p className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      <div className="mt-4 space-y-2">
        {rows.map((r) => {
          const isActive = entitlements[r.id]?.status === "active";
          return (
            <div key={r.id} className="rounded-xl border border-white/10 p-3">
              <div className="text-sm">{r.full_name || r.id} · {r.clouva_id}</div>
              <div className="text-xs text-white/60">
                {vipLabel(r.id)} · Insignia tienda: {r.is_vip ? "Sí" : "No"} · Bloqueado: {r.is_blocked ? "Sí" : "No"}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button disabled={busyId === r.id} onClick={() => void toggleVip(r.id, isActive)} className="rounded border px-2 py-1 disabled:opacity-50">
                  {busyId === r.id ? "..." : isActive ? "Revocar VIP" : "Otorgar VIP"}
                </button>
                <button onClick={() => void patchProfile(r.id, { is_vip: !r.is_vip })} className="rounded border px-2 py-1">Insignia tienda</button>
                <button onClick={() => void patchProfile(r.id, { is_blocked: !r.is_blocked })} className="rounded border px-2 py-1">
                  {r.is_blocked ? "Desbloquear" : "Bloquear"}
                </button>
                <Link href={`/perfil-publico/${r.id}`} className="rounded border px-2 py-1">Perfil público</Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
