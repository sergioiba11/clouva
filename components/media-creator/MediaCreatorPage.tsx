"use client";
/* eslint-disable @next/next/no-img-element -- URLs de medios generados y avatares son dinámicas y externas. */

import Link from "next/link";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  FolderKanban,
  Heart,
  Home,
  ImageIcon,
  Images,
  LayoutTemplate,
  Library,
  LoaderCircle,
  Menu,
  Mic,
  Palette,
  Play,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CloverIcon } from "@/components/clover-icon";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import {
  estimateVideoCostUsd,
  formatAspectRatio,
  IMAGE_ASPECT_RATIOS,
  IMAGE_QUALITY_CONFIG,
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS,
  VIDEO_QUALITY_CONFIG,
  type ImageAspectRatio,
  type ImageQuality,
  type VideoAspectRatio,
  type VideoDuration,
  type VideoQuality,
} from "@/lib/media-generation-config";
import { RecentCreations } from "./RecentCreations";
import { ReferenceUploader } from "./ReferenceUploader";
import type { MediaJob, MediaType, ModelAvailability, ReferenceAsset } from "./types";
import styles from "./media-creator.module.css";

const activeStatuses = new Set(["queued", "generating", "processing", "saving"]);
const promptIdeas = [
  "Una campaña editorial nocturna en Buenos Aires, luz violeta y textura cinematográfica",
  "Un producto premium flotando sobre vidrio negro con reflejos suaves y fondo minimalista",
  "Un paisaje surrealista patagónico bajo dos lunas, detalle fotográfico y niebla azul",
];

const navSections = [
  [
    { label: "Inicio", href: "/", icon: Home },
    { label: "CLOUVA AI", href: "/clouva-ai", icon: Sparkles },
    { label: "Proyectos", href: "/studios", icon: FolderKanban },
    { label: "Biblioteca", href: "/biblioteca", icon: Library },
    { label: "Plantillas", href: "/creator-studio", icon: LayoutTemplate },
  ],
  [
    { label: "Herramientas", href: "/clouva-ai", icon: WandSparkles },
    { label: "Brand Kit", href: "/logo", icon: Palette },
  ],
  [
    { label: "Actividad", href: "/perfil", icon: Clock3 },
    { label: "Favoritos", href: "/biblioteca", icon: Heart },
  ],
] as const;

function profileInitials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "C";
}

function statusCopy(job: MediaJob | null, submitting: boolean) {
  if (submitting && !job) return "Preparando la generación…";
  if (!job) return null;
  if (job.status === "generating") return job.type === "video" ? "Gemini está iniciando el video…" : "Gemini está creando la imagen…";
  if (job.status === "processing") return "Veo está procesando el video…";
  if (job.status === "saving") return "Guardando el resultado en CLOUVA…";
  if (job.status === "storage_failed") return "La generación terminó, pero falta guardar el archivo.";
  if (job.status === "failed") return job.error || "La generación no pudo completarse.";
  return null;
}

function SelectChevron() {
  return <ChevronDown size={15} aria-hidden="true" />;
}

