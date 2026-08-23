"use client";

import { ArrowLeft, ArrowRight, Boxes, ChartNoAxesCombined, ClipboardList, Loader2, Package, Save, Settings2, Sparkles, Store, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type SpotDetail = {
  spot: {
    id: string;
    owner_type: "user" | "studio";
    studio_id: string | null;
    name: string;
    slug: string;
    description: string | null;
    business_type: string | null;
    business_categories: string[];
    enabled_modules: string[];
    brand_tone: string | null;
    accent_color: string | null;
    palette: string[];
    public_enabled: boolean;
    ai_profile: Record<string, unknown>;
  };
  studio: { id: string; name: string; slug: string } | null;
  role: string;
  capabilities: string[];
  canOpenCommerce: boolean;
  counts: { products: number; orders: number; inventoryMovements: number; members: number };
  finance: Record<string, unknown> | null;
};

const OPERATION_MODULES = new Set(["products", "catalog", "variants", "inventory", "scanner", "barcode", "codes", "pos", "sales", "orders", "finance"]);

export default function SpotHomePage() {
  const params = useParams<{ spotId: string }>();
  const spotId = String(params.spotId || "");
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<SpotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", businessType: "", brandTone: "", accentColor: "" });

  const load = useCallback(async () => {
    if (!user || !spotId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}`);
      const payload = await readApiJson<SpotDetail>(response);
      setData(payload);
      setDraft({
        name: payload.spot.name,
        description: payload.spot.description ?? "",
        businessType: payload.spot.business_type ?? "",
        brandTone: payload.spot.brand_tone ?? "",
        accentColor: payload.spot.accent_color ?? "",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el Spot.");
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

  const modules = useMemo(() => data?.spot.enabled_modules ?? [], [data]);
  const operationModules = modules.filter((module) => OPERATION_MODULES.has(module));
  const suggestedOnlyModules = modules.filter((module) => !OPERATION_MODULES.has(module) && !["dashboard", "settings"].includes(module));
  const canSettings = data?.capabilities.includes("settings") ?? false;
  const canTeam = data?.capabilities.includes("team") ?? false;

  async function saveSettings() {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      await readApiJson(response);
      setEditing(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el estilo del Spot.");
    } finally {
      setSaving(false);
    }
  }

  const accent = data?.spot.accent_color && /^#[0-9a-f]{3,8}$/i.test(data.spot.accent_color) ? data.spot.accent_color : "#8f5cff";

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        <Link href="/mi-spot" className="inline-flex items-center gap-2 text-sm text-white/42 transition hover:text-white"><ArrowLeft size={15} /> Todos mis Spots</Link>
        {loading ? <div className="mt-6 grid min-h-56 place-items-center rounded-3xl border border-white/[0.08] bg-[#0b0912]"><span className="inline-flex items-center gap-2 text-sm text-white/45"><Loader2 size={16} className="animate-spin" /> Cargando negocio…</span></div> : null}
        {error ? <p className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}

        {!loading && data ? <>
          <section className="relative mt-5 overflow-hidden rounded-[30px] border bg-[#0d0a13] p-6 sm:p-8" style={{ borderColor: `${accent}38` }}>
            <div className="pointer-events-none absolute -right-10 -top-20 h-72 w-72 rounded-full blur-3xl" style={{ backgroundColor: `${accent}22` }} />
            <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.15em] text-white/55"><Store size={13} /> {data.studio ? `Spot de ${data.studio.name}` : "Negocio independiente"}</div>
                <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">{data.spot.name}</h1>
                <p className="mt-2 text-sm capitalize text-white/42">{data.spot.business_type?.replaceAll("_", " ") || "negocio"} · rol {data.role}</p>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-white/52">{data.spot.description || "Este Spot todavía no tiene descripción."}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.canOpenCommerce ? <Link href={`/mi-spot/${spotId}/commerce`} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>Abrir operaciones <ArrowRight size={16} /></Link> : null}
                {canTeam ? <Link href={`/mi-spot/${spotId}/team`} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm"><Users size={15} /> Equipo</Link> : null}
                {canSettings ? <button type="button" onClick={() => setEditing((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm"><Settings2 size={15} /> Estilo</button> : null}
              </div>
            </div>
          </section>

          <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={<Package size={18} />} label="Productos" value={data.counts.products} />
            <Metric icon={<ClipboardList size={18} />} label="Pedidos" value={data.counts.orders} />
            <Metric icon={<Boxes size={18} />} label="Movimientos stock" value={data.counts.inventoryMovements} />
            <Metric icon={<Users size={18} />} label="Equipo" value={data.counts.members} />
          </section>

          {editing && canSettings ? <section className="mt-5 rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.15em] text-white/32">Identidad</p><h2 className="mt-1 text-lg font-semibold">Tu estilo</h2></div><Sparkles size={18} className="text-violet-300" /></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Nombre" className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm outline-none" /><input value={draft.businessType} onChange={(event) => setDraft((current) => ({ ...current, businessType: event.target.value }))} placeholder="Tipo de negocio" className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm outline-none" /><input value={draft.brandTone} onChange={(event) => setDraft((current) => ({ ...current, brandTone: event.target.value }))} placeholder="Tono de marca" className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm outline-none" /><input value={draft.accentColor} onChange={(event) => setDraft((current) => ({ ...current, accentColor: event.target.value }))} placeholder="#8f5cff" className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm outline-none" /><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Descripción" rows={4} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm outline-none sm:col-span-2" /></div><button type="button" onClick={() => void saveSettings()} disabled={saving} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar</button></section> : null}

          <section className="mt-6 grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
            <article className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6">
              <p className="text-xs uppercase tracking-[0.15em] text-white/32">Herramientas activas</p><h2 className="mt-1 text-xl font-semibold">Este Spot se adapta a tu negocio</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">{operationModules.map((module) => <div key={module} className="rounded-2xl border border-white/[0.07] bg-black/20 p-4"><div className="flex items-center gap-2"><ChartNoAxesCombined size={16} className="text-violet-300" /><strong className="text-sm capitalize">{module}</strong></div><p className="mt-2 text-xs leading-5 text-white/35">Disponible dentro del Core comercial del Spot.</p></div>)}</div>
              {data.canOpenCommerce ? <Link href={`/mi-spot/${spotId}/commerce`} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-violet-300">Entrar al Core comercial <ArrowRight size={15} /></Link> : <p className="mt-5 text-xs text-white/35">Tu rol es específico. Las operaciones de escritura se limitan por permisos server-side.</p>}
            </article>
            <aside className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6"><p className="text-xs uppercase tracking-[0.15em] text-white/32">Configuración IA</p><h2 className="mt-1 text-lg font-semibold">Perfil del negocio</h2><div className="mt-4 flex flex-wrap gap-2">{(data.spot.business_categories ?? []).map((category) => <span key={category} className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-white/48">{category}</span>)}</div>{data.spot.brand_tone ? <p className="mt-4 text-sm leading-6 text-white/42"><b className="text-white/65">Tono:</b> {data.spot.brand_tone}</p> : null}{suggestedOnlyModules.length ? <div className="mt-5"><p className="text-[10px] uppercase tracking-[0.13em] text-white/28">Módulos sugeridos fuera del commerce físico</p><div className="mt-2 flex flex-wrap gap-2">{suggestedOnlyModules.map((module) => <span key={module} className="rounded-lg bg-violet-300/[0.06] px-2 py-1 text-[11px] text-violet-200/65">{module}</span>)}</div></div> : null}</aside>
          </section>
        </> : null}
      </div>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="rounded-[22px] border border-white/[0.08] bg-[#0b0912] p-5"><span className="text-violet-300">{icon}</span><span className="mt-4 block text-[10px] uppercase tracking-[0.14em] text-white/30">{label}</span><strong className="mt-1 block text-2xl">{value}</strong></div>;
}
