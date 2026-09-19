"use client";
/* eslint-disable @next/next/no-img-element -- generated media URLs are external GCS objects. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Film,
  ImagePlus,
  LoaderCircle,
  Music2,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { CloverIcon } from "@/components/clover-icon";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { MediaJob, ReferenceAsset } from "@/components/media-creator/types";
import type { VideoClip, VideoFrame, VideoProject } from "./types";

const active = new Set(["queued", "generating", "processing", "compositing"]);
const qualityOptions = [
  { value: "economy", label: "Económica" },
  { value: "fast", label: "Rápida" },
  { value: "cinematic", label: "Cinemática" },
] as const;

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, "0")}` : `${rest}s`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Listo para generar",
    queued: "Preparando",
    generating: "Generando",
    processing: "Procesando",
    compositing: "Componiendo",
    completed: "Finalizado",
    failed: "Error",
    cancelled: "Cancelado",
  };
  return labels[status] ?? status;
}

export function VideoProjectCreator() {
  const { user, role, loading } = useAuth();
  const frameInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("Nuevo video");
  const [masterPrompt, setMasterPrompt] = useState("");
  const [stylePrompt, setStylePrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [quality, setQuality] = useState<"economy" | "fast" | "cinematic">("fast");
  const [targetDurationSeconds, setTargetDurationSeconds] = useState(8);
  const [maintainStyle, setMaintainStyle] = useState(true);
  const [maintainCharacter, setMaintainCharacter] = useState(true);
  const [useFrameContinuity, setUseFrameContinuity] = useState(true);
  const [frames, setFrames] = useState<VideoFrame[]>([]);
  const [recentImages, setRecentImages] = useState<MediaJob[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [busy, setBusy] = useState(false);
  const [frameBusy, setFrameBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const prepared = Boolean(project && clips.length);
  const completedClips = clips.filter((clip) => clip.status === "completed").length;
  const estimatedCost = project?.estimatedCostUsd ?? clips.reduce((sum, clip) => sum + Number(clip.estimatedCostUsd || 0), 0);

  const refreshProject = useCallback(async (projectId: string) => {
    const response = await authenticatedFetch(`/api/video/projects/${encodeURIComponent(projectId)}`);
    const payload = await readApiJson<{ project: VideoProject; clips: VideoClip[] }>(response);
    setProject(payload.project);
    setClips(payload.clips);
    return payload.project;
  }, []);

  useEffect(() => {
    if (!user || role !== "admin") return;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/media/history?type=image&limit=24");
        const payload = await readApiJson<{ items: MediaJob[] }>(response);
        setRecentImages(payload.items.filter((item) => item.status === "completed" && item.outputUrl));
      } catch {
        // The project creator still works with direct uploads if history is unavailable.
      }
    })();
  }, [user, role]);

  useEffect(() => {
    if (!project || !active.has(project.status)) return;
    let stopped = false;
    const sync = async () => {
      try {
        const next = await refreshProject(project.id);
        if (!stopped && next.status === "completed") setNotice("Video completado y guardado en CLOUVA.");
      } catch (pollError) {
        if (!stopped) setError(pollError instanceof Error ? pollError.message : "No se pudo actualizar el proyecto.");
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 8000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [project?.id, project?.status, refreshProject]);

  const addRecentImage = (job: MediaJob) => {
    if (!job.outputUrl) return;
    setFrames((current) => {
      if (current.some((item) => item.url === job.outputUrl)) return current;
      return [...current, { url: job.outputUrl as string, mimeType: job.mimeType }];
    });
  };

  const uploadFrames = async (files: FileList | null) => {
    if (!files?.length) return;
    setFrameBusy(true);
    setError(null);
    try {
      const uploaded: VideoFrame[] = [];
      for (const file of Array.from(files).slice(0, 20)) {
        const form = new FormData();
        form.set("file", file);
        const response = await authenticatedFetch("/api/media/reference", { method: "POST", body: form });
        const payload = await readApiJson<{ reference: ReferenceAsset }>(response);
        uploaded.push({
          url: payload.reference.url,
          storagePath: payload.reference.storagePath,
          mimeType: payload.reference.mimeType,
        });
      }
      setFrames((current) => [...current, ...uploaded].slice(0, 60));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No se pudieron subir los frames.");
    } finally {
      setFrameBusy(false);
      if (frameInput.current) frameInput.current.value = "";
    }
  };

  const moveFrame = (index: number, direction: -1 | 1) => {
    setFrames((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const prepareProject = async () => {
    if (!title.trim()) return setError("Poné un nombre al proyecto.");
    if (!masterPrompt.trim() && !frames.length) return setError("Escribí la dirección visual o agregá frames.");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const createResponse = await authenticatedFetch("/api/video/projects", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          masterPrompt: masterPrompt.trim(),
          stylePrompt: stylePrompt.trim(),
          quality,
          aspectRatio,
          targetDurationSeconds,
          maintainStyle,
          maintainCharacter,
          useFrameContinuity,
          generateClipAudio: false,
        }),
      });
      const created = await readApiJson<{ project: VideoProject }>(createResponse);
      let nextProject = created.project;

      if (audioFile) {
        const form = new FormData();
        form.set("file", audioFile);
        const audioResponse = await authenticatedFetch(
          `/api/video/projects/${encodeURIComponent(nextProject.id)}/audio`,
          { method: "POST", body: form },
        );
        const audioPayload = await readApiJson<{ project: VideoProject }>(audioResponse);
        nextProject = audioPayload.project;
      }

      const planResponse = await authenticatedFetch(
        `/api/video/projects/${encodeURIComponent(nextProject.id)}/clips`,
        { method: "POST", body: JSON.stringify({ frames }) },
      );
      const planPayload = await readApiJson<{ clips: VideoClip[] }>(planResponse);
      setClips(planPayload.clips);
      const refreshed = await refreshProject(nextProject.id);
      setProject(refreshed);
      setNotice(`Proyecto preparado: ${planPayload.clips.length} clips en el timeline.`);
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : "No se pudo preparar el proyecto.");
    } finally {
      setBusy(false);
    }
  };

  const generateProject = async () => {
    if (!project) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await authenticatedFetch(
        `/api/video/projects/${encodeURIComponent(project.id)}/generate`,
        {
          method: "POST",
          body: JSON.stringify({ confirmedCostUsd: Number(estimatedCost) }),
        },
      );
      const payload = await readApiJson<{ project: VideoProject }>(response);
      setProject(payload.project);
      setNotice("Generación enviada a Google Cloud.");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "No se pudo iniciar la generación.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setProject(null);
    setClips([]);
    setError(null);
    setNotice(null);
  };

  if (loading) {
    return <main className="min-h-screen bg-[#05030a] text-white grid place-items-center"><LoaderCircle className="animate-spin" /></main>;
  }
  if (!user) {
    return <main className="min-h-screen bg-[#05030a] text-white grid place-items-center"><Link href="/login" className="rounded-full bg-white px-6 py-3 text-black">Ingresar</Link></main>;
  }
  if (role !== "admin") {
    return <main className="min-h-screen bg-[#05030a] text-white grid place-items-center"><p>Crear video está habilitado durante esta integración para administradores.</p></main>;
  }

  return (
    <main className="min-h-screen bg-[#05030a] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,.16),transparent_42%)]" />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05030a]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/crear/media" aria-label="Volver a Crear" className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5"><ArrowLeft size={18} /></Link>
            <div className="flex items-center gap-2"><CloverIcon size={24} /><strong>CLOUVA VIDEO</strong></div>
          </div>
          {project ? <button type="button" onClick={reset} className="text-sm text-white/60 hover:text-white">Nuevo proyecto</button> : null}
        </div>
      </header>

      <div className="relative mx-auto grid max-w-6xl gap-6 px-4 py-7 lg:grid-cols-[1fr_360px]">
        <section className="space-y-5">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.24em] text-violet-300"><Sparkles size={14} />Cloud Video Engine</span>
            <h1 className="mt-2 text-3xl font-black sm:text-5xl">Crear video en cloud</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">Frames + dirección visual + audio master → clips Veo → composición FFmpeg → MP4 final.</p>
          </div>

          {!prepared ? (
            <>
              <section className="rounded-3xl border border-white/10 bg-white/[.035] p-4 sm:p-6">
                <div className="grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-white/45">Proyecto</span>
                    <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/60" />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-white/45">Dirección visual</span>
                    <textarea value={masterPrompt} onChange={(event) => setMasterPrompt(event.target.value.slice(0, 4000))} rows={5} placeholder="Describí el video completo, movimiento, cámara, universo visual…" className="resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/60" />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-white/45">Style lock</span>
                    <textarea value={stylePrompt} onChange={(event) => setStylePrompt(event.target.value.slice(0, 4000))} rows={3} placeholder="Misma paleta, iluminación, ropa, tratamiento cinematográfico…" className="resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/60" />
                  </label>
                </div>
              </section>

              <section className="rounded-3xl border border-white/10 bg-white/[.035] p-4 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div><h2 className="font-bold">Frames maestros</h2><p className="mt-1 text-xs text-white/45">El orden define la continuidad visual del timeline.</p></div>
                  <button type="button" onClick={() => frameInput.current?.click()} disabled={frameBusy} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
                    {frameBusy ? <LoaderCircle className="animate-spin" size={16} /> : <ImagePlus size={16} />}Agregar
                  </button>
                  <input ref={frameInput} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void uploadFrames(event.target.files)} />
                </div>

                {frames.length ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {frames.map((item, index) => (
                      <div key={`${item.url}-${index}`} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                        <div className="aspect-video"><img src={item.url} alt={`Frame ${index + 1}`} className="h-full w-full object-cover" /></div>
                        <div className="flex items-center justify-between px-2 py-2 text-xs">
                          <strong>{String(index + 1).padStart(2, "0")}</strong>
                          <div className="flex gap-1">
                            <button type="button" onClick={() => moveFrame(index, -1)} disabled={index === 0} className="rounded-lg p-1.5 hover:bg-white/10 disabled:opacity-20"><ChevronUp size={14} /></button>
                            <button type="button" onClick={() => moveFrame(index, 1)} disabled={index === frames.length - 1} className="rounded-lg p-1.5 hover:bg-white/10 disabled:opacity-20"><ChevronDown size={14} /></button>
                            <button type="button" onClick={() => setFrames((items) => items.filter((_, frameIndex) => frameIndex !== index))} className="rounded-lg p-1.5 hover:bg-red-500/15"><Trash2 size={14} /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <button type="button" onClick={() => frameInput.current?.click()} className="grid min-h-36 w-full place-items-center rounded-2xl border border-dashed border-white/15 text-sm text-white/40"><span className="flex items-center gap-2"><Plus size={16} />Subir frames</span></button>}

                {recentImages.length ? (
                  <div className="mt-5">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/35">Creaciones recientes</p>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {recentImages.slice(0, 12).map((job) => (
                        <button key={job.id} type="button" onClick={() => addRecentImage(job)} className="h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                          <img src={job.outputUrl as string} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="rounded-3xl border border-white/10 bg-white/[.035] p-4 sm:p-6">
                <div className="mb-4 flex items-center gap-3"><Music2 size={18} /><div><h2 className="font-bold">Audio master</h2><p className="text-xs text-white/45">Opcional. WAV, MP3, M4A, AAC o FLAC.</p></div></div>
                <button type="button" onClick={() => audioInput.current?.click()} className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-left">
                  <span className="truncate text-sm">{audioFile?.name || "Seleccionar audio master"}</span><Upload size={17} className="text-white/45" />
                </button>
                <input ref={audioInput} className="hidden" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/flac,audio/aac" onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)} />
              </section>
            </>
          ) : (
            <section className="rounded-3xl border border-white/10 bg-white/[.035] p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><span className="text-xs uppercase tracking-[.2em] text-violet-300">{statusLabel(project?.status || "draft")}</span><h2 className="mt-1 text-2xl font-black">{project?.title}</h2><p className="mt-1 text-sm text-white/45">{clips.length} clips · {durationLabel(project?.targetDurationSeconds || 0)}</p></div>
                {project?.status === "completed" ? <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-400 text-black"><Check size={20} /></span> : null}
              </div>

              <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${project?.progress || 0}%` }} /></div>
              <div className="mt-2 flex justify-between text-xs text-white/45"><span>{completedClips} / {clips.length} clips</span><span>{project?.progress || 0}%</span></div>

              <div className="mt-6 grid grid-cols-4 gap-2 sm:grid-cols-8">
                {clips.map((clip) => (
                  <div key={clip.id} title={clip.error || statusLabel(clip.status)} className={`aspect-square rounded-xl border p-2 text-[10px] ${clip.status === "completed" ? "border-emerald-400/30 bg-emerald-400/10" : clip.status === "failed" ? "border-red-400/30 bg-red-400/10" : "border-white/10 bg-black/30"}`}>
                    <strong>{String(clip.sequenceIndex + 1).padStart(2, "0")}</strong><div className="mt-1 truncate text-white/45">{clip.durationSeconds}s</div>
                  </div>
                ))}
              </div>

              {project?.status === "completed" && project.outputUrl ? (
                <div className="mt-6">
                  <video src={project.outputUrl} poster={project.thumbnailUrl || undefined} controls playsInline className="w-full rounded-2xl bg-black" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={project.outputUrl} download className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"><ArrowDownToLine size={16} />Descargar MP4</a>
                    <a href={project.outputUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm"><Play size={16} />Abrir video</a>
                  </div>
                </div>
              ) : null}
            </section>
          )}

          {error ? <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}
          {notice ? <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{notice}</div> : null}
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-3xl border border-white/10 bg-[#0c0912]/90 p-4 shadow-2xl shadow-violet-950/20 backdrop-blur-xl sm:p-5">
            <div className="mb-4 flex items-center gap-2"><Film size={18} /><h2 className="font-bold">Render</h2></div>
            <div className="grid gap-3">
              <label className="grid gap-1.5"><span className="text-xs text-white/45">Formato</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as "16:9" | "9:16")} disabled={prepared} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"><option value="16:9">16:9 · YouTube</option><option value="9:16">9:16 · Vertical</option></select></label>
              <label className="grid gap-1.5"><span className="text-xs text-white/45">Motor</span><select value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)} disabled={prepared} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5">{qualityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="grid gap-1.5"><span className="text-xs text-white/45">Duración objetivo</span><div className="flex gap-2"><input type="number" min={4} max={7200} value={targetDurationSeconds} onChange={(event) => setTargetDurationSeconds(Math.max(4, Math.min(7200, Number(event.target.value) || 4)))} disabled={prepared} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5" /><button type="button" onClick={() => setTargetDurationSeconds(480)} disabled={prepared} className="rounded-xl border border-white/10 px-3 text-xs">8 min</button></div></label>
            </div>

            <div className="my-5 border-t border-white/10" />
            <div className="grid gap-3 text-sm">
              <label className="flex items-center justify-between gap-3"><span>Mantener estilo</span><input type="checkbox" checked={maintainStyle} onChange={(event) => setMaintainStyle(event.target.checked)} disabled={prepared} className="h-4 w-4 accent-violet-500" /></label>
              <label className="flex items-center justify-between gap-3"><span>Mantener personaje</span><input type="checkbox" checked={maintainCharacter} onChange={(event) => setMaintainCharacter(event.target.checked)} disabled={prepared} className="h-4 w-4 accent-violet-500" /></label>
              <label className="flex items-center justify-between gap-3"><span>Continuidad de frames</span><input type="checkbox" checked={useFrameContinuity} onChange={(event) => setUseFrameContinuity(event.target.checked)} disabled={prepared} className="h-4 w-4 accent-violet-500" /></label>
            </div>

            {prepared ? (
              <>
                <div className="my-5 border-t border-white/10" />
                <div className="flex items-end justify-between"><span className="text-xs text-white/45">Costo estimado del plan</span><strong className="text-xl">USD {Number(estimatedCost).toFixed(2)}</strong></div>
                {project?.status === "draft" || project?.status === "failed" ? (
                  <button type="button" onClick={() => void generateProject()} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3.5 font-black text-black disabled:opacity-50">
                    {busy ? <LoaderCircle className="animate-spin" size={18} /> : <Sparkles size={18} />}GENERAR EN CLOUD
                  </button>
                ) : (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm">{statusLabel(project?.status || "")}</div>
                )}
              </>
            ) : (
              <button type="button" onClick={() => void prepareProject()} disabled={busy || frameBusy} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3.5 font-black text-black disabled:opacity-50">
                {busy ? <LoaderCircle className="animate-spin" size={18} /> : <Sparkles size={18} />}PREPARAR PROYECTO
              </button>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
