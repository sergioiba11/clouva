"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { IdentityConfigPanel, type IdentityLayoutConfig } from "@/components/identity/IdentityConfigPanel";

// Studio counterpart of components/profile/VipAiProfilePanel.tsx -- same
// pipeline, same job/version tables, just pointed at studioId instead of
// playerId.

type ProfileCopy = {
  tagline: string | null;
  short_bio: string | null;
  seo_title: string | null;
  seo_description: string | null;
  share_title: string | null;
  share_description: string | null;
  visual_energy: string | null;
  visual_tone: string | null;
  palette: string[] | null;
};

type GeneratedAsset = { kind: string; url: string };

type LayoutSectionSummary = { type: string };
type LayoutVariant = { layout: { sections?: LayoutSectionSummary[] } | null; assets: GeneratedAsset[] };

type Job = {
  id: string;
  status: string;
  generated_copy: ProfileCopy | null;
  generated_assets: GeneratedAsset[] | null;
  layout_variants: LayoutVariant[] | null;
  error_message: string | null;
  actual_cost_usd: number | null;
} | null;

type Version = {
  id: string;
  version_number: number;
  status: "draft" | "review" | "published" | "archived";
  profile_level: "basic" | "vip";
  copy_config: ProfileCopy;
  layout_config: IdentityLayoutConfig | null;
  asset_references: GeneratedAsset[];
  brand_asset_version_id: string | null;
  published_at: string | null;
};

type InstagramConnection = {
  id: string;
  external_username: string | null;
  display_name: string | null;
  status: string;
} | null;

const IN_PROGRESS_STATUSES = new Set([
  "queued", "preparing_identity", "analyzing_identity", "generating_copy", "classifying_reference",
  "generating_assets", "generating_variants", "generating_variant_assets", "assembling_profile",
]);

const STATUS_LABEL: Record<string, string> = {
  queued: "En cola...",
  preparing_identity: "Preparando la identidad...",
  analyzing_identity: "Analizando el perfil del Estudio...",
  generating_copy: "Escribiendo la presentación...",
  classifying_reference: "Analizando tus imágenes de referencia...",
  generating_assets: "Creando logo y portada...",
  generating_variants: "Armando 3 propuestas de diseño...",
  generating_variant_assets: "Creando portada y logo para cada propuesta...",
  assembling_profile: "Armando el perfil...",
  review_ready: "Listo para revisar.",
  failed: "Algo falló en la generación.",
  blocked_budget: "El presupuesto compartido de Gemini no está disponible ahora mismo.",
  needs_user_input: "Necesitamos más información del Estudio para continuar.",
  cancelled: "Generación cancelada.",
};

const SECTION_LABEL: Record<string, string> = {
  hero: "Portada", about: "Sobre", pillars: "Pilares", gallery: "Galería", roster: "Players",
  services: "Servicios", membership: "Membresías", music: "Música", contact: "Contacto",
};

const MAX_REFERENCE_IMAGES = 3;

const EDITABLE_FIELDS: Array<{ key: keyof ProfileCopy; label: string; multiline?: boolean }> = [
  { key: "tagline", label: "Frase institucional" },
  { key: "short_bio", label: "Presentación", multiline: true },
  { key: "seo_title", label: "Título SEO" },
  { key: "seo_description", label: "Descripción SEO", multiline: true },
  { key: "share_title", label: "Título al compartir" },
  { key: "share_description", label: "Descripción al compartir", multiline: true },
];

