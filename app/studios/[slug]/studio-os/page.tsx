"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type StudioOsState = {
  studio: {
    id: string;
    slug: string;
    name: string;
    studio_os_status: string;
    studio_os_expires_at: string | null;
  };
  subscription: { id: string; status: string; current_period_end: string | null; metadata: Record<string, unknown> } | null;
};

export default function StudioOsPage({ params }: { params: Promise<{ slug: string }> }) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [slug, setSlug] = useState("");
  const [state, setState] = useState<StudioOsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void params.then((value) => setSlug(value.slug)); }, [params]);
  useEffect(() => { if (!authLoading && !user) router.replace(`/login`); }, [authLoading, router, user]);

  const load = async () => {
    if (!user || !slug) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(slug)}/studio-os`);
      setState(await readApiJson<StudioOsState>(response));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar Studio OS.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [slug, user]);

  const subscribe = async () => {
    setWorking(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(slug)}/studio-os`, {
        method: "POST",
        headers: { "x-idempotency-key": crypto.randomUUID() },
      });
      const payload = await readApiJson<{ active?: boolean; initPoint?: string | null }>(response);
      if (payload.active) {
        router.replace(`/studios/${slug}`);
        return;
      }
      if (!payload.initPoint) throw new Error("Mercado Pago no devolvió el checkout.");
      window.location.assign(payload.initPoint);
    } catch (subscribeError) {
      setError(subscribeError instanceof Error ? subscribeError.message : "No se pudo activar Studio OS.");
      setWorking(false);
    }
  };

  const active = state ? ["active", "grace", "legacy_active"].includes(state.studio.studio_os_status) : false;

  return (
    <main className="min-h-screen bg-[#05040a] px-4 py-10 text-white sm:px-6">
      <section className="mx-auto max-w-3xl rounded-[2rem] border border-white/10 bg-white/[0.025] p-6 shadow-2xl shadow-violet-950/20 sm:p-9">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-violet-400/25 bg-violet-500/10 text-violet-200"><Building2 size={25} /></span>
          <div><p className="text-xs uppercase tracking-[0.22em] text-violet-300">CLOUVA Studio OS</p><h1 className="mt-1 text-3xl font-bold">{state?.studio.name || "Tu Estudio"}</h1></div>
        </div>

        {loading ? <div className="mt-8 flex items-center gap-3 text-white/50"><Loader2 className="animate-spin" size={18} /> Cargando estado…</div> : null}
        {error ? <p className="mt-6 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}

        {!loading && state ? (
          <>
            <div className={`mt-8 rounded-2xl border p-5 ${active ? "border-emerald-400/30 bg-emerald-400/10" : "border-violet-400/20 bg-violet-500/8"}`}>
              <p className="flex items-center gap-2 font-semibold">{active ? <CheckCircle2 size={18} /> : null}{active ? "Studio OS activo" : "Falta activar Studio OS"}</p>
              <p className="mt-2 text-sm leading-6 text-white/55">
                {active
                  ? "El Estudio puede publicar su página, administrar equipo, membresías, servicios, reservas y ventas."
                  : "El Estudio ya fue preparado como borrador. Se publica y habilita su panel completo después de confirmar el pago."}
              </p>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {["Página pública e identidad", "Equipo y permisos", "Membresías propias", "Servicios y reservas", "Tienda y ventas", "Panel administrativo"].map((item) => (
                <div key={item} className="rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/65">✓ {item}</div>
              ))}
            </div>

            {active ? (
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={`/studios/${state.studio.slug}`} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold">Ver Estudio</Link>
                <Link href={`/studio-dashboard/${state.studio.id}`} className="rounded-xl border border-white/15 px-5 py-3">Administrar</Link>
              </div>
            ) : (
              <button disabled={working} onClick={() => void subscribe()} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3.5 font-semibold transition hover:bg-violet-500 disabled:opacity-60">
                {working ? <Loader2 className="animate-spin" size={18} /> : null}{working ? "Abriendo Mercado Pago…" : "Activar Studio OS"}
              </button>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