export function MediaCreatorPage() {
  const { user, profile, role, loading } = useAuth();
  const [mode, setMode] = useState<MediaType>("image");
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState<ReferenceAsset | null>(null);
  const [imageAspect, setImageAspect] = useState<ImageAspectRatio>("16:9");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("high");
  const [videoAspect, setVideoAspect] = useState<VideoAspectRatio>("16:9");
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("fast");
  const [duration, setDuration] = useState<VideoDuration>(8);
  const [models, setModels] = useState<ModelAvailability | null>(null);
  const [modelWarning, setModelWarning] = useState<string | null>(null);
  const [history, setHistory] = useState<MediaJob[]>([]);
  const [filter, setFilter] = useState<"all" | MediaType>("all");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [currentJob, setCurrentJob] = useState<MediaJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmVideo, setConfirmVideo] = useState(false);
  const [detailJob, setDetailJob] = useState<MediaJob | null>(null);
  const [deleteJob, setDeleteJob] = useState<MediaJob | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);

  const displayName = profile?.display_name || profile?.full_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "CLOUVA";
  const avatar = profile?.avatar_url || user?.user_metadata?.avatar_url;
  const videoCost = estimateVideoCostUsd(videoQuality, duration);
  const selectedAspect = mode === "image" ? imageAspect : videoAspect;
  const selectedQuality = mode === "image" ? imageQuality : videoQuality;
  const busy = submitting || Boolean(currentJob && activeStatuses.has(currentJob.status));
  const progressCopy = statusCopy(currentJob, submitting);
  const activeVideoIdsKey = useMemo(() => {
    const ids = history
      .filter((job) => job.type === "video" && activeStatuses.has(job.status))
      .map((job) => job.id);
    if (currentJob?.type === "video" && activeStatuses.has(currentJob.status) && !ids.includes(currentJob.id)) ids.push(currentJob.id);
    return ids.sort().join(",");
  }, [currentJob, history]);

  const updateJob = useCallback((job: MediaJob) => {
    setHistory((items) => {
      const without = items.filter((item) => item.id !== job.id);
      return [job, ...without].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    });
    setCurrentJob((current) => current?.id === job.id || !current ? job : current);
    setDetailJob((current) => current?.id === job.id ? job : current);
  }, []);

  const loadHistory = useCallback(async (cursor?: string | null) => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ limit: "16" });
      if (filter !== "all") params.set("type", filter);
      if (cursor) params.set("cursor", cursor);
      const response = await authenticatedFetch(`/api/media/history?${params.toString()}`);
      const payload = await readApiJson<{ items: MediaJob[]; nextCursor: string | null }>(response);
      setHistory((items) => cursor ? [...items, ...payload.items.filter((item) => !items.some((known) => known.id === item.id))] : payload.items);
      setNextCursor(payload.nextCursor);
      if (!cursor) {
        const active = payload.items.find((job) => activeStatuses.has(job.status));
        if (active) setCurrentJob(active);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el historial.");
    } finally {
      setHistoryLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!user || role !== "admin") return;
    void loadHistory(null);
  }, [user, role, loadHistory]);

  useEffect(() => {
    if (!user || role !== "admin") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/media/models");
        const payload = await readApiJson<ModelAvailability>(response);
        if (!cancelled) setModels(payload);
      } catch {
        if (!cancelled) setModelWarning("No pudimos verificar la disponibilidad de los modelos. La API validará la selección al generar.");
      }
    })();
    return () => { cancelled = true; };
  }, [user, role]);

  useEffect(() => {
    const activeIds = activeVideoIdsKey ? activeVideoIdsKey.split(",") : [];
    if (!activeIds.length) return;

    let stopped = false;
    const sync = async () => {
      await Promise.all(activeIds.map(async (id) => {
        try {
          const response = await authenticatedFetch(`/api/media/jobs/${encodeURIComponent(id)}`);
          const payload = await readApiJson<{ job: MediaJob }>(response);
          if (!stopped) updateJob(payload.job);
        } catch (pollError) {
          if (!stopped) setError(pollError instanceof Error ? pollError.message : "No se pudo actualizar el video.");
        }
      }));
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 10_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [activeVideoIdsKey, updateJob]);

  const qualityAvailable = (type: MediaType, quality: string) => {
    if (!models) return true;
    return models[type].find((entry) => entry.quality === quality)?.available ?? false;
  };

  const executeGeneration = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setError("Describí lo que querés crear.");
      return;
    }
    if (cleanPrompt.length > 4_000) {
      setError("El prompt supera los 4.000 caracteres.");
      return;
    }
    setConfirmVideo(false);
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setCurrentJob(null);
    try {
      const body = {
        type: mode,
        sourceMode: reference ? "reference" : "text",
        prompt: cleanPrompt,
        quality: selectedQuality,
        aspectRatio: selectedAspect,
        durationSeconds: mode === "video" ? duration : undefined,
        referenceUrl: reference?.url ?? null,
        referenceStoragePath: reference?.storagePath ?? null,
        idempotencyKey: crypto.randomUUID().replaceAll("-", ""),
        confirmedCostUsd: mode === "video" ? videoCost : undefined,
      };
      const response = await authenticatedFetch("/api/media/generate", { method: "POST", body: JSON.stringify(body) });
      const payload = await readApiJson<{ job: MediaJob; reused?: boolean }>(response);
      updateJob(payload.job);
      if (payload.job.status === "completed") setNotice("Tu creación quedó guardada en CLOUVA.");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "No se pudo completar la generación.");
      void loadHistory(null);
    } finally {
      setSubmitting(false);
    }
  };

  const requestGeneration = () => {
    if (!prompt.trim()) {
      setError("Describí lo que querés crear.");
      return;
    }
    if (mode === "video") setConfirmVideo(true);
    else void executeGeneration();
  };

  const retryStorage = async (job: MediaJob) => {
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/media/jobs/${encodeURIComponent(job.id)}/retry-storage`, { method: "POST" });
      const payload = await readApiJson<{ job: MediaJob }>(response);
      updateJob(payload.job);
      setNotice("El resultado se guardó correctamente.");
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "No se pudo reintentar el guardado.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteJob) return;
    try {
      const response = await authenticatedFetch(`/api/media/${encodeURIComponent(deleteJob.id)}`, { method: "DELETE" });
      await readApiJson<{ ok: true }>(response);
      setHistory((items) => items.filter((item) => item.id !== deleteJob.id));
      if (currentJob?.id === deleteJob.id) setCurrentJob(null);
      if (detailJob?.id === deleteJob.id) setDetailJob(null);
      setDeleteJob(null);
      setNotice("La creación fue eliminada.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo borrar la creación.");
    }
  };

  const copyPrompt = async (job: MediaJob) => {
    await navigator.clipboard.writeText(job.prompt);
    setNotice("Prompt copiado.");
  };

  const selectAsReference = (job: MediaJob) => {
    if (!job.outputUrl) return;
    setReference({ url: job.outputUrl, storagePath: "", mimeType: job.mimeType || "image/png", width: 0, height: 0, size: 0 });
    setMode("image");
    setNotice("La creación se cargó como referencia.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!busy) requestGeneration();
    }
  };

  if (loading) {
    return <main className={styles.gate}><LoaderCircle className={styles.spin} size={30} /><span>Cargando Crear…</span></main>;
  }
  if (!user) {
    return <main className={styles.gate}><CloverIcon size={34} /><h1>Ingresá para crear</h1><p>Tu sesión protege las generaciones y el historial.</p><Link href="/login">Ingresar</Link></main>;
  }
  if (role !== "admin") {
    return <main className={styles.gate}><ShieldCheck size={34} /><h1>Acceso restringido</h1><p>Crear está disponible durante la primera integración sólo para administradores.</p><Link href="/">Volver al inicio</Link></main>;
  }

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.mobileHeader}>
        <Link href="/" className={styles.brand}><span><CloverIcon size={23} /></span>CLOUVA</Link>
        <button type="button" onClick={() => setMobileMenu((value) => !value)} aria-label={mobileMenu ? "Cerrar menú" : "Abrir menú"} aria-expanded={mobileMenu}>
          {mobileMenu ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      <aside className={`${styles.sidebar} ${mobileMenu ? styles.sidebarOpen : ""}`}>
        <Link href="/" className={styles.brand}><span><CloverIcon size={25} /></span>CLOUVA</Link>
        <Link href="/crear" className={styles.createLink}><Sparkles size={18} />Crear</Link>
        <nav aria-label="Navegación de CLOUVA">
          {navSections.map((section, index) => (
            <div key={index} className={styles.navSection}>
              {section.map((item) => {
                const Icon = item.icon;
                return <Link key={`${item.label}-${item.href}`} href={item.href}><Icon size={18} />{item.label}</Link>;
              })}
            </div>
          ))}
        </nav>
        <div className={styles.accountCard}>
          <Link href="/perfil" className={styles.accountIdentity}>
            {avatar ? <img src={String(avatar)} alt="" /> : <span>{profileInitials(String(displayName))}</span>}
            <div><strong>{String(displayName)}</strong><small>Administrador</small></div>
          </Link>
          <Link href="/cuenta"><Settings size={17} />Ajustes</Link>
          <Link href="/sobre-clouva"><CircleHelp size={17} />Ayuda</Link>
        </div>
      </aside>

      <section className={styles.workspace}>
        <div className={styles.workspaceInner}>
          <header className={styles.hero}>
            <span className={styles.heroEyebrow}><Sparkles size={14} />CLOUVA CREATIVE</span>
            <h1>Crear con <em>CLOUVA</em></h1>
            <p>Convertí una idea en una imagen o video.</p>
          </header>

          <div className={styles.modeSwitch} aria-label="Tipo de creación">
            <button type="button" className={mode === "image" ? styles.modeActive : ""} onClick={() => setMode("image")} disabled={busy} aria-pressed={mode === "image"}>
              <ImageIcon size={19} />Imagen
            </button>
            <button type="button" className={mode === "video" ? styles.modeActive : ""} onClick={() => setMode("video")} disabled={busy} aria-pressed={mode === "video"}>
              <Play size={19} />Video
            </button>
          </div>

          <section className={styles.composer} aria-labelledby="prompt-label">
            <div className={styles.flowOrb} aria-hidden="true"><CloverIcon size={37} /><span>Flow</span></div>
            <div className={styles.promptArea}>
              <label id="prompt-label" htmlFor="creation-prompt">Describí lo que querés crear</label>
              <textarea
                id="creation-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value.slice(0, 4_000))}
                onKeyDown={onComposerKeyDown}
                maxLength={4_000}
                disabled={busy}
                placeholder={mode === "image" ? "Ej.: Una campaña editorial nocturna, luz violeta, textura analógica…" : "Ej.: Travelling lento por una ciudad futurista bajo la lluvia…"}
              />
              <div className={styles.promptFooter}>
                <button type="button" className={styles.ideaButton} onClick={() => setPrompt(promptIdeas[Math.floor(Math.random() * promptIdeas.length)])} disabled={busy}>
                  <Sparkles size={15} />Inspirame
                </button>
                <span>{prompt.length.toLocaleString("es-AR")} / 4.000</span>
                {prompt ? <button type="button" onClick={() => setPrompt("")} disabled={busy} aria-label="Limpiar prompt"><X size={16} /></button> : null}
                <button type="button" disabled title="Entrada por voz no disponible" aria-label="Entrada por voz no disponible"><Mic size={17} /></button>
              </div>
            </div>
          </section>

          <ReferenceUploader value={reference} onChange={setReference} disabled={busy} onError={setError} />

          <section className={styles.settingsPanel} aria-label="Configuración de generación">
            <label>
              <span>Formato</span>
              <div className={styles.selectWrap}>
                <select value={selectedAspect} onChange={(event) => mode === "image" ? setImageAspect(event.target.value as ImageAspectRatio) : setVideoAspect(event.target.value as VideoAspectRatio)} disabled={busy}>
                  {(mode === "image" ? IMAGE_ASPECT_RATIOS : VIDEO_ASPECT_RATIOS).map((value) => <option key={value} value={value}>{formatAspectRatio(value)}</option>)}
                </select>
                <SelectChevron />
              </div>
            </label>
            <label>
              <span>Calidad</span>
              <div className={styles.selectWrap}>
                <select value={selectedQuality} onChange={(event) => mode === "image" ? setImageQuality(event.target.value as ImageQuality) : setVideoQuality(event.target.value as VideoQuality)} disabled={busy}>
                  {Object.entries(mode === "image" ? IMAGE_QUALITY_CONFIG : VIDEO_QUALITY_CONFIG).map(([key, config]) => (
                    <option key={key} value={key} disabled={!qualityAvailable(mode, key)}>{config.label}{qualityAvailable(mode, key) ? "" : " · no disponible"}</option>
                  ))}
                </select>
                <SelectChevron />
              </div>
            </label>
            {mode === "video" ? (
              <label>
                <span>Duración</span>
                <div className={styles.selectWrap}>
                  <select value={duration} onChange={(event) => setDuration(Number(event.target.value) as VideoDuration)} disabled={busy}>
                    {VIDEO_DURATIONS.map((value) => <option key={value} value={value}>{value} segundos</option>)}
                  </select>
                  <SelectChevron />
                </div>
              </label>
            ) : null}
            <div className={styles.modelSummary}>
              <span>Modelo</span>
              <strong><Sparkles size={15} />{mode === "image" ? IMAGE_QUALITY_CONFIG[imageQuality].model : VIDEO_QUALITY_CONFIG[videoQuality].model}</strong>
              <small>{mode === "image" ? IMAGE_QUALITY_CONFIG[imageQuality].imageSize : `${VIDEO_QUALITY_CONFIG[videoQuality].resolution} · US$ ${videoCost.toFixed(2)}`}</small>
            </div>
          </section>

          {modelWarning ? <p className={styles.warningBanner}>{modelWarning}</p> : null}
          {error ? <p className={styles.errorBanner} role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Cerrar error"><X size={16} /></button></p> : null}
          {notice ? <p className={styles.noticeBanner} role="status"><Check size={16} />{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso"><X size={16} /></button></p> : null}

          <button type="button" className={styles.generateButton} onClick={requestGeneration} disabled={busy || !prompt.trim() || !qualityAvailable(mode, selectedQuality)}>
            {busy ? <LoaderCircle className={styles.spin} size={21} /> : <Sparkles size={21} />}
            {busy ? "Generando…" : mode === "image" ? "Generar imagen" : `Generar video · US$ ${videoCost.toFixed(2)}`}
          </button>
          <p className={styles.privateNote}><ShieldCheck size={16} />Tus creaciones están asociadas a tu cuenta y protegidas.</p>

          {progressCopy ? (
            <section className={`${styles.progressCard} ${currentJob?.status === "failed" ? styles.progressError : ""}`} aria-live="polite">
              {currentJob?.status === "failed" ? <X size={22} /> : <LoaderCircle className={currentJob?.status === "storage_failed" ? "" : styles.spin} size={22} />}
              <div><strong>{progressCopy}</strong><span>Estado real informado por el proveedor. No cierres esta pestaña si querés ver el resultado apenas termine.</span></div>
              {currentJob?.status === "storage_failed" ? <button type="button" onClick={() => void retryStorage(currentJob)}>Reintentar guardado</button> : null}
            </section>
          ) : null}

          {currentJob?.status === "completed" && currentJob.outputUrl ? (
            <section className={styles.resultSection} aria-labelledby="result-title">
              <div className={styles.sectionHeading}>
                <div><span className={styles.sectionKicker}>Resultado</span><h2 id="result-title">Tu creación</h2></div>
                <button type="button" className={styles.ghostButton} onClick={() => setDetailJob(currentJob)}>Ver detalle</button>
              </div>
              <div className={`${styles.resultMedia} ${currentJob.aspectRatio === "9:16" ? styles.resultPortrait : ""}`}>
                {currentJob.type === "image" ? <img src={currentJob.outputUrl} alt={currentJob.prompt} /> : <video src={currentJob.outputUrl} controls playsInline />}
              </div>
              <div className={styles.resultActions}>
                <a href={currentJob.outputUrl} target="_blank" rel="noreferrer"><ArrowDownToLine size={17} />Descargar</a>
                <button type="button" onClick={() => void copyPrompt(currentJob)}><Copy size={17} />Copiar prompt</button>
                {currentJob.type === "image" ? <button type="button" onClick={() => selectAsReference(currentJob)}><Images size={17} />Usar como referencia</button> : null}
              </div>
            </section>
          ) : null}
        </div>
      </section>

      <RecentCreations
        items={history}
        filter={filter}
        onFilter={setFilter}
        loading={historyLoading}
        nextCursor={nextCursor}
        onLoadMore={() => void loadHistory(nextCursor)}
        onSelect={(job) => { setCurrentJob(job); setDetailJob(job); }}
        onCopyPrompt={(job) => void copyPrompt(job)}
        onUseReference={selectAsReference}
        onDelete={setDeleteJob}
        onRetryStorage={(job) => void retryStorage(job)}
      />

      {confirmVideo ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setConfirmVideo(false); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="video-confirm-title">
            <button type="button" className={styles.modalClose} onClick={() => setConfirmVideo(false)} aria-label="Cerrar"><X size={19} /></button>
            <span className={styles.modalIcon}><Video size={23} /></span>
            <h2 id="video-confirm-title">Confirmar video</h2>
            <p>Vas a generar un video {videoAspect}, de {duration} segundos, con calidad {VIDEO_QUALITY_CONFIG[videoQuality].label.toLowerCase()}.</p>
            <div className={styles.costRow}><span>Costo estimado</span><strong>US$ {videoCost.toFixed(2)}</strong></div>
            <small>El costo se calcula con la tarifa por segundo configurada para el modelo seleccionado.</small>
            <div className={styles.modalActions}><button type="button" onClick={() => setConfirmVideo(false)}>Cancelar</button><button type="button" onClick={() => void executeGeneration()}><Sparkles size={17} />Confirmar y generar</button></div>
          </section>
        </div>
      ) : null}

      {detailJob ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDetailJob(null); }}>
          <section className={`${styles.modal} ${styles.detailModal}`} role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <button type="button" className={styles.modalClose} onClick={() => setDetailJob(null)} aria-label="Cerrar"><X size={19} /></button>
            <span className={styles.sectionKicker}>Detalle</span>
            <h2 id="detail-title">{detailJob.type === "image" ? "Imagen" : "Video"} · {detailJob.aspectRatio}</h2>
            {detailJob.outputUrl ? <div className={styles.detailMedia}>{detailJob.type === "image" ? <img src={detailJob.outputUrl} alt={detailJob.prompt} /> : <video src={detailJob.outputUrl} controls playsInline />}</div> : null}
            <dl className={styles.detailGrid}>
              <div><dt>Estado</dt><dd>{detailJob.status}</dd></div>
              <div><dt>Modelo</dt><dd>{detailJob.model}</dd></div>
              <div><dt>Calidad</dt><dd>{detailJob.quality}</dd></div>
              {detailJob.durationSeconds ? <div><dt>Duración</dt><dd>{detailJob.durationSeconds} s</dd></div> : null}
              {detailJob.estimatedCostUsd !== null ? <div><dt>Costo estimado</dt><dd>US$ {detailJob.estimatedCostUsd.toFixed(2)}</dd></div> : null}
            </dl>
            <div className={styles.promptDetail}><span>Prompt</span><p>{detailJob.prompt}</p></div>
          </section>
        </div>
      ) : null}

      {deleteJob ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDeleteJob(null); }}>
          <section className={styles.modal} role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
            <span className={`${styles.modalIcon} ${styles.deleteIcon}`}><Trash2 size={23} /></span>
            <h2 id="delete-title">¿Borrar esta creación?</h2>
            <p id="delete-description">Se eliminará el registro y su archivo almacenado. Esta acción no se puede deshacer.</p>
            <div className={styles.modalActions}><button type="button" onClick={() => setDeleteJob(null)}>Cancelar</button><button type="button" className={styles.dangerButton} onClick={() => void confirmDelete()}>Borrar</button></div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