export function StudioAiProfilePanel({ studioId }: { studioId: string }) {
  const [job, setJob] = useState<Job>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<Partial<ProfileCopy>>({});
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [uploadingReference, setUploadingReference] = useState(false);
  const [instagramConnection, setInstagramConnection] = useState<InstagramConnection>(null);
  const [instagramLoaded, setInstagramLoaded] = useState(false);
  const [connectingInstagram, setConnectingInstagram] = useState(false);
  const [wantsRealPhotos, setWantsRealPhotos] = useState(false);
  const [selectingVariant, setSelectingVariant] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = async () => {
    try {
      const response = await authenticatedFetch(`/api/vip-profile/status?studioId=${encodeURIComponent(studioId)}`);
      const payload = await readApiJson<{ job: Job; versions: Version[] }>(response);
      setJob(payload.job);
      setVersions(payload.versions);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la identidad del Estudio.");
    } finally {
      setLoading(false);
    }
  };

  const loadInstagram = async () => {
    try {
      const response = await authenticatedFetch(`/api/integrations/instagram/status?studioId=${encodeURIComponent(studioId)}`);
      const payload = await readApiJson<{ connection: InstagramConnection }>(response);
      setInstagramConnection(payload.connection);
    } catch {
      setInstagramConnection(null);
    } finally {
      setInstagramLoaded(true);
    }
  };

  const connectInstagram = async () => {
    setConnectingInstagram(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/integrations/instagram/connect", {
        method: "POST",
        body: JSON.stringify({ studioId }),
      });
      const payload = await readApiJson<{ authorizeUrl: string }>(response);
      window.location.assign(payload.authorizeUrl);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "No se pudo abrir Instagram.");
      setConnectingInstagram(false);
    }
  };

  const disconnectInstagram = async () => {
    setConnectingInstagram(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/integrations/instagram/disconnect?studioId=${encodeURIComponent(studioId)}`, { method: "DELETE" });
      await readApiJson(response);
      await loadInstagram();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "No se pudo desconectar Instagram.");
    } finally {
      setConnectingInstagram(false);
    }
  };

  useEffect(() => {
    void load();
    void loadInstagram();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [studioId]);

  useEffect(() => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (job && IN_PROGRESS_STATUSES.has(job.status)) {
      pollRef.current = window.setInterval(() => { void load(); }, 4000);
    }
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [job?.status]);

  const draftVersion = versions.find((v) => v.status === "draft");
  const publishedVersion = versions.find((v) => v.status === "published");

  const startGeneration = async () => {
    setStarting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/vip-profile/generate", {
        method: "POST",
        body: JSON.stringify({ studioId, referenceImageUrls }),
      });
      await readApiJson(response);
      setReferenceImageUrls([]);
      await load();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "No se pudo iniciar la generación.");
    } finally {
      setStarting(false);
    }
  };

  const uploadReferenceImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_REFERENCE_IMAGES - referenceImageUrls.length;
    if (remaining <= 0) return;
    setUploadingReference(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("studioId", studioId);
      Array.from(files).slice(0, remaining).forEach((file) => form.append("images", file));
      const response = await authenticatedFetch("/api/vip-profile/reference-images", { method: "POST", body: form });
      const payload = await readApiJson<{ urls: string[] }>(response);
      setReferenceImageUrls((current) => [...current, ...payload.urls].slice(0, MAX_REFERENCE_IMAGES));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No se pudo subir la imagen.");
    } finally {
      setUploadingReference(false);
    }
  };

  const selectVariant = async (index: number) => {
    if (!job) return;
    setSelectingVariant(index);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/vip-profile/jobs/${job.id}/select-variant`, {
        method: "POST",
        body: JSON.stringify({ variantIndex: index }),
      });
      await readApiJson(response);
      setMessage("Diseño elegido. Revisalo abajo antes de publicar.");
      await load();
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "No se pudo elegir esa propuesta.");
    } finally {
      setSelectingVariant(null);
    }
  };

  const saveEdits = async () => {
    if (!draftVersion || Object.keys(draftEdits).length === 0) return;
    setStarting(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/vip-profile/versions/${draftVersion.id}`, {
        method: "PATCH",
        body: JSON.stringify(draftEdits),
      });
      await readApiJson(response);
      setDraftEdits({});
      setMessage("Cambios guardados.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudieron guardar los cambios.");
    } finally {
      setStarting(false);
    }
  };

  const publish = async () => {
    if (!draftVersion) return;
    let publishLogoToo = false;
    if (draftVersion.brand_asset_version_id) {
      publishLogoToo = window.confirm(
        "Esta página incluye una nueva identidad visual.\n¿Querés publicar también este logo como identidad oficial?",
      );
    }
    if (Object.keys(draftEdits).length > 0) await saveEdits();
    setStarting(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/vip-profile/versions/${draftVersion.id}/publish`, {
        method: "POST",
        body: JSON.stringify({ publishLogoToo }),
      });
      await readApiJson(response);
      setMessage("Identidad del Estudio publicada.");
      await load();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "No se pudo publicar.");
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />;

  const cover = draftVersion?.asset_references.find((a) => a.kind === "cover")
    ?? job?.generated_assets?.find((a) => a.kind === "cover");
  const logo = draftVersion?.asset_references.find((a) => a.kind === "logo")
    ?? job?.generated_assets?.find((a) => a.kind === "logo");
  const copy = draftVersion?.copy_config ?? job?.generated_copy;
  const palette = copy?.palette ?? [];
  const instagramConnected = Boolean(instagramConnection);
  const showReferenceUpload = instagramLoaded && (instagramConnected || wantsRealPhotos);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl border border-violet-400/25 bg-violet-500/10 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-300/70">Identidad del Estudio con CLOUVA AI</p>
          <p className="mt-1 text-sm text-white/60">{publishedVersion ? `Versión publicada (v${publishedVersion.version_number}).` : "Todavía no creaste la identidad profesional del Estudio."}</p>
        </div>
        {!job || !IN_PROGRESS_STATUSES.has(job.status) ? (
          <button disabled={starting} onClick={() => void startGeneration()} className="shrink-0 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-60">
            {publishedVersion ? "Crear nueva versión" : "Crear identidad del Estudio"}
          </button>
        ) : null}
      </div>

      {!job || !IN_PROGRESS_STATUSES.has(job.status) ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-white/40">Instagram del Estudio</p>
          {!instagramLoaded ? (
            <p className="mt-1 text-xs text-white/45">Cargando...</p>
          ) : instagramConnected ? (
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-sm text-white/70">Conectado como <span className="font-semibold">@{instagramConnection?.external_username || instagramConnection?.display_name}</span></p>
              <button disabled={connectingInstagram} onClick={() => void disconnectInstagram()} className="shrink-0 rounded-xl border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40">Desconectar</button>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-white/45">Conectá el Instagram propio del Estudio (no el personal del dueño) para que la IA use su bio y fotos al generar las variantes de diseño.</p>
              <button disabled={connectingInstagram} onClick={() => void connectInstagram()} className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-200 disabled:opacity-40">Conectar Instagram del Estudio</button>
              <label className="flex items-center gap-2 pt-1 text-xs text-white/55">
                <input type="checkbox" checked={wantsRealPhotos} onChange={(event) => setWantsRealPhotos(event.target.checked)} className="h-3.5 w-3.5 rounded border-white/20 bg-black/30" />
                No tengo Instagram del Estudio, pero tengo fotos reales para subir
              </label>
            </div>
          )}
        </div>
      ) : null}

      {!job || !IN_PROGRESS_STATUSES.has(job.status) ? (
        showReferenceUpload ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-white/40">{instagramConnected ? "Imagen de inspiración (opcional)" : "Fotos reales de tu estudio"}</p>
            <p className="mt-1 text-xs text-white/45">{instagramConnected ? "Además de los datos del Estudio, la IA puede usar una referencia visual para el logo y la portada." : "Subí fotos reales de tu estudio (o un mockup de web si ya tenés un diseño en mente) para que la IA las use como base."}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {referenceImageUrls.map((url) => (
                <div key={url} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10">
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setReferenceImageUrls((current) => current.filter((item) => item !== url))} className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-[10px] leading-none text-white">×</button>
                </div>
              ))}
              {referenceImageUrls.length < MAX_REFERENCE_IMAGES ? (
                <label className="grid h-16 w-16 shrink-0 cursor-pointer place-items-center rounded-xl border border-white/15 text-xs text-white/45 hover:border-violet-400/50">
                  {uploadingReference ? "..." : "+ Subir"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" disabled={uploadingReference} onChange={(event) => void uploadReferenceImages(event.target.files)} />
                </label>
              ) : null}
            </div>
          </div>
        ) : null
      ) : null}

      {job && IN_PROGRESS_STATUSES.has(job.status) ? (
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-5">
          <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
          <p className="text-sm text-white/70">{STATUS_LABEL[job.status] ?? job.status}</p>
        </div>
      ) : null}

      {job && job.status === "awaiting_variant_selection" && job.layout_variants?.length ? (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">Elegí una propuesta de diseño</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {job.layout_variants.map((variant, index) => {
              const variantCover = variant.assets.find((a) => a.kind === "cover");
              const sections = variant.layout?.sections ?? [];
              return (
                <div key={index} className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                  {variantCover ? <img src={variantCover.url} alt="" className="h-32 w-full object-cover" /> : <div className="h-32 w-full bg-white/5" />}
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <p className="text-xs text-white/50">{sections.map((s) => SECTION_LABEL[s.type] ?? s.type).join(" · ")}</p>
                    <button disabled={selectingVariant !== null} onClick={() => void selectVariant(index)} className="mt-auto rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold disabled:opacity-60">
                      {selectingVariant === index ? "Eligiendo..." : "Usar esta"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {job && (job.status === "failed" || job.status === "blocked_budget" || job.status === "needs_user_input") ? (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-200">{STATUS_LABEL[job.status]}{job.error_message ? ` — ${job.error_message}` : ""}</p>
      ) : null}

      {draftVersion && copy ? (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.2em] text-white/40">Revisá y editá (v{draftVersion.version_number}, borrador)</p>
            <Link href={`/studio-dashboard/${studioId}/identity-preview`} className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/20">
              Abrir Actual / Propuesta
            </Link>
          </div>
          {cover ? <img src={cover.url} alt="" className="h-40 w-full rounded-xl object-cover" /> : null}
          {logo || palette.length > 0 ? (
            <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-black/20 p-4">
              {logo ? <img src={logo.url} alt="" className="h-16 w-16 shrink-0 rounded-lg bg-black/30 object-contain" /> : null}
              {palette.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs uppercase tracking-[0.16em] text-white/40">Paleta sugerida</p>
                  <div className="flex gap-2">{palette.map((hex) => <span key={hex} title={hex} className="h-7 w-7 rounded-full border border-white/20" style={{ backgroundColor: hex }} />)}</div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {EDITABLE_FIELDS.map(({ key, label, multiline }) => {
              const value = String((draftEdits[key] ?? copy[key]) ?? "");
              const onChange = (next: string) => setDraftEdits((current) => ({ ...current, [key]: next }));
              return (
                <div key={key} className={multiline ? "sm:col-span-2" : ""}>
                  <label className="mb-1.5 block text-xs uppercase tracking-[0.16em] text-white/40">{label}</label>
                  {multiline ? (
                    <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60" />
                  ) : (
                    <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60" />
                  )}
                </div>
              );
            })}
          </div>
          {draftVersion.layout_config ? (
            <IdentityConfigPanel versionId={draftVersion.id} kind="studio" layoutConfig={draftVersion.layout_config} onSaved={load} />
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <button disabled={starting || Object.keys(draftEdits).length === 0} onClick={() => void saveEdits()} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm disabled:opacity-40">Guardar cambios</button>
            <button disabled={starting} onClick={() => void publish()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-60">Publicar identidad del Estudio</button>
          </div>
        </div>
      ) : null}

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      {message ? <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{message}</p> : null}
    </div>
  );
}
