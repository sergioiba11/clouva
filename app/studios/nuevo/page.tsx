"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2 } from "lucide-react";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

export default function NuevoEstudioPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  const create = async () => {
    if (!user || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/studios/create", {
        method: "POST",
        body: JSON.stringify({ name, city, description }),
      });
      const payload = await readApiJson<{ studio: { id: string; slug: string }; next: string }>(response);
      router.push(payload.next || `/studios/${payload.studio.slug}/studio-os`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "No se pudo crear el Estudio.");
      setSaving(false);
    }
  };

  if (authLoading) {
    return <main><MainNav /><section className="mx-auto max-w-2xl px-4 py-16"><p className="text-white/60">Cargando...</p></section><MainFooter /></main>;
  }

  if (!user) {
    return <main><MainNav /><section className="mx-auto max-w-2xl px-4 py-16"><p className="text-white/60">Necesitás iniciar sesión para crear un Estudio.</p></section><MainFooter /></main>;
  }

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <div className="panel rounded-[2rem] p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-violet-400/25 bg-violet-500/10 text-violet-200"><Building2 size={25} /></span>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-violet-300">CLOUVA Studio OS</p>
              <h1 className="mt-1 text-3xl font-semibold">Crear mi Estudio</h1>
              <p className="mt-3 text-sm leading-6 text-white/55">Primero preparamos el Estudio como borrador. Después activás su propio plan Studio OS; no depende de tu VIP personal.</p>
            </div>
          </div>

          <div className="mt-7 grid gap-2 sm:grid-cols-2">
            {["Página pública automática", "Identidad visual", "Membresías propias", "Servicios y reservas", "Equipo y permisos", "Ventas y administración"].map((item) => (
              <p key={item} className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs text-white/55"><CheckCircle2 size={14} className="text-violet-300" />{item}</p>
            ))}
          </div>

          {error ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
          <div className="mt-6 space-y-3">
            <input placeholder="Nombre del Estudio" value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm outline-none focus:border-violet-400/50" />
            <input placeholder="Ciudad" value={city} onChange={(event) => setCity(event.target.value)} className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm outline-none focus:border-violet-400/50" />
            <textarea placeholder="Contanos qué es, qué ofrece y para quién existe" value={description} onChange={(event) => setDescription(event.target.value)} className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm outline-none focus:border-violet-400/50" rows={5} />
            <button onClick={() => void create()} disabled={saving || !name.trim()} className="w-full rounded-xl bg-violet-600 px-5 py-3.5 font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50">
              {saving ? "Preparando Studio OS…" : "Crear borrador y continuar"}
            </button>
          </div>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
