"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  ExternalLink,
  Facebook,
  ImageIcon,
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
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { supabase } from "@/lib/supabase";

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
  last_published_at: string | null;
  cooldown_minutes: number;
  notes: string | null;
};

type ProductDestination = {
  id: string;
  product_id: string;
  destination_id: string;
  variant_id: string | null;
  enabled: boolean;
  custom_text: string | null;
  primary_image_url: string | null;
  image_urls: string[];
  frequency_minutes: number | null;
};

type PublicationVariant = {
  id: string;
  product_id: string;
  name: string;
  title: string | null;
  description: string | null;
  price_override: number | null;
  category: string | null;
  condition: string | null;
  location_text: string | null;
  primary_image_url: string | null;
  image_urls: string[];
  active: boolean;
};

type Job = {
  id: string;
  batch_id: string;
  product_id: string;
  channel: string;
  destination_id: string;
  status: string;
  attempts: number;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  published_url: string | null;
  error_code: string | null;
  error_message: string | null;
  intervention_url: string | null;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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
  updated_at: string;
  jobs?: Job[];
};

type Overview = {
  spot: { id: string; name: string; timezone: string; currency: string };
  products: Product[];
  destinations: Destination[];
  productDestinations: ProductDestination[];
  variants: PublicationVariant[];
  facebook: {
    status: "not_connected" | "connected" | "requires_attention" | "expired";
    facebook_user_id: string | null;
    display_name: string | null;
    token_expires_at: string | null;
    scopes: string[];
    last_verified_at: string | null;
    attention_reason: string | null;
  };
  today: { published: number; pending: number; failed: number; attention: number };
  latestBatch: (Batch & { jobs: Job[] }) | null;
};

const CARD = "rounded-[24px] border border-white/[0.08] bg-[#0b0912]";
const BUTTON = "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-semibold text-white/75 transition hover:border-violet-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const INPUT = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-violet-400/45";

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return currency + " " + Number(value || 0).toLocaleString("es-AR");
  }
}

