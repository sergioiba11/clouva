"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { IdentityConfigPanel, type IdentityLayoutConfig } from "@/components/identity/IdentityConfigPanel";

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

type StatusPayload = {
  job: Job;
  versions: Version[];
  publishedVersion?: Version | null;
  draftVersion?: Version | null;
  staleDrafts?: Version[];
};

type InstagramConnection = {
  id: string;
  external_username: string | null;
  display_name: string | null;
  status: string;
} | null;

export type StudioIdentityState = {
  publishedVersionNumber: number | null;
  draftVersionNumber: number | null;
  staleDraftCount: number;
  hasUnsavedDraftEdits: boolean;
  jobStatus: string | null;
  canPublish: boolean;
};

const IN_PROGRESS_STATUSES = new Set([
  "queued", "preparing_identity", "analyzing_identity", "generating_copy", "classifying_reference",
  "generating_assets", "generating_variants", "generating_variant_assets", "assembling_profile",
]);

const STATUS_LABEL: Record<string, string> = {
  queued: "En cola…",
  preparing_identity: "Preparando la identidad…",
  analyzing_identity: "Analizando el Studio…",
  generating_copy: "Escribiendo la presentación…",
  classifying_reference: "Analizando la referencia visual…",
  generating_assets: "Creando assets…",
  generating_variants: "Armando propuestas de diseño…",
  generating_variant_assets: "Preparando assets de las propuestas…",
  assembling_profile: "Armando la identidad…",
  review_ready: "Listo para revisar.",
  failed: "La generación falló.",
  blocked_budget: "El presupuesto compartido de Gemini no está disponible ahora mismo.",
  needs_user_input: "Necesitamos más información del Studio para continuar.",
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

export function StudioAiProfilePanel({
  studioId,
  onStateChange,
}: {
  studioId: string;
  onStateChange?: (state: StudioIdentityState) => void;
}) {
  const [job, setJob] = useState<Job>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [draftVersion, setDraftVersion] = useState<Version | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<Version | null>(null);
  const [staleDrafts, setStaleDrafts] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<Partial<ProfileCopy>>({});
  const [designReferenceUrls, setDesignReferenceUrls] = useState<string[]>([]);
  const [realPhotoUrls, setRealPhotoUrls] = useState<string[]>([]);
  const [uploadingReference, setUploadingReference] = useState<"design" | "photos" | null>(null);
  const [instagramConnection, setInstagramConnection] = useState<InstagramConnection>(null);
  const [instagramLoaded, setInstagramLoaded] = useState(false);
  const [connectingInstagram, setConnectingInstagram] = useState(false);
  const [selectingVariant, setSelectingVariant] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = async () => {
    try {
      const response = await authenticatedFetch(`/api/vip-profile/status?studioId=${encodeURIComponent(studioId)}`);
      const payload = await readApiJson<StatusPayload>(response);
      const fallbackPublished = payload.versions.find((version) => version.status === "published") ?? null;
      const published = payload.publishedVersion ?? fallbackPublished;
      const publishedNumber = published?.version_number ?? 0;
      const fallbackDrafts = payload.versions.filter((version) => version.status === "draft");
      const activeDraft = payload.draftVersion ?? fallbackDrafts.find((version) => version.version_number > publishedNumber) ?? null;
      const stale = payload.staleDrafts ?? fallbackDrafts.filter((version) => version.version_number <= publishedNumber);
      setJob(payload.job);
      setVersions(payload.versions);
      setPublishedVersion(published);
      setDraftVersion(activeDraft);
      setStaleDrafts(stale);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la identidad del Studio.");
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

  useEffect(() => {
    onStateChange?.({
      publishedVersionNumber: publishedVersion?.version_number ?? null,
      draftVersionNumber: draftVersion?.version_number ?? null,
      staleDraftCount: staleDrafts.length,
      hasUnsavedDraftEdits: Object.keys(draftEdits).length > 0,
      jobStatus: job?.status ?? null,
      canPublish: Boolean(draftVersion) && !starting,
    });
  }, [draftEdits, draftVersion, job?.status, onStateChange, publishedVersion, staleDrafts.length, starting]);

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

  const combinedReferenceUrls = [...designReferenceUrls, ...realPhotoUrls].slice(0, MAX_REFERENCE_IMAGES);

  const startGeneration = async () => {
    setStarting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/vip-profile/generate", {
        method: "POST",
        body: JSON.stringify({ studioId, referenceImageUrls: combinedReferenceUrls }),
      });
      await readApiJson(response);
      setDesignReferenceUrls([]);
      setRealPhotoUrls([]);
      await load();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "No se pudo iniciar la generación.");
    } finally {
      setStarting(false);
    }
  };

  const uploadReferenceImages = async (files: FileList | null, target: "design" | "photos") => {
    if (!files || files.length === 0) return;
    const remaining = MAX_REFERENCE_IMAGES - combinedReferenceUrls.length;
    if (remaining <= 0) return;
    setUploadingReference(target);
    setError(null);
    try {
      const form = new FormData();
      form.append("studioId", studioId);
      Array.from(files).slice(0, remaining).forEach((file) => form.append("images", file));
      const response = await authenticatedFetch("/api/vip-profile/reference-images", { method: "POST", body: form });
      const payload = await readApiJson<{ urls: string[] }>(response);
      if (target === "design") {
        setDesignReferenceUrls((current) => [...current, ...payload.urls].slice(0, MAX_REFERENCE_IMAGES));
      } else {
        setRealPhotoUrls((current) => [...current, ...payload.urls].slice(0, MAX_REFERENCE_IMAGES));
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No se pudo subir la imagen.");
    } finally {
      setUploadingReference(null);
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
      setMessage("Diseño elegido. Revisalo en el preview antes de publicar.");
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
      setMessage(`Borrador v${draftVersion.version_number} guardado.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el borrador.");
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
      setMessage(`Identidad v${draftVersion.version_number} publicada.`);
      await load();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "No se pudo publicar.");
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />;

  const cover = draftVersion?.asset_references.find((asset) => asset.kind === "cover")
    ?? job?.generated_assets?.find((asset) => asset.kind === "cover");
  const logo = draftVersion?.asset_references.find((asset) => asset.kind === "logo")
    ?? job?.generated_assets?.find((asset) => asset.kind === "logo");
  const copy = draftVersion?.copy_config ?? job?.generated_copy;
  const palette = copy?.palette ?? [];
  const generationInProgress = Boolean(job && IN_PROGRESS_STATUSES.has(job.status));

  return (
    <div className="space-y-5" data-clouva-component="StudioAiProfilePanel">
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0b0913] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <VersionBadge label="PUBLICADO" value={publishedVersion ? `v${publishedVersion.version_number}` : "—"} tone="green" />
          <VersionBadge label="BORRADOR" value={draftVersion ? `v${draftVersion.version_number}` : "SIN BORRADOR"} tone={draftVersion ? "violet" : "neutral"} />
          {staleDrafts.length ? <span className="text-xs text-amber-200/65">{staleDrafts.length} borrador histórico ignorado</span> : null}
        </div>
        {!generationInProgress ? (
          <button disabled={starting} onClick={() => void startGeneration()} className="shrink-0 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold transition hover:bg-violet-500 disabled:opacity-50">
            {publishedVersion ? "Crear nueva versión" : "Crear identidad"}
          </button>
        ) : null}
      </div>

      {!generationInProgress ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Fuentes del Studio</p>
            <h3 className="mt-1 text-sm font-semibold">Datos y fotos reales</h3>
            {!instagramLoaded ? (
              <p className="mt-3 text-xs text-white/45">Cargando Instagram…</p>
            ) : instagramConnection ? (
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm text-white/65">Instagram · <strong>@{instagramConnection.external_username || instagramConnection.display_name}</strong></p>
                <button disabled={connectingInstagram} onClick={() => void disconnectInstagram()} className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs">Desconectar</button>
              </div>
            ) : (
              <button disabled={connectingInstagram} onClick={() => void connectInstagram()} className="mt-3 rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-100">Conectar Instagram</button>
            )}
            <div className="mt-4 border-t border-white/8 pt-4">
              <p className="text-xs leading-5 text-white/45">También podés sumar fotos reales del espacio. Se usan como fuente del Studio, no como una página a copiar.</p>
              <ImageTray urls={realPhotoUrls} onRemove={(url) => setRealPhotoUrls((current) => current.filter((item) => item !== url))}>
                {combinedReferenceUrls.length < MAX_REFERENCE_IMAGES ? (
                  <UploadTile label={uploadingReference === "photos" ? "…" : "+ Fotos"} disabled={Boolean(uploadingReference)} onFiles={(files) => void uploadReferenceImages(files, "photos")} />
                ) : null}
              </ImageTray>
            </div>
          </section>

          <section className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.045] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/55">Referencia visual</p>
            <h3 className="mt-1 text-sm font-semibold">Screenshot / mockup / web</h3>
            <p className="mt-2 text-xs leading-5 text-white/50">CLOUVA usa esta imagen como referencia de composición. Los textos, Players, música y datos siguen siendo los reales del Studio.</p>
            <ImageTray urls={designReferenceUrls} onRemove={(url) => setDesignReferenceUrls((current) => current.filter((item) => item !== url))}>
              {combinedReferenceUrls.length < MAX_REFERENCE_IMAGES ? (
                <UploadTile label={uploadingReference === "design" ? "…" : "+ Screenshot"} disabled={Boolean(uploadingReference)} onFiles={(files) => void uploadReferenceImages(files, "design")} />
              ) : null}
            </ImageTray>
            <p className="mt-3 text-[11px] text-white/35">Máximo {MAX_REFERENCE_IMAGES} imágenes entre fotos y referencias.</p>
          </section>
        </div>
      ) : null}

      {generationInProgress ? (
        <div className="flex items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-5">
          <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
          <div><p className="text-sm font-semibold text-white/80">Generando nueva versión</p><p className="mt-1 text-xs text-white/50">{STATUS_LABEL[job?.status ?? ""] ?? job?.status}</p></div>
        </div>
      ) : null}

      {job && job.status === "awaiting_variant_selection" && job.layout_variants?.length ? (
        <section className="space-y-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/50">Propuestas</p><h3 className="mt-1 text-lg font-semibold">Elegí una composición</h3></div>
          <div className="grid gap-4 sm:grid-cols-3">
            {job.layout_variants.map((variant, index) => {
              const variantCover = variant.assets.find((asset) => asset.kind === "cover");
              const sections = variant.layout?.sections ?? [];
              return (
                <div key={index} className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                  {variantCover ? <img src={variantCover.url} alt="" className="h-32 w-full object-cover" /> : <div className="h-32 w-full bg-white/5" />}
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <p className="text-xs text-white/50">{sections.map((section) => SECTION_LABEL[section.type] ?? section.type).join(" · ")}</p>
                    <button disabled={selectingVariant !== null} onClick={() => void selectVariant(index)} className="mt-auto rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold disabled:opacity-60">
                      {selectingVariant === index ? "Eligiendo…" : "Usar esta"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {job && (job.status === "failed" || job.status === "blocked_budget" || job.status === "needs_user_input") ? (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-200">{STATUS_LABEL[job.status]}{job.error_message ? ` — ${job.error_message}` : ""}</p>
      ) : null}

      {draftVersion && copy ? (
        <section className="space-y-5 rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/50">Borrador activo · v{draftVersion.version_number}</p><h3 className="mt-1 text-lg font-semibold">Revisá y corregí</h3></div>
            <Link href={`/studio-dashboard/${studioId}/identity-preview`} target="_blank" className="rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-100">Actual / Propuesta</Link>
          </div>

          {cover ? <img src={cover.url} alt="" className="h-44 w-full rounded-xl object-cover" /> : null}
          {logo || palette.length > 0 ? (
            <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-black/20 p-4">
              {logo ? <img src={logo.url} alt="" className="h-16 w-16 shrink-0 rounded-lg bg-black/30 object-contain" /> : null}
              {palette.length > 0 ? <div><p className="mb-1.5 text-xs uppercase tracking-[0.16em] text-white/40">Paleta</p><div className="flex gap-2">{palette.map((hex) => <span key={hex} title={hex} className="h-7 w-7 rounded-full border border-white/20" style={{ backgroundColor: hex }} />)}</div></div> : null}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {EDITABLE_FIELDS.map(({ key, label, multiline }) => {
              const value = String((draftEdits[key] ?? copy[key]) ?? "");
              const onChange = (next: string) => setDraftEdits((current) => ({ ...current, [key]: next }));
              return (
                <div key={key} className={multiline ? "sm:col-span-2" : ""}>
                  <label className="mb-1.5 block text-xs font-medium text-white/55">{label}</label>
                  {multiline ? (
                    <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none focus:border-violet-400/60" />
                  ) : (
                    <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none focus:border-violet-400/60" />
                  )}
                </div>
              );
            })}
          </div>

          {draftVersion.layout_config ? <IdentityConfigPanel versionId={draftVersion.id} kind="studio" layoutConfig={draftVersion.layout_config} onSaved={load} /> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-white/8 pt-4">
            <button disabled={starting || Object.keys(draftEdits).length === 0} onClick={() => void saveEdits()} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold disabled:opacity-35">Guardar borrador</button>
            <button disabled={starting} onClick={() => void publish()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Publicar v{draftVersion.version_number}</button>
            {Object.keys(draftEdits).length > 0 ? <span className="text-xs text-amber-200/65">Cambios de texto sin guardar</span> : <span className="text-xs text-emerald-200/55">Borrador guardado</span>}
          </div>
        </section>
      ) : null}

      {!draftVersion && publishedVersion && !generationInProgress ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 text-sm text-white/50">No hay una propuesta activa. Creá una nueva versión o pedísela a Gemini para trabajar sobre algo posterior a v{publishedVersion.version_number}.</div>
      ) : null}

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      {message ? <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{message}</p> : null}
      <span className="hidden">{versions.length}</span>
    </div>
  );
}

function VersionBadge({ label, value, tone }: { label: string; value: string; tone: "green" | "violet" | "neutral" }) {
  const style = tone === "green" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100" : tone === "violet" ? "border-violet-400/25 bg-violet-500/10 text-violet-100" : "border-white/10 bg-white/[0.035] text-white/50";
  return <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold tracking-[0.12em] ${style}`}><span>{label}</span><strong>{value}</strong></span>;
}

function ImageTray({ urls, onRemove, children }: { urls: string[]; onRemove: (url: string) => void; children: React.ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2">{urls.map((url) => <div key={url} className="relative h-16 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10"><img src={url} alt="" className="h-full w-full object-cover" /><button type="button" onClick={() => onRemove(url)} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/75 text-xs text-white">×</button></div>)}{children}</div>;
}

function UploadTile({ label, disabled, onFiles }: { label: string; disabled: boolean; onFiles: (files: FileList | null) => void }) {
  return <label className={`grid h-16 min-w-20 shrink-0 place-items-center rounded-xl border border-dashed border-white/15 px-3 text-xs text-white/50 transition hover:border-violet-400/40 ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}>{label}<input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" disabled={disabled} onChange={(event) => onFiles(event.target.files)} /></label>;
}
