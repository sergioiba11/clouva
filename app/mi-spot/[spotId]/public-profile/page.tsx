"use client";

import { ArrowLeft, ExternalLink, Eye, EyeOff, Loader2, Save, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Payload = {
  spot: {
    id: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    cover_url: string | null;
    accent_color: string | null;
    public_enabled: boolean;
  };
  space: {
    id: string;
    slug: string;
    name: string;
    type: string;
    description: string | null;
    logo_url: string | null;
    cover_url: string | null;
    accent_color: string | null;
    public_enabled: boolean;
    status: string;
  } | null;
  role: string;
  capabilities: string[];
};

type Draft = {
  name: string;
  description: string;
  logoUrl: string;
  coverUrl: string;
  accentColor: string;
  publicEnabled: boolean;
};

const EMPTY: Draft = { name: "", description: "", logoUrl: "", coverUrl: "", accentColor: "", publicEnabled: false };

export default function SpotPublicProfilePage() {
  const params = useParams<{ spotId: string }>();
  const spotId = String(params.spotId || "");
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!user || !spotId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}`);
      const payload = await readApiJson<Payload>(response);
      setData(payload);
      setDraft({
        name: payload.spot.name,
        description: payload.spot.description ?? "",
        logoUrl: payload.spot.logo_url ?? payload.space?.logo_url ?? "",
        coverUrl: payload.spot.cover_url ?? payload.space?.cover_url ?? "",
        accentColor: payload.spot.accent_color ?? payload.space?.accent_color ?? "",
        publicEnabled: payload.spot.public_enabled && (payload.space?.public_enabled ?? true),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el perfil público.");
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

  async function save() {
    if (!data?.capabilities.includes("settings")) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      await readApiJson(response);
      setSaved(true);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el perfil público.");
    } finally {
      setSaving(false);
    }
  }

  const canSettings = data?.capabilities.includes("settings") ?? false;
  const publicHref = data?.space?.slug ? `/${data.space.slug}` : null;
  const accent = draft.accentColor && /^#[0-9a-f]{3,8}$/i.test(draft.accentColor) ? draft.accentColor : "#8f5cff";

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/mi-spot/${spotId}`} className="inline-flex items-center gap-2 text-sm text-white/42 transition hover:text-white"><ArrowLeft size={15} /> Volver al Spot</Link>
          <div className="flex gap-2">
            <Link href={`/mi-spot/${spotId}/team`} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-white/65"><Users size={14} /> Equipo</Link>
            {publicHref && draft.publicEnabled ? <Link href={publicHref} target="_blank" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-white/65">Abrir perfil <ExternalLink size={13} /></Link> : null}
          </div>
        </div>

        {loading ? <div className="mt-6 grid min-h-64 place-items-center rounded-[28px] border border-white/[0.08] bg-[#0b0912]"><span className="inline-flex items-center gap-2 text-sm text-white/40"><Loader2 size={16} className="animate-spin" /> Cargando perfil público…</span></div> : null}
        {error ? <p className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}

        {!loading && data ? <>
          <section className="relative mt-5 overflow-hidden rounded-[30px] border bg-[#0d0a13] p-6 sm:p-8" style={{ borderColor: `${accent}42` }}>
            <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ backgroundColor: `${accent}25` }} />
            <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>Perfil público · Matrix</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">{data.spot.name}</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-white/45">Administrá la identidad pública del mismo Spot. No es otra tienda: nombre, logo, portada, descripción y visibilidad se sincronizan con el Space canónico.</p>
              </div>
              <div className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-2 text-xs font-semibold md:self-auto ${draft.publicEnabled ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-200" : "border-white/10 bg-white/[0.035] text-white/42"}`}>
                {draft.publicEnabled ? <Eye size={14} /> : <EyeOff size={14} />}
                {draft.publicEnabled ? "Público" : "Oculto"}
              </div>
            </div>
          </section>

          {!data.space ? <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-4 text-sm text-amber-100">Este Spot todavía no está enlazado a un Space canónico. La operación sigue intacta, pero necesita ese vínculo antes de tener URL pública.</div> : null}

          <section className="mt-5 rounded-[28px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/32">Nombre público</span><input value={draft.name} disabled={!canSettings} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none focus:border-white/25 disabled:opacity-50" /></label>
              <label className="sm:col-span-2"><span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/32">Descripción</span><textarea rows={5} value={draft.description} disabled={!canSettings} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="w-full resize-none rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 outline-none focus:border-white/25 disabled:opacity-50" /></label>
              <label><span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/32">Logo URL</span><input value={draft.logoUrl} disabled={!canSettings} onChange={(event) => setDraft((current) => ({ ...current, logoUrl: event.target.value }))} placeholder="/assets/.../logo.png" className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none focus:border-white/25 disabled:opacity-50" /></label>
              <label><span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/32">Portada URL</span><input value={draft.coverUrl} disabled={!canSettings} onChange={(event) => setDraft((current) => ({ ...current, coverUrl: event.target.value }))} placeholder="https://..." className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none focus:border-white/25 disabled:opacity-50" /></label>
              <label><span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/32">Color</span><div className="flex gap-2"><span className="h-11 w-11 shrink-0 rounded-xl border border-white/10" style={{ backgroundColor: accent }} /><input value={draft.accentColor} disabled={!canSettings} onChange={(event) => setDraft((current) => ({ ...current, accentColor: event.target.value }))} placeholder="#8f5cff" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none focus:border-white/25 disabled:opacity-50" /></div></label>
              <div><span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/32">URL pública</span><div className="flex h-11 items-center rounded-xl border border-white/[0.07] bg-black/15 px-3 text-sm text-white/45">{data.space?.slug ? `clouva.com.ar/${data.space.slug}` : "Sin URL canónica"}</div></div>
            </div>

            <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
              <input type="checkbox" checked={draft.publicEnabled} disabled={!canSettings || !data.space} onChange={(event) => setDraft((current) => ({ ...current, publicEnabled: event.target.checked }))} className="mt-1 h-4 w-4" />
              <span><strong className="block text-sm">Publicar este Spot en la Matrix</strong><small className="mt-1 block leading-5 text-white/36">Activa o desactiva el mismo perfil público. El catálogo visible se alimenta únicamente de productos publicados de este Spot.</small></span>
            </label>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void save()} disabled={!canSettings || saving || !data.space} className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-35" style={{ backgroundColor: accent }}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar perfil</button>
              {saved ? <span className="text-xs text-emerald-200">Guardado y sincronizado.</span> : null}
              {!canSettings ? <span className="text-xs text-white/35">Tu rol puede ver este perfil, pero no editar settings.</span> : null}
            </div>
          </section>
        </> : null}
      </div>
    </main>
  );
}