function when(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusText(status: string) {
  const labels: Record<string, string> = {
    queued: "esperando",
    opening: "abriendo",
    filling: "preparando datos",
    uploading_media: "preparando fotos",
    waiting_confirmation: "requiere intervención",
    publishing: "publicando",
    published: "publicado",
    retrying: "reintentando",
    failed: "falló",
    skipped: "omitido",
  };
  return labels[status] || status;
}

function channelText(channel: string) {
  if (channel === "facebook_marketplace") return "Marketplace";
  if (channel === "facebook_group") return "Grupo";
  if (channel === "facebook_page") return "Página";
  return channel;
}

function terminal(status: string) {
  return ["completed","partial","failed","cancelled"].includes(status);
}

export default function FacebookPublisherPage() {
  const { user, loading: authLoading } = useAuth();
  const [spotId, setSpotId] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [batch, setBatch] = useState<(Batch & { jobs: Job[] }) | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState({ name: "", url: "", cooldown: "1440" });
  const [variantDraft, setVariantDraft] = useState({ name: "", title: "", description: "", price: "", images: "" });
  const pendingBatchKey = useRef<string | null>(null);

  const resolveSpot = useCallback(async () => {
    const current = new URLSearchParams(window.location.search).get("spotId") || "";
    if (current) return current;
    const response = await authenticatedFetch("/api/mi-spot");
    const payload = await readApiJson<{ spots: Array<{ id: string; capabilities?: string[] }> }>(response);
    const candidate = payload.spots.find((spot) => spot.capabilities?.includes("content")) ?? payload.spots[0];
    if (!candidate) throw new Error("No tenés un Mi Spot disponible.");
    const url = new URL(window.location.href);
    url.searchParams.set("spotId", candidate.id);
    window.history.replaceState({}, "", url.toString());
    return candidate.id;
  }, []);

  const loadOverview = useCallback(async (requestedSpotId?: string) => {
    if (!user) return;
    const id = requestedSpotId || spotId || await resolveSpot();
    setSpotId(id);
    const response = await authenticatedFetch("/api/mi-spot/" + encodeURIComponent(id) + "/publisher");
    const payload = await readApiJson<Overview>(response);
    setOverview(payload);
    if (!batch && payload.latestBatch) setBatch(payload.latestBatch);
  }, [batch, resolveSpot, spotId, user]);

  const loadBatch = useCallback(async (batchId: string) => {
    if (!spotId || !batchId) return;
    const response = await authenticatedFetch("/api/mi-spot/" + encodeURIComponent(spotId) + "/publisher/batches/" + encodeURIComponent(batchId));
    const payload = await readApiJson<{ batch: Batch; jobs: Job[] }>(response);
    setBatch({ ...payload.batch, jobs: payload.jobs });
    if (terminal(payload.batch.status)) void loadOverview(spotId);
  }, [loadOverview, spotId]);

  useEffect(() => {
    if (authLoading || !user) {
      if (!authLoading) setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    resolveSpot()
      .then((id) => {
        if (!alive) return;
        setSpotId(id);
        return loadOverview(id);
      })
      .catch((cause) => alive && setError(cause instanceof Error ? cause.message : "No se pudo cargar el publicador."))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [authLoading, loadOverview, resolveSpot, user]);

  useEffect(() => {
    const batchId = batch?.id;
    if (!batchId || !user) return;

    const channel = supabase
      .channel("facebook-publisher-" + batchId)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "publication_batches", filter: "id=eq." + batchId }, () => void loadBatch(batchId))
      .on("postgres_changes", { event: "*", schema: "public", table: "publication_jobs", filter: "batch_id=eq." + batchId }, () => void loadBatch(batchId))
      .subscribe();

    const poll = window.setInterval(() => {
      if (!terminal(batch.status)) void loadBatch(batchId);
    }, 3500);

    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [batch?.id, batch?.status, loadBatch, user]);

  const destinationById = useMemo(
    () => new Map((overview?.destinations ?? []).map((destination) => [destination.id, destination])),
    [overview?.destinations],
  );
  const productById = useMemo(
    () => new Map((overview?.products ?? []).map((product) => [product.id, product])),
    [overview?.products],
  );
  const configByKey = useMemo(
    () => new Map((overview?.productDestinations ?? []).map((config) => [config.product_id + ":" + config.destination_id, config])),
    [overview?.productDestinations],
  );

  const summary = useMemo(() => {
    let marketplace = 0;
    let groups = 0;
    let pages = 0;
    for (const productId of selected) {
      for (const config of overview?.productDestinations ?? []) {
        if (config.product_id !== productId || !config.enabled) continue;
        const destination = destinationById.get(config.destination_id);
        if (!destination?.enabled) continue;
        if (destination.type === "marketplace") marketplace += 1;
        else if (destination.type === "group") groups += 1;
        else pages += 1;
      }
    }
    return { products: selected.size, marketplace, groups, pages, total: marketplace + groups + pages };
  }, [destinationById, overview?.productDestinations, selected]);

  function toggleProduct(productId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function selectAll() {
    const all = overview?.products ?? [];
    setSelected((current) => current.size === all.length ? new Set() : new Set(all.map((product) => product.id)));
  }

  async function publishBatch() {
    if (!spotId || !selected.size) return;
    if (scheduleMode === "schedule" && !scheduledAt) {
      setError("Elegí fecha y hora para programar.");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      if (!pendingBatchKey.current) pendingBatchKey.current = "facebook-publisher:" + crypto.randomUUID();
      const response = await authenticatedFetch("/api/mi-spot/" + encodeURIComponent(spotId) + "/publisher", {
        method: "POST",
        body: JSON.stringify({
          productIds: Array.from(selected),
          idempotencyKey: pendingBatchKey.current,
          scheduledAt: scheduleMode === "schedule" ? new Date(scheduledAt).toISOString() : null,
        }),
      });
      const payload = await readApiJson<{ batch: Batch }>(response);
      pendingBatchKey.current = null;
      setConfirmOpen(false);
      setSelected(new Set());
      await loadBatch(payload.batch.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el lote.");
    } finally {
      setWorking(false);
    }
  }

  async function batchAction(action: "pause" | "resume" | "cancel" | "retry_failed") {
    if (!batch || !spotId) return;
    setWorking(true);
    setError(null);
    try {
      await authenticatedFetch("/api/mi-spot/" + encodeURIComponent(spotId) + "/publisher/batches/" + encodeURIComponent(batch.id), {
        method: "PATCH",
        body: JSON.stringify({ action }),
      }).then((response) => readApiJson(response));
      await loadBatch(batch.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el lote.");
    } finally {
      setWorking(false);
    }
  }

  async function confirmJob(job: Job) {
    if (!spotId) return;
    const publishedUrl = window.prompt("Pegá la URL publicada si la tenés. Podés dejarla vacía.", job.published_url || "") ?? "";
    setWorking(true);
    setError(null);
    try {
      await authenticatedFetch("/api/mi-spot/" + encodeURIComponent(spotId) + "/publisher/jobs/" + encodeURIComponent(job.id) + "/confirm", {
        method: "POST",
        body: JSON.stringify({ publishedUrl: publishedUrl.trim() || null }),
      }).then((response) => readApiJson(response));
      await loadBatch(job.batch_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo confirmar la publicación.");
    } finally {
      setWorking(false);
    }
  }

  async function prepareIntervention(job: Job) {
    const payload = job.payload || {};
    const copy = [
      String(payload.title || ""),
      payload.price != null ? String(payload.currency || "") + " " + String(payload.price) : "",
      String(payload.description || ""),
      payload.location ? "Ubicación: " + String(payload.location) : "",
    ].filter(Boolean).join("\n\n");
    try { await navigator.clipboard.writeText(copy); } catch { /* browser permission may be denied */ }
    if (job.intervention_url) window.open(job.intervention_url, "_blank", "noopener,noreferrer");
  }

  async function saveGroup() {
    if (!spotId || !groupDraft.name.trim() || !groupDraft.url.trim()) return;
    setWorking(true);
    setError(null);
    try {
      await authenticatedFetch("/api/mi-spot/" + encodeURIComponent(spotId) + "/publisher/config", {
        method: "POST",
        body: JSON.stringify({
          action: "save_destination",
          type: "group",
          name: groupDraft.name,
          facebookUrl: groupDraft.url,
          cooldownMinutes: Number(groupDraft.cooldown || 1440),
        }),
      }).then((response) => readApiJson(response));
      setGroupDraft({ name: "", url: "", cooldown: "1440" });
      await loadOverview(spotId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el grupo.");
    } finally {
      setWorking(false);
    }
  }

  async function setDestination(productId: string, destination: Destination, changes: Partial<ProductDestination>) {
    if (!spotId) return;
    const current = configByKey.get(productId + ":" + destination.id);
    setWorking(true);
    setError(null);
    try {
      await authenticatedFetch("/api/mi-spot/" + encodeURIComponent(spotId) + "/publisher/config", {
        method: "POST",
        body: JSON.stringify({
          action: "set_product_destination",
          productId,
          destinationId: destination.id,
          enabled: changes.enabled ?? current?.enabled ?? true,
          variantId: changes.variant_id === undefined ? current?.variant_id : changes.variant_id,
          customText: changes.custom_text === undefined ? current?.custom_text : changes.custom_text,
          primaryImageUrl: changes.primary_image_url === undefined ? current?.primary_image_url : changes.primary_image_url,
          imageUrls: changes.image_urls === undefined ? current?.image_urls : changes.image_urls,
          frequencyMinutes: changes.frequency_minutes === undefined ? current?.frequency_minutes : changes.frequency_minutes,
        }),
      }).then((response) => readApiJson(response));
      await loadOverview(spotId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el destino.");
    } finally {
      setWorking(false);
    }
  }

  async function saveVariant(productId: string) {
    if (!spotId || !variantDraft.name.trim()) return;
    setWorking(true);
    setError(null);
    try {
      await authenticatedFetch("/api/mi-spot/" + encodeURIComponent(spotId) + "/publisher/config", {
        method: "POST",
        body: JSON.stringify({
          action: "save_variant",
          productId,
          name: variantDraft.name,
          title: variantDraft.title,
          description: variantDraft.description,
          priceOverride: variantDraft.price,
          imageUrls: variantDraft.images.split("\n").map((value) => value.trim()).filter(Boolean),
        }),
      }).then((response) => readApiJson(response));
      setVariantDraft({ name: "", title: "", description: "", price: "", images: "" });
      await loadOverview(spotId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la variante.");
    } finally {
      setWorking(false);
    }
  }

  if (authLoading || loading) {
    return <main className="min-h-screen bg-[#05040a] text-white"><MainNav /><div className="grid min-h-[70vh] place-items-center"><span className="inline-flex items-center gap-2 text-sm text-white/45"><Loader2 className="h-4 w-4 animate-spin" /> Cargando Publicador Facebook…</span></div></main>;
  }

  if (!user) {
    return <main className="min-h-screen bg-[#05040a] text-white"><MainNav /><div className="mx-auto max-w-xl px-4 py-20 text-center"><h1 className="text-3xl font-semibold">PUBLICADOR FACEBOOK</h1><p className="mt-3 text-sm text-white/45">Iniciá sesión para usar Mi Spot.</p></div></main>;
  }

  const products = overview?.products ?? [];
  const allSelected = products.length > 0 && selected.size === products.length;
  const jobs = batch?.jobs ?? [];
  const processed = jobs.filter((job) => ["published","failed","skipped","waiting_confirmation"].includes(job.status)).length;
  const progress = jobs.length ? Math.round((processed / jobs.length) * 100) : 0;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const activeProduct = products.find((product) => product.id === editingProductId) ?? null;

  return (
    <main className="min-h-screen bg-[#05040a] pb-32 text-white">
      <MainNav />
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
        <div className="flex items-center justify-between gap-3">
          <Link href={spotId ? "/mi-spot/" + spotId : "/mi-spot"} className="inline-flex items-center gap-2 text-sm text-white/45 hover:text-white"><ArrowLeft size={15} /> Mi Spot</Link>
          <Link href={spotId ? "/mi-spot/publicador/facebook?spotId=" + encodeURIComponent(spotId) : "/mi-spot/publicador/facebook"} className={BUTTON}><Facebook size={14} /> Facebook <Settings2 size={13} /></Link>
        </div>

        <section className="mt-5 overflow-hidden rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0e0a17] to-[#09080f] p-5 sm:p-8">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.18em] text-violet-200"><Facebook size={15} /> Mi Spot</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">PUBLICADOR FACEBOOK</h1>
          <p className="mt-2 text-sm text-white/45">{overview?.spot.name || "CLOUVA"} · elegís productos, tocás una vez y CLOUVA administra el lote completo.</p>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Publicadas hoy" value={overview?.today.published ?? 0} />
            <Metric label="Pendientes" value={overview?.today.pending ?? 0} />
            <Metric label="Fallidas" value={overview?.today.failed ?? 0} />
            <Metric label="Requieren atención" value={overview?.today.attention ?? 0} />
          </div>
        </section>

        {error ? <div className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/[0.07] p-4 text-sm text-rose-100"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span><button className="ml-auto" onClick={() => setError(null)}><X size={15} /></button></div> : null}

        {batch ? (
          <section className={"mt-5 " + CARD + " p-5"}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[.16em] text-violet-300">Último lote</p>
                <h2 className="mt-1 text-xl font-semibold">{batch.status === "running" ? "PUBLICANDO " + processed + " / " + jobs.length : batch.status.toUpperCase()}</h2>
                <p className="mt-1 text-xs text-white/35">{when(batch.created_at)} · {jobs.length} destinos</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {["queued","running"].includes(batch.status) ? <button disabled={working} onClick={() => void batchAction("pause")} className={BUTTON}><Pause size={13} /> Pausar</button> : null}
                {batch.status === "paused" ? <button disabled={working} onClick={() => void batchAction("resume")} className={BUTTON}><Play size={13} /> Continuar</button> : null}
                {!["cancelled","completed"].includes(batch.status) ? <button disabled={working} onClick={() => void batchAction("cancel")} className={BUTTON}><Square size={12} /> Cancelar</button> : null}
                {failedJobs > 0 ? <button disabled={working} onClick={() => void batchAction("retry_failed")} className={BUTTON}><RotateCcw size={13} /> Reintentar fallidos</button> : null}
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: progress + "%" }} /></div>
            <div className="mt-4 space-y-2">
              {jobs.map((job) => {
                const product = productById.get(job.product_id);
                const destination = destinationById.get(job.destination_id);
                const payloadImages = Array.isArray(job.payload?.imageUrls) ? job.payload.imageUrls.filter((value): value is string => typeof value === "string") : [];
                return (
                  <div key={job.id} className="rounded-2xl border border-white/[0.07] bg-black/20 p-3">
                    <div className="flex items-start gap-3">
                      <JobIcon status={job.status} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{product?.name || String(job.payload?.title || "Producto")} — {destination?.name || channelText(job.channel)}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-[.12em] text-white/35">{channelText(job.channel)} · {statusText(job.status)}</p>
                        {job.error_message ? <p className="mt-2 text-xs leading-5 text-amber-100/80">{job.error_message}</p> : null}
                        {job.published_url ? <a href={job.published_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-violet-300"><ExternalLink size={12} /> Ver publicación</a> : null}
                        {job.status === "waiting_confirmation" ? (
                          <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-400/[0.05] p-3">
                            <p className="text-xs font-semibold text-amber-100">Facebook requiere tu intervención</p>
                            <p className="mt-1 text-[11px] leading-5 text-white/45">CLOUVA ya dejó listo título, precio, descripción y fotos. Abrí el destino, confirmá en Facebook y volvé para marcar el job.</p>
                            {payloadImages.length ? <div className="mt-2 flex gap-2 overflow-x-auto">{payloadImages.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0 overflow-hidden rounded-lg border border-white/10"><img src={url} alt="" className="h-12 w-12 object-cover" /></a>)}</div> : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button onClick={() => void prepareIntervention(job)} className={BUTTON}><Copy size={12} /> Copiar y abrir Facebook</button>
                              <button disabled={working} onClick={() => void confirmJob(job)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold"><Check size={13} /> Ya publiqué</button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!jobs.length ? <p className="py-6 text-center text-sm text-white/35">El lote todavía no tiene jobs visibles.</p> : null}
            </div>
          </section>
        ) : null}

        <section className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Productos canónicos</p><h2 className="mt-1 text-xl font-semibold">Qué querés publicar</h2></div>
            <button onClick={selectAll} className={BUTTON}>{allSelected ? <X size={13} /> : <Check size={13} />} {allSelected ? "Quitar todos" : "Seleccionar todos"}</button>
          </div>

          <div className="mt-3 space-y-3">
            {products.map((product) => {
              const enabledConfigs = (overview?.productDestinations ?? []).filter((config) => config.product_id === product.id && config.enabled && destinationById.get(config.destination_id)?.enabled);
              const marketplaceCount = enabledConfigs.filter((config) => destinationById.get(config.destination_id)?.type === "marketplace").length;
              const groupCount = enabledConfigs.filter((config) => destinationById.get(config.destination_id)?.type === "group").length;
              const pageCount = enabledConfigs.filter((config) => destinationById.get(config.destination_id)?.type === "page").length;
              const isSelected = selected.has(product.id);
              const expanded = editingProductId === product.id;
              return (
                <article key={product.id} className={CARD + (isSelected ? " border-violet-400/35 bg-violet-500/[0.045]" : "")}>
                  <button type="button" onClick={() => toggleProduct(product.id)} className="flex w-full items-center gap-3 p-4 text-left">
                    <span className={"grid h-6 w-6 shrink-0 place-items-center rounded-lg border " + (isSelected ? "border-violet-400 bg-violet-600" : "border-white/15 bg-black/20")}>{isSelected ? <Check size={14} /> : null}</span>
                    <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.04]">{product.cover_url ? <img src={product.cover_url} alt={product.name} className="h-full w-full object-cover" /> : <ImageIcon size={18} className="text-white/20" />}</span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">{product.name}</strong>
                      <span className="mt-1 block text-sm font-semibold text-violet-200">{money(product.price, product.currency)}</span>
                      <span className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-white/45">
                        <span className="rounded-lg border border-white/10 px-2 py-1">Marketplace {marketplaceCount ? "✓" : "—"}</span>
                        <span className="rounded-lg border border-white/10 px-2 py-1">Grupos {groupCount}</span>
                        {pageCount ? <span className="rounded-lg border border-white/10 px-2 py-1">Páginas {pageCount}</span> : null}
                      </span>
                    </span>
                  </button>
                  <div className="border-t border-white/[0.06] px-4 py-3">
                    <button type="button" onClick={() => setEditingProductId(expanded ? null : product.id)} className="inline-flex items-center gap-2 text-xs text-white/45 hover:text-white"><Settings2 size={13} /> Editar publicación {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
                  </div>
                  {expanded ? <ProductEditor
                    product={product}
                    destinations={overview?.destinations ?? []}
                    configs={overview?.productDestinations ?? []}
                    variants={(overview?.variants ?? []).filter((variant) => variant.product_id === product.id)}
                    working={working}
                    onDestination={(destination, changes) => void setDestination(product.id, destination, changes)}
                    variantDraft={variantDraft}
                    setVariantDraft={setVariantDraft}
                    onSaveVariant={() => void saveVariant(product.id)}
                  /> : null}
                </article>
              );
            })}
            {!products.length ? <div className={CARD + " p-8 text-center text-sm text-white/40"}>Todavía no hay productos en este Mi Spot. Cargalos con el flujo actual de productos y scanner; el Publicador no crea otro inventario.</div> : null}
          </div>
        </section>

        <section className={"mt-5 " + CARD + " p-5"}>
          <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.15em] text-white/30">Destinos reutilizables</p><h2 className="mt-1 text-lg font-semibold">Grupos de Facebook</h2></div><Plus size={16} className="text-violet-300" /></div>
          <p className="mt-2 text-xs leading-5 text-white/40">Los agregás una vez y después los activás por producto desde “Editar publicación”.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1.5fr_.6fr_auto]">
            <input className={INPUT} placeholder="Nombre del grupo" value={groupDraft.name} onChange={(event) => setGroupDraft((current) => ({ ...current, name: event.target.value }))} />
            <input className={INPUT} placeholder="https://facebook.com/groups/..." value={groupDraft.url} onChange={(event) => setGroupDraft((current) => ({ ...current, url: event.target.value }))} />
            <input className={INPUT} inputMode="numeric" placeholder="Cooldown min" value={groupDraft.cooldown} onChange={(event) => setGroupDraft((current) => ({ ...current, cooldown: event.target.value }))} />
            <button disabled={working || !groupDraft.name.trim() || !groupDraft.url.trim()} onClick={() => void saveGroup()} className={BUTTON}><Plus size={13} /> Agregar</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(overview?.destinations ?? []).filter((destination) => destination.type === "group").map((destination) => <span key={destination.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/65">{destination.name} · {destination.cooldown_minutes} min</span>)}
          </div>
        </section>
      </div>

      {selected.size ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#07060b]/95 px-4 py-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="min-w-0 flex-1"><p className="text-xs font-semibold">{selected.size} producto{selected.size === 1 ? "" : "s"}</p><p className="mt-0.5 truncate text-[10px] text-white/35">{summary.total} publicaciones preparadas</p></div>
            <button disabled={!summary.total} onClick={() => setConfirmOpen(true)} className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black tracking-wide disabled:opacity-40"><Send size={15} /> PUBLICAR TODO</button>
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-0 sm:place-items-center sm:p-4">
          <div className="w-full max-w-lg rounded-t-[28px] border border-white/10 bg-[#0c0912] p-5 sm:rounded-[28px]">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.15em] text-violet-300">Resumen del lote</p><h2 className="mt-1 text-2xl font-semibold">PUBLICAR TODO</h2></div><button onClick={() => setConfirmOpen(false)} className={BUTTON}><X size={14} /></button></div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Metric label="Productos" value={summary.products} />
              <Metric label="Marketplace" value={summary.marketplace} />
              <Metric label="Grupos" value={summary.groups} />
              <Metric label="Páginas" value={summary.pages} />
            </div>
            <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/20 p-4">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setScheduleMode("now")} className={BUTTON + (scheduleMode === "now" ? " border-violet-400/45 bg-violet-500/15 text-white" : "")}><Play size={13} /> PUBLICAR AHORA</button>
                <button onClick={() => setScheduleMode("schedule")} className={BUTTON + (scheduleMode === "schedule" ? " border-violet-400/45 bg-violet-500/15 text-white" : "")}><Clock3 size={13} /> PROGRAMAR</button>
              </div>
              {scheduleMode === "schedule" ? <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className={INPUT + " mt-3"} /> : null}
            </div>
            <p className="mt-4 text-xs leading-5 text-white/40">Marketplace y grupos quedarán en intervención asistida cuando Facebook exija la confirmación final. Las Páginas conectadas pueden publicarse mediante la API oficial.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button disabled={working} onClick={() => setConfirmOpen(false)} className={BUTTON}>CANCELAR</button>
              <button disabled={working || !summary.total || (scheduleMode === "schedule" && !scheduledAt)} onClick={() => void publishBatch()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-black disabled:opacity-40">{working ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} PUBLICAR</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ProductEditor({
  product,
  destinations,
  configs,
  variants,
  working,
  onDestination,
  variantDraft,
  setVariantDraft,
  onSaveVariant,
}: {
  product: Product;
  destinations: Destination[];
  configs: ProductDestination[];
  variants: PublicationVariant[];
  working: boolean;
  onDestination: (destination: Destination, changes: Partial<ProductDestination>) => void;
  variantDraft: { name: string; title: string; description: string; price: string; images: string };
  setVariantDraft: React.Dispatch<React.SetStateAction<{ name: string; title: string; description: string; price: string; images: string }>>;
  onSaveVariant: () => void;
}) {
  return (
    <div className="border-t border-white/[0.06] p-4">
      <p className="text-[10px] uppercase tracking-[.14em] text-white/30">Destinos</p>
      <div className="mt-2 space-y-2">
        {destinations.map((destination) => {
          const config = configs.find((item) => item.product_id === product.id && item.destination_id === destination.id);
          const enabled = Boolean(config?.enabled && destination.enabled);
          return (
            <div key={destination.id} className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
              <div className="flex items-center gap-3">
                <button disabled={working || !destination.enabled} onClick={() => onDestination(destination, { enabled: !enabled })} className={"grid h-6 w-6 shrink-0 place-items-center rounded-lg border " + (enabled ? "border-emerald-400/45 bg-emerald-500/15 text-emerald-200" : "border-white/15 text-white/20")}>{enabled ? <Check size={13} /> : null}</button>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{destination.name}</p><p className="mt-0.5 text-[9px] uppercase tracking-wider text-white/30">{destination.type} · cooldown {destination.cooldown_minutes} min</p></div>
                {destination.type === "page" ? <span className="rounded-lg border border-emerald-400/15 px-2 py-1 text-[9px] text-emerald-200">API</span> : <span className="rounded-lg border border-amber-400/15 px-2 py-1 text-[9px] text-amber-100">ASISTIDA</span>}
              </div>
              {enabled ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <select className={INPUT} value={config?.variant_id || ""} onChange={(event) => onDestination(destination, { variant_id: event.target.value || null })}>
                    <option value="">Producto base</option>
                    {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
                  </select>
                  <input className={INPUT} inputMode="numeric" placeholder="Frecuencia min (opcional)" value={config?.frequency_minutes ?? ""} onChange={(event) => onDestination(destination, { frequency_minutes: event.target.value ? Number(event.target.value) : null })} />
                  <textarea className={INPUT + " sm:col-span-2"} rows={2} placeholder="Texto personalizado opcional" defaultValue={config?.custom_text || ""} onBlur={(event) => onDestination(destination, { custom_text: event.target.value })} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-violet-400/15 bg-violet-500/[0.035] p-3">
        <p className="text-xs font-semibold">Nueva variante de anuncio</p>
        <p className="mt-1 text-[10px] text-white/35">No duplica el producto. Si no cargás imágenes nuevas, usa las fotos actuales de commerce_products.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className={INPUT} placeholder="Nombre de variante" value={variantDraft.name} onChange={(event) => setVariantDraft((current) => ({ ...current, name: event.target.value }))} />
          <input className={INPUT} placeholder="Título específico" value={variantDraft.title} onChange={(event) => setVariantDraft((current) => ({ ...current, title: event.target.value }))} />
          <input className={INPUT} inputMode="decimal" placeholder="Precio opcional" value={variantDraft.price} onChange={(event) => setVariantDraft((current) => ({ ...current, price: event.target.value }))} />
          <textarea className={INPUT} rows={2} placeholder="Descripción" value={variantDraft.description} onChange={(event) => setVariantDraft((current) => ({ ...current, description: event.target.value }))} />
          <textarea className={INPUT + " sm:col-span-2"} rows={2} placeholder="URLs de imágenes Facebook, una por línea (opcional)" value={variantDraft.images} onChange={(event) => setVariantDraft((current) => ({ ...current, images: event.target.value }))} />
          <button disabled={working || !variantDraft.name.trim()} onClick={onSaveVariant} className={BUTTON + " sm:col-span-2"}><Plus size={13} /> Guardar variante</button>
        </div>
        {variants.length ? <div className="mt-3 flex flex-wrap gap-2">{variants.map((variant) => <span key={variant.id} className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/55">{variant.name}</span>)}</div> : null}
      </div>
    </div>
  );
}

function JobIcon({ status }: { status: string }) {
  if (status === "published") return <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-300" />;
  if (status === "failed") return <XCircle size={17} className="mt-0.5 shrink-0 text-rose-300" />;
  if (status === "waiting_confirmation") return <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-300" />;
  if (status === "skipped") return <Square size={15} className="mt-0.5 shrink-0 text-white/25" />;
  return <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-violet-300" />;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.12em] text-white/30">{label}</p><strong className="mt-1 block text-xl">{value}</strong></div>;
}
