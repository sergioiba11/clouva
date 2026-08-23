"use client";

import { Building2, Loader2, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SpotCommerceDashboard } from "@/components/commerce/SpotCommerceDashboard";
import { MainNav } from "@/components/layout";

type StudioOption = { id: string; name: string; slug: string };

export default function MiSpotPage() {
  const { user, loading: authLoading } = useAuth();
  const [studios, setStudios] = useState<StudioOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const { supabase } = await import("@/lib/supabase");
      const [owned, memberships] = await Promise.all([
        supabase.from("studios").select("id,name,slug").eq("owner_id", user.id),
        supabase.from("studio_members").select("studio_id,role,status").eq("profile_id", user.id).eq("status", "active").in("role", ["owner", "admin", "manager"]),
      ]);
      if (owned.error || memberships.error) {
        if (!cancelled) setError(owned.error?.message || memberships.error?.message || "No se pudieron cargar tus Spots.");
        if (!cancelled) setLoading(false);
        return;
      }
      const ids = Array.from(new Set((memberships.data ?? []).map((row) => String(row.studio_id))));
      const memberStudios = ids.length ? await supabase.from("studios").select("id,name,slug").in("id", ids) : { data: [] as StudioOption[], error: null };
      if (memberStudios.error) {
        if (!cancelled) setError(memberStudios.error.message);
        if (!cancelled) setLoading(false);
        return;
      }
      const map = new Map<string, StudioOption>();
      for (const studio of [...(owned.data ?? []), ...(memberStudios.data ?? [])]) map.set(String(studio.id), { id: String(studio.id), name: String(studio.name), slug: String(studio.slug) });
      const options = Array.from(map.values());
      if (!cancelled) {
        setStudios(options);
        setSelectedId((current) => current || options[0]?.id || "");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, user]);

  const selected = useMemo(() => studios.find((studio) => studio.id === selectedId) ?? null, [selectedId, studios]);

  if (selected) {
    return (
      <div className="relative min-h-screen bg-[#05040a] text-white">
        {studios.length > 1 ? (
          <div className="fixed right-4 top-20 z-[70] rounded-2xl border border-white/10 bg-[#0b0912]/95 p-2 shadow-2xl backdrop-blur">
            <label className="flex items-center gap-2 text-xs text-white/45"><Building2 size={14} />
              <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none">
                {studios.map((studio) => <option key={studio.id} value={studio.id}>{studio.name}</option>)}
              </select>
            </label>
          </div>
        ) : null}
        <SpotCommerceDashboard studioId={selected.id} />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-8">
        <section className="rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0f0b18] to-[#09080f] p-7">
          <div className="inline-grid rounded-2xl border border-violet-300/15 bg-violet-300/[0.07] p-3 text-violet-300"><Store size={24} /></div>
          <h1 className="mt-5 text-4xl font-semibold">MI SPOT</h1>
          <p className="mt-2 text-white/50">Tu negocio: productos, ventas, pedidos, stock, scanner, QR y códigos.</p>
          {loading ? <p className="mt-6 flex items-center gap-2 text-sm text-white/45"><Loader2 size={16} className="animate-spin" /> Cargando tus negocios…</p> : null}
          {error ? <p className="mt-6 rounded-xl border border-rose-300/15 bg-rose-300/[0.06] p-3 text-sm text-rose-200">{error}</p> : null}
          {!loading && !error ? <div className="mt-7 flex flex-wrap gap-3"><Link href="/studios/nuevo" className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold">Crear un Estudio / Spot</Link><Link href="/mi-flow" className="rounded-xl border border-white/10 px-4 py-2.5 text-sm">Volver a MI FLOW</Link></div> : null}
        </section>
      </div>
    </main>
  );
}
