"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  Copy,
  ExternalLink,
  Facebook,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  stock: number | null;
  status: string;
  cover_url: string | null;
  gallery: string[] | null;
};

type Destination = {
  id: string;
  name: string;
  type: "marketplace" | "group" | "page";
  facebook_url: string | null;
  facebook_id: string | null;
  enabled: boolean;
  cooldown_minutes: number;
  last_published_at: string | null;
};

type Config = {
  id: string;
  product_id: string;
  destination_id: string;
  publication_variant_id: string | null;
  enabled: boolean;
  custom_text: string | null;
  primary_image_url: string | null;
  image_urls: string[];
};

type Variant = {
  id: string;
  product_id: string;
  name: string;
  title: string | null;
  description: string | null;
  price_override: number | null;
  currency: string | null;
  primary_image_url: string | null;
  image_urls: string[];
};

type Batch = {
  id: string;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_jobs: number;
  published_jobs: number;
  failed_jobs: number;
  attention_jobs: number;
  skipped_jobs: number;
  created_at: string;
};

type Job = {
  id: string;
  batch_id: string;
  product_id: string;
  publication_variant_id: string | null;
  destination_id: string;
  channel: string;
  status: string;
  attempts: number;
  scheduled_at: string;
  completed_at: string | null;
  published_url: string | null;
  error_code: string | null;
  error_message: string | null;
  payload: {
    title?: string;
    description?: string;
    price?: number;
    currency?: string;
    images?: string[];
    primary_image_url?: string | null;
    destination_name?: string;
    destination_url?: string | null;
    destination_type?: string;
  };
};

type Overview = {
  space: { id: string; name: string; slug?: string };
  spot: { id: string; name: string; timezone: string; currency: string };
  connection: { status: string; facebook_name?: string | null; expires_at?: string | null };
  products: Product[];
  destinations: Destination[];
  configs: Config[];
  variants: Variant[];
  batches: Batch[];
  jobs: Job[];
  history: Array<Record<string, unknown>>;
};

const CARD = "rounded-[24px] border border-white/[0.08] bg-[#0b0912]";
const INPUT = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-violet-400/40";
const BUTTON = "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs font-semibold text-white/70 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const PRIMARY = "inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40";

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${Number(value || 0).toLocaleString("es-AR")}`;
  }
}

function when(value?: string | null) {
  if (!value) return "—";
  try { return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
  catch { return value; }
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    draft: "Borrador",
    queued: "En cola",
    running: "Publicando",
    paused: "Pausado",
    completed: "Completado",
    partial: "Requiere atención",
    failed: "Fallido",
    cancelled: "Cancelado",
    opening: "Abriendo",
    filling: "Completando",
    uploading_media: "Subiendo fotos",
    waiting_confirmation: "Tu confirmación",
    publishing: "Publicando",
    published: "Publicado",
    retrying: "Reintentando",
    skipped: "Omitido",
  };
  return map[status] || status;
}

function channelLabel(channel: string) {
  if (channel === "facebook_marketplace") return "Marketplace";
  if (channel === "facebook_group") return "Grupo";
  if (channel === "facebook_page") return "Página";
  return channel;
}

export function FacebookPublisher({ spaceId }: { spaceId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [attentionJobId, setAttentionJobId] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState("");
  const [groupDraft, setGroupDraft] = useState({ name: "", url: "", cooldown: "60" });
  const [variantDraft, setVariantDraft] = useState({ name: "", title: "", description: "" });

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/businesses/${encodeURIComponent(spaceId)}/facebook-publisher`);
      const payload = await readApiJson<Overview>(response);
      setData(payload);
      setSelected((current) => {
        const valid = new Set(payload.products.map((product) => product.id));
        return new Set(Array.from(current).filter((id) => valid.has(id)));
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el publicador.");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!data?.batches.some((batch) => ["queued", "running", "partial"].includes(batch.status))) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [data?.batches, load]);

  const destinationMap = useMemo(() => new Map((data?.destinations ?? []).map((destination) => [destination.id, destination])), [data?.destinations]);
  const productMap = useMemo(() => new Map((data?.products ?? []).map((product) => [product.id, product])), [data?.products]);
  const configsByProduct = useMemo(() => {
    const map = new Map<string, Config[]>();
    for (const config of data?.configs ?? []) {
      const list = map.get(config.product_id) ?? [];
      list.push(config);
      map.set(config.product_id, list);
    }
    return map;
  }, [data?.configs]);
  const variantsByProduct = useMemo(() => {
    const map = new Map<string, Variant[]>();
    for (const variant of data?.variants ?? []) {
      const list = map.get(variant.product_id) ?? [];
      list.push(variant);
      map.set(variant.product_id, list);
    }
    return map;
  }, [data?.variants]);

  const selectedProducts = useMemo(() => (data?.products ?? []).filter((product) => selected.has(product.id)), [data?.products, selected]);
  const summary = useMemo(() => {
    let marketplace = 0;
    let groups = 0;
    let pages = 0;
    for (const product of selectedProducts) {
      for (const config of configsByProduct.get(product.id) ?? []) {
        if (!config.enabled) continue;
        const destination = destinationMap.get(config.destination_id);
        if (!destination?.enabled) continue;
        if (destination.type === "marketplace") marketplace += 1;
        if (destination.type === "group") groups += 1;
        if (destination.type === "page") pages += 1;
      }
    }
    return { products: selectedProducts.length, marketplace, groups, pages, total: marketplace + groups + pages };
  }, [configsByProduct, destinationMap, selectedProducts]);

  const latestBatch = data?.batches[0] ?? null;
  const latestJobs = latestBatch ? (data?.jobs ?? []).filter((job) => job.batch_id === latestBatch.id) : [];
  const attentionJob = attentionJobId ? (data?.jobs ?? []).find((job) => job.id === attentionJobId) ?? null : null;
  const editProduct = editProductId ? productMap.get(editProductId) ?? null : null;

  async function post<T>(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/businesses/${encodeURIComponent(spaceId)}/facebook-publisher`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const payload = await readApiJson<T>(response);
      await load();
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la acción.");
      throw cause;
    } finally {
      setBusy(null);
    }
  }

  function toggleSelected(productId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  async function publish(scheduledAt?: string | null) {
    const idempotencyKey = crypto.randomUUID();
    await post({
      action: "create_batch",
      productIds: Array.from(selected),
      scheduledAt: scheduledAt || null,
      idempotencyKey,
    }, "publish");
    setConfirmOpen(false);
    setScheduleOpen(false);
  }

  async function toggleDestination(productId: string, destination: Destination | "marketplace", enabled: boolean) {
    await post({
      action: "save_product_destination",
      productId,
      ...(destination === "marketplace"
        ? { destinationType: "marketplace" }
        : { destinationId: destination.id }),
      enabled,
    }, `config:${productId}:${destination === "marketplace" ? "marketplace" : destination.id}`);
  }

  async function saveGroup() {
    if (!groupDraft.name.trim() || !groupDraft.url.trim()) return;
    await post({
      action: "save_destination",
      destination: {
        name: groupDraft.name,
        type: "group",
        facebookUrl: groupDraft.url,
        enabled: true,
        cooldownMinutes: Math.max(0, Number(groupDraft.cooldown) || 0),
      },
    }, "save-group");
    setGroupDraft({ name: "", url: "", cooldown: "60" });
  }

  async function saveVariant(productId: string) {
    if (!variantDraft.name.trim()) return;
    await post({
      action: "save_variant",
      variant: {
        productId,
        name: variantDraft.name,
        title: variantDraft.title || null,
        description: variantDraft.description || null,
      },
    }, `variant:${productId}`);
    setVariantDraft({ name: "", title: "", description: "" });
  }

  async function controlBatch(action: "pause" | "resume" | "cancel" | "retry_failed") {
    if (!latestBatch) return;
    await post({ action, batchId: latestBatch.id }, `batch:${action}`);
  }

  async function confirmJob() {
    if (!attentionJob) return;
    await post({
      action: "confirm_job",
      jobId: attentionJob.id,
      publishedUrl: publishedUrl || null,
    }, `confirm:${attentionJob.id}`);
    setAttentionJobId(null);
    setPublishedUrl("");
  }

  async function copy(value: string | number | undefined | null) {
    if (value == null) return;
    await navigator.clipboard.writeText(String(value));
  }

  if (loading) {
    return <div className="grid min-h-[50vh] place-items-center bg-[#05040a] text-white"><span className="inline-flex items-center gap-2 text-sm text-white/45"><Loader2 className="h-4 w-4 animate-spin" /> Cargando Publicador Facebook…</span></div>;
  }

  if (!data) {
    return <div className="min-h-screen bg-[#05040a] p-5 text-white"><div className={`${CARD} mx-auto max-w-xl p-5`}><p className="text-rose-200">{error || "No se pudo abrir el publicador."}</p></div></div>;
  }

  return (
    <div className="min-h-screen bg-[#05040a] pb-32 text-white">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <header className={`${CARD} overflow-hidden p-5 sm:p-7`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/[0.07] px-3 py-1 text-[10px] font-semibold uppercase tracking-[.16em] text-blue-200"><Facebook size={12} /> SIZ 8340</span>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">PUBLICADOR FACEBOOK</h1>
              <p className="mt-2 text-sm text-white/42">Player Clouva → Bisnes {data.space.name}. Productos canónicos de este Bisnes, sin inventario paralelo.</p>
            </div>
            <button className={BUTTON} onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw size={14} /> Actualizar</button>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-4">
            <Metric label="Publicadas" value={String(latestBatch?.published_jobs ?? 0)} />
            <Metric label="Pendientes" value={String(latestJobs.filter((job) => ["queued", "opening", "filling", "uploading_media", "publishing", "retrying"].includes(job.status)).length)} />
            <Metric label="Fallidas" value={String(latestBatch?.failed_jobs ?? 0)} />
            <Metric label="Requieren atención" value={String(latestBatch?.attention_jobs ?? 0)} />
          </div>
        </header>

        <section className={`${CARD} mt-4 p-4 sm:p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-white/35">Facebook</p>
              <p className="mt-1 text-sm text-white/70">{data.connection.status === "connected" ? `Conectado · ${data.connection.facebook_name || "Cuenta Facebook"}` : data.connection.status === "attention_required" ? "Requiere atención" : data.connection.status === "expired" ? "Sesión vencida" : "No conectado"}</p>
            </div>
            <a href={`/api/integrations/facebook/connect?spaceId=${encodeURIComponent(spaceId)}`} className={BUTTON}><Facebook size={14} /> CONECTAR FACEBOOK</a>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-white/32">Marketplace y Grupos usan confirmación asistida cuando Meta no ofrece una API oficial. CLOUVA nunca guarda tu contraseña ni marca una publicación como realizada sin confirmación real.</p>
        </section>

        <section className={`${CARD} mt-4 p-4 sm:p-5`}>
          <div className="flex items-center justify-between gap-3">
            <button className={BUTTON} onClick={() => setSelected(new Set(selected.size === data.products.length ? [] : data.products.map((product) => product.id)))}>
              {selected.size === data.products.length && data.products.length ? <Check size={14} /> : <Square size={14} />} Seleccionar todos
            </button>
            <button className={BUTTON} onClick={() => setSettingsOpen((value) => !value)}><Settings2 size={14} /> Destinos {settingsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
          </div>

          {settingsOpen ? (
            <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
              <p className="text-sm font-semibold">Grupos reutilizables</p>
              <p className="mt-1 text-xs text-white/35">Los agregás una vez y después los activás por producto desde “Editar publicación”.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.5fr_.6fr_auto]">
                <input className={INPUT} placeholder="Nombre del grupo" value={groupDraft.name} onChange={(event) => setGroupDraft((current) => ({ ...current, name: event.target.value }))} />
                <input className={INPUT} placeholder="https://facebook.com/groups/..." value={groupDraft.url} onChange={(event) => setGroupDraft((current) => ({ ...current, url: event.target.value }))} />
                <input className={INPUT} inputMode="numeric" placeholder="Cooldown min" value={groupDraft.cooldown} onChange={(event) => setGroupDraft((current) => ({ ...current, cooldown: event.target.value }))} />
                <button className={BUTTON} disabled={busy === "save-group"} onClick={() => void saveGroup()}>{busy === "save-group" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Agregar</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.destinations.filter((destination) => destination.type === "group").map((destination) => <span key={destination.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55">{destination.name} · {destination.cooldown_minutes} min</span>)}
                {!data.destinations.some((destination) => destination.type === "group") ? <span className="text-xs text-white/28">Todavía no hay grupos guardados.</span> : null}
              </div>
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            {data.products.map((product) => {
              const productConfigs = (configsByProduct.get(product.id) ?? []).filter((config) => config.enabled);
              const marketplaceCount = productConfigs.filter((config) => destinationMap.get(config.destination_id)?.type === "marketplace").length;
              const groupCount = productConfigs.filter((config) => destinationMap.get(config.destination_id)?.type === "group").length;
              const active = selected.has(product.id);
              return (
                <article key={product.id} className={`rounded-2xl border p-3 transition ${active ? "border-violet-400/35 bg-violet-500/[0.055]" : "border-white/[0.07] bg-black/20"}`}>
                  <div className="flex gap-3">
                    <button onClick={() => toggleSelected(product.id)} className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${active ? "border-violet-400 bg-violet-500 text-white" : "border-white/15 text-white/25"}`}>{active ? <Check size={14} /> : null}</button>
                    <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.04]">{product.cover_url ? <img src={product.cover_url} alt={product.name} className="h-full w-full object-cover" /> : <Circle size={18} className="text-white/20" />}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="truncate text-sm font-semibold">{product.name}</p><p className="mt-1 text-xs font-semibold text-violet-200">{money(Number(product.price), product.currency)}</p></div>
                        <button className={BUTTON} onClick={() => setEditProductId(editProductId === product.id ? null : product.id)}>Editar publicación</button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                        <span className={`rounded-lg border px-2 py-1 ${marketplaceCount ? "border-emerald-400/20 text-emerald-200" : "border-white/10 text-white/30"}`}>Marketplace {marketplaceCount ? "✓" : "—"}</span>
                        <span className={`rounded-lg border px-2 py-1 ${groupCount ? "border-emerald-400/20 text-emerald-200" : "border-white/10 text-white/30"}`}>Grupos {groupCount} {groupCount ? "✓" : ""}</span>
                      </div>
                    </div>
                  </div>

                  {editProductId === product.id ? (
                    <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/25 p-3">
                      <p className="text-xs font-semibold">Destinos</p>
                      <div className="mt-2 space-y-2">
                        <DestinationToggle
                          label="Facebook Marketplace"
                          enabled={marketplaceCount > 0}
                          busy={Boolean(busy)}
                          onToggle={(enabled) => void toggleDestination(product.id, "marketplace", enabled)}
                        />
                        {data.destinations.filter((destination) => destination.type === "group").map((destination) => {
                          const enabled = productConfigs.some((config) => config.destination_id === destination.id);
                          return <DestinationToggle key={destination.id} label={destination.name} enabled={enabled} busy={Boolean(busy)} onToggle={(next) => void toggleDestination(product.id, destination, next)} />;
                        })}
                      </div>

                      <div className="mt-4 border-t border-white/[0.06] pt-3">
                        <p className="text-xs font-semibold">Nueva variante de anuncio</p>
                        <p className="mt-1 text-[10px] text-white/30">Cambia creatividad sin duplicar el producto.</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <input className={INPUT} placeholder="Nombre variante (ej. A)" value={variantDraft.name} onChange={(event) => setVariantDraft((current) => ({ ...current, name: event.target.value }))} />
                          <input className={INPUT} placeholder="Título específico" value={variantDraft.title} onChange={(event) => setVariantDraft((current) => ({ ...current, title: event.target.value }))} />
                          <textarea className={`${INPUT} sm:col-span-2`} rows={3} placeholder="Descripción específica" value={variantDraft.description} onChange={(event) => setVariantDraft((current) => ({ ...current, description: event.target.value }))} />
                          <button className={BUTTON} disabled={busy === `variant:${product.id}`} onClick={() => void saveVariant(product.id)}><Plus size={13} /> Guardar variante</button>
                        </div>
                        {(variantsByProduct.get(product.id) ?? []).length ? <div className="mt-2 flex flex-wrap gap-2">{(variantsByProduct.get(product.id) ?? []).map((variant) => <span key={variant.id} className="rounded-lg border border-violet-400/15 px-2 py-1 text-[10px] text-violet-200">{variant.name}</span>)}</div> : null}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}

            {!data.products.length ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
                <p className="text-sm font-semibold">SIZ 8340 todavía no tiene productos.</p>
                <p className="mt-2 text-xs leading-5 text-white/35">Cuando cargues productos en este Bisnes van a aparecer acá automáticamente. No se traen productos de El Iglú ni de otro Spot.</p>
              </div>
            ) : null}
          </div>
        </section>

        {latestBatch ? (
          <section className={`${CARD} mt-4 p-4 sm:p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[.16em] text-white/30">Último lote</p>
                <h2 className="mt-1 text-lg font-semibold">{statusLabel(latestBatch.status)} · {latestBatch.total_jobs} destinos</h2>
                <p className="mt-1 text-xs text-white/35">{when(latestBatch.created_at)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {latestBatch.status === "running" || latestBatch.status === "queued" ? <button className={BUTTON} onClick={() => void controlBatch("pause")}><Pause size={13} /> Pausar</button> : null}
                {latestBatch.status === "paused" ? <button className={BUTTON} onClick={() => void controlBatch("resume")}><Play size={13} /> Continuar</button> : null}
                {!["completed", "cancelled"].includes(latestBatch.status) ? <button className={BUTTON} onClick={() => void controlBatch("cancel")}><X size={13} /> Cancelar</button> : null}
                {latestBatch.failed_jobs > 0 ? <button className={BUTTON} onClick={() => void controlBatch("retry_failed")}><RotateCcw size={13} /> Reintentar fallidos</button> : null}
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${latestBatch.total_jobs ? Math.min(100, ((latestBatch.published_jobs + latestBatch.failed_jobs + latestBatch.attention_jobs + latestBatch.skipped_jobs) / latestBatch.total_jobs) * 100) : 0}%` }} /></div>
            <p className="mt-2 text-xs text-white/35">PUBLICANDO {latestBatch.published_jobs + latestBatch.failed_jobs + latestBatch.attention_jobs + latestBatch.skipped_jobs} / {latestBatch.total_jobs}</p>

            <div className="mt-4 space-y-2">
              {latestJobs.map((job) => {
                const product = productMap.get(job.product_id);
                const destination = destinationMap.get(job.destination_id);
                const attention = job.status === "waiting_confirmation";
                return <div key={job.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5">
                  <div className="min-w-0 flex items-center gap-2">
                    {job.status === "published" ? <CheckCircle2 size={14} className="shrink-0 text-emerald-300" /> : job.status === "failed" ? <AlertTriangle size={14} className="shrink-0 text-rose-300" /> : attention ? <Clock3 size={14} className="shrink-0 text-amber-300" /> : <Circle size={12} className="shrink-0 text-white/25" />}
                    <div className="min-w-0"><p className="truncate text-xs font-semibold">{product?.name || "Producto"} — {destination?.name || channelLabel(job.channel)}</p><p className="mt-0.5 text-[10px] text-white/30">{statusLabel(job.status)}{job.error_message ? ` · ${job.error_message}` : ""}</p></div>
                  </div>
                  {attention ? <button className={BUTTON} onClick={() => { setAttentionJobId(job.id); setPublishedUrl(job.published_url || ""); }}>Continuar</button> : job.published_url ? <a className={BUTTON} href={job.published_url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Ver</a> : null}
                </div>;
              })}
            </div>
          </section>
        ) : null}

        {error ? <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/[0.07] p-4 text-sm text-rose-200">{error}</p> : null}
      </div>

      {data.products.length ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#07060b]/95 px-4 py-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl items-center gap-2">
            <div className="min-w-0 flex-1"><p className="text-xs text-white/35">{selected.size} productos · {summary.total} publicaciones</p><p className="truncate text-[10px] text-white/25">{summary.marketplace} Marketplace · {summary.groups} grupos · {summary.pages} páginas</p></div>
            <button className={BUTTON} disabled={!selected.size || Boolean(busy)} onClick={() => setScheduleOpen(true)}><Clock3 size={14} /> Programar</button>
            <button className={PRIMARY} disabled={!selected.size || Boolean(busy)} onClick={() => setConfirmOpen(true)}>{busy === "publish" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} PUBLICAR TODO</button>
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <Modal onClose={() => setConfirmOpen(false)} title="Confirmar lote">
          <div className="grid gap-2 sm:grid-cols-2">
            <Metric label="Productos" value={String(summary.products)} />
            <Metric label="Total publicaciones" value={String(summary.total)} />
            <Metric label="Marketplace" value={String(summary.marketplace)} />
            <Metric label="Grupos" value={String(summary.groups)} />
          </div>
          {summary.total === 0 ? <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/[0.07] p-3 text-xs text-amber-100">Los productos seleccionados no tienen destinos activos. Usá “Editar publicación” una sola vez para elegir Marketplace y grupos.</p> : null}
          <div className="mt-5 flex justify-end gap-2"><button className={BUTTON} onClick={() => setConfirmOpen(false)}>CANCELAR</button><button className={PRIMARY} disabled={!summary.total || busy === "publish"} onClick={() => void publish(null)}>PUBLICAR</button></div>
        </Modal>
      ) : null}

      {scheduleOpen ? (
        <Modal onClose={() => setScheduleOpen(false)} title="Programar lote">
          <label className="text-xs text-white/40">Fecha y hora</label>
          <input type="datetime-local" className={`${INPUT} mt-2`} value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
          <p className="mt-2 text-[10px] text-white/30">No crea recurrencia automática. Este lote se ejecuta una sola vez.</p>
          <div className="mt-5 flex justify-end gap-2"><button className={BUTTON} onClick={() => setScheduleOpen(false)}>CANCELAR</button><button className={PRIMARY} disabled={!scheduleAt || !summary.total || busy === "publish"} onClick={() => void publish(new Date(scheduleAt).toISOString())}>PROGRAMAR</button></div>
        </Modal>
      ) : null}

      {attentionJob ? (
        <Modal onClose={() => { setAttentionJobId(null); setPublishedUrl(""); }} title="Facebook requiere tu intervención">
          <p className="text-xs leading-5 text-white/45">CLOUVA no intenta saltar verificaciones ni automatiza una función que Meta no expone. Acá tenés todo listo para confirmar el post real.</p>
          <div className="mt-4 space-y-2">
            <CopyRow label="Título" value={attentionJob.payload.title || ""} onCopy={() => void copy(attentionJob.payload.title)} />
            <CopyRow label="Precio" value={attentionJob.payload.price != null ? money(attentionJob.payload.price, attentionJob.payload.currency || "ARS") : "—"} onCopy={() => void copy(attentionJob.payload.price)} />
            <CopyRow label="Descripción" value={attentionJob.payload.description || ""} onCopy={() => void copy(attentionJob.payload.description)} multiline />
          </div>
          {(attentionJob.payload.images ?? []).length ? <div className="mt-4"><p className="text-xs text-white/35">Imágenes listas</p><div className="mt-2 flex gap-2 overflow-x-auto">{(attentionJob.payload.images ?? []).map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0 overflow-hidden rounded-xl border border-white/10"><img src={url} alt="" className="h-20 w-20 object-cover" /></a>)}</div></div> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={PRIMARY} onClick={() => window.open(attentionJob.payload.destination_url || (attentionJob.channel === "facebook_marketplace" ? "https://www.facebook.com/marketplace/create/item" : "https://www.facebook.com/"), "_blank", "noopener,noreferrer")}><ExternalLink size={14} /> ABRIR FACEBOOK</button>
            <button className={BUTTON} onClick={() => void copy(`${attentionJob.payload.title || ""}\n\n${attentionJob.payload.description || ""}`)}><Copy size={13} /> Copiar todo</button>
          </div>
          <div className="mt-5 border-t border-white/[0.07] pt-4">
            <label className="text-xs text-white/35">URL publicada (opcional)</label>
            <input className={`${INPUT} mt-2`} placeholder="https://facebook.com/..." value={publishedUrl} onChange={(event) => setPublishedUrl(event.target.value)} />
            <button className={`${PRIMARY} mt-3 w-full`} disabled={busy === `confirm:${attentionJob.id}`} onClick={() => void confirmJob()}>{busy === `confirm:${attentionJob.id}` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} CONFIRMAR PUBLICADA</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[.12em] text-white/28">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>;
}

function DestinationToggle({ label, enabled, busy, onToggle }: { label: string; enabled: boolean; busy: boolean; onToggle: (value: boolean) => void }) {
  return <button type="button" disabled={busy} onClick={() => onToggle(!enabled)} className="flex w-full items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left text-xs"><span>{label}</span><span className={enabled ? "text-emerald-300" : "text-white/25"}>{enabled ? "ACTIVO" : "INACTIVO"}</span></button>;
}

function CopyRow({ label, value, onCopy, multiline = false }: { label: string; value: string; onCopy: () => void; multiline?: boolean }) {
  return <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] uppercase tracking-[.12em] text-white/28">{label}</p><p className={`mt-1 text-xs text-white/70 ${multiline ? "whitespace-pre-wrap leading-5" : "truncate"}`}>{value || "—"}</p></div><button className={BUTTON} onClick={onCopy}><Copy size={12} /> Copiar</button></div></div>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-0 sm:place-items-center sm:p-4"><div className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#0b0912] p-5 text-white sm:max-w-xl sm:rounded-[28px]"><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">{title}</h3><button className={BUTTON} onClick={onClose}><X size={14} /></button></div><div className="mt-4">{children}</div></div></div>;
}
