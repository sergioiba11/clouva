"use client";
/* eslint-disable @next/next/no-img-element -- generated GCS thumbnails and media previews are external. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowLeft, Cpu, Film, History,
  LoaderCircle, RefreshCcw, SlidersHorizontal, Sparkles, Upload, WandSparkles,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { CloverIcon } from "@/components/clover-icon";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { uploadFileResumable } from "@/lib/resumable-upload-client";

type EnhanceJob = {
  id: string; title: string; sourceUrl: string | null; sourceFilename: string | null;
  sourceSizeBytes: number | null; prompt: string; negativePrompt: string; model: string;
  mode: "faithful" | "balanced" | "reimagine"; transformStrength: number;
  preserveMotion: boolean; preserveCamera: boolean; preserveSubject: boolean; preserveAudio: boolean;
  outputResolution: "480p" | "720p"; outputFps: 24 | 25 | 30; seed: number;
  trimStartSeconds: number; trimDurationSeconds: number | null;
  status: "draft" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number; outputUrl: string | null; thumbnailUrl: string | null;
  gpuSeconds: number | null; error: string | null; createdAt: string; updatedAt: string;
};

type RuntimeStatus = { ready: boolean; reason: string | null; location: string };
type VideoProject = {
  id: string;
  title: string;
  status: string;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  targetDurationSeconds: number;
  createdAt: string;
};
const activeStatuses = new Set(["queued", "processing"]);

function videoMime(file: File) {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return "video/mp4";
}
function statusText(status: EnhanceJob["status"]) {
  const labels = {
    draft: "Preparado", queued: "En cola", processing: "Procesando GPU",
    completed: "Finalizado", failed: "Error", cancelled: "Cancelado",
  };
  return labels[status];
}

function bytesLabel(bytes: number | null) {
  if (!bytes) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function VideoEnhanceStudio() {
  const { user, role, loading } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState<"upload" | "clouva">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [videoProjects, setVideoProjects] = useState<VideoProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [title, setTitle] = useState("Video AI");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("blurry, jittery, distorted, inconsistent motion, text, watermark");
  const [model, setModel] = useState("ltxv-13b-0.9.8-distilled");
  const [mode, setMode] = useState<EnhanceJob["mode"]>("balanced");
  const [strength, setStrength] = useState(0.45);
  const [preserveMotion, setPreserveMotion] = useState(true);
  const [preserveCamera, setPreserveCamera] = useState(true);
  const [preserveSubject, setPreserveSubject] = useState(true);
  const [preserveAudio, setPreserveAudio] = useState(true);
  const [resolution, setResolution] = useState<"480p" | "720p">("720p");
  const [fps, setFps] = useState<24 | 25 | 30>(24);
  const [seed, setSeed] = useState(171198);
  const [trimStart, setTrimStart] = useState(0);
  const [trimDuration, setTrimDuration] = useState("");
  const [job, setJob] = useState<EnhanceJob | null>(null);
  const [history, setHistory] = useState<EnhanceJob[]>([]);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedProject = videoProjects.find((item) => item.id === selectedProjectId) ?? null;
  const sourcePreview = job?.sourceUrl || (sourceMode === "clouva" ? selectedProject?.outputUrl : localPreview);
  const hasSource = sourceMode === "upload" ? Boolean(file) : Boolean(selectedProject?.outputUrl);
  const canRun = Boolean(hasSource && prompt.trim() && runtime?.ready && !busy);

  const loadHistory = useCallback(async () => {
    const [enhanceResponse, projectsResponse] = await Promise.all([
      authenticatedFetch("/api/video/enhance?limit=20"),
      authenticatedFetch("/api/video/projects"),
    ]);
    const enhancePayload = await readApiJson<{ items: EnhanceJob[]; runtime: RuntimeStatus }>(enhanceResponse);
    const projectsPayload = await readApiJson<{ projects: VideoProject[] }>(projectsResponse);
    setHistory(enhancePayload.items);
    setRuntime(enhancePayload.runtime);
    setVideoProjects(projectsPayload.projects.filter((item) => item.status === "completed" && item.outputUrl));
  }, []);

  const refreshJob = useCallback(async (jobId: string) => {
    const response = await authenticatedFetch(`/api/video/enhance/${encodeURIComponent(jobId)}`);
    const payload = await readApiJson<{ job: EnhanceJob }>(response);
    setJob(payload.job);
    return payload.job;
  }, []);

  useEffect(() => {
    if (!user || role !== "admin") return;
    void loadHistory().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar Video AI.");
    });
  }, [user, role, loadHistory]);

  useEffect(() => {
    if (!job || !activeStatuses.has(job.status)) return;
    let stopped = false;
    const sync = async () => {
      try {
        const next = await refreshJob(job.id);
        if (!stopped && next.status === "completed") {
          setNotice("Video terminado. El original y el resultado quedaron guardados.");
          void loadHistory();
        }
      } catch (pollError) {
        if (!stopped) setError(pollError instanceof Error ? pollError.message : "No se pudo actualizar el render.");
      }
    };
    const timer = window.setInterval(() => void sync(), 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [job, refreshJob, loadHistory]);
  useEffect(() => () => {
    if (localPreview) URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  const pickFile = (next: File | null) => {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setSourceMode("upload");
    setSelectedProjectId("");
    setFile(next);
    setLocalPreview(next ? URL.createObjectURL(next) : null);
    setJob(null);
    setError(null);
    setNotice(null);
  };

  const pickClouvaProject = (projectId: string) => {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setSourceMode("clouva");
    setFile(null);
    setLocalPreview(null);
    setSelectedProjectId(projectId);
    setJob(null);
    setError(null);
    setNotice(null);
  };

  const payload = useMemo(() => ({
    title: title.trim() || "Video AI",
    prompt: prompt.trim(),
    negativePrompt: negativePrompt.trim(),
    model,
    mode,
    transformStrength: strength,
    preserveMotion,
    preserveCamera,
    preserveSubject,
    preserveAudio,
    outputResolution: resolution,
    outputFps: fps,
    seed,
    trimStartSeconds: Math.max(0, Number(trimStart) || 0),
    trimDurationSeconds: trimDuration.trim() ? Math.max(0.1, Number(trimDuration)) : null,
    sourceProjectId: sourceMode === "clouva" ? selectedProjectId : null,
  }), [title, prompt, negativePrompt, model, mode, strength, preserveMotion, preserveCamera, preserveSubject, preserveAudio, resolution, fps, seed, trimStart, trimDuration, sourceMode, selectedProjectId]);

  const createAndRun = async () => {
    if (!hasSource) return setError("Seleccioná un video base.");
    if (!prompt.trim()) return setError("Escribí qué transformación visual querés.");
    if (!runtime?.ready) return setError("La GPU de Video AI todavía no está habilitada.");
    setBusy(true);
    setError(null);
    setNotice(null);
    setUploadPercent(sourceMode === "upload" ? 0 : null);
    try {
      const createResponse = await authenticatedFetch("/api/video/enhance", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const created = await readApiJson<{ job: EnhanceJob }>(createResponse);
      setJob(created.job);

      if (sourceMode === "upload" && file) {
        const contentType = videoMime(file);
        const prepareResponse = await authenticatedFetch(
          `/api/video/enhance/${encodeURIComponent(created.job.id)}/upload`,
          { method: "POST", body: JSON.stringify({ filename: file.name, size: file.size, contentType }) },
        );
        const prepared = await readApiJson<{ uploadUrl: string; storagePath: string; chunkBytes: number }>(prepareResponse);
        await uploadFileResumable({
          uploadUrl: prepared.uploadUrl,
          file,
          chunkBytes: prepared.chunkBytes,
          contentType,
          onProgress: (progress) => setUploadPercent(Math.round(progress.percent)),
        });

        const linkResponse = await authenticatedFetch(
          `/api/video/enhance/${encodeURIComponent(created.job.id)}/upload`,
          {
            method: "PATCH",
            body: JSON.stringify({
              filename: file.name, size: file.size, contentType, storagePath: prepared.storagePath,
            }),
          },
        );
        const linked = await readApiJson<{ job: EnhanceJob }>(linkResponse);
        setJob(linked.job);
        setUploadPercent(100);
      }

      const runResponse = await authenticatedFetch(
        `/api/video/enhance/${encodeURIComponent(created.job.id)}/run`,
        { method: "POST" },
      );
      const started = await readApiJson<{ job: EnhanceJob }>(runResponse);
      setJob(started.job);
      setNotice("Video enviado a la GPU.");
      void loadHistory();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "No se pudo iniciar Video AI.");
    } finally {
      setBusy(false);
      setUploadPercent(null);
    }
  };
  const loadJobConfig = (item: EnhanceJob) => {
    setJob(item);
    setTitle(item.title);
    setPrompt(item.prompt);
    setNegativePrompt(item.negativePrompt);
    setModel(item.model);
    setMode(item.mode);
    setStrength(item.transformStrength);
    setPreserveMotion(item.preserveMotion);
    setPreserveCamera(item.preserveCamera);
    setPreserveSubject(item.preserveSubject);
    setPreserveAudio(item.preserveAudio);
    setResolution(item.outputResolution);
    setFps(item.outputFps);
    setSeed(item.seed);
    setTrimStart(item.trimStartSeconds);
    setTrimDuration(item.trimDurationSeconds == null ? "" : String(item.trimDurationSeconds));
    setFile(null);
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
  };

  const reset = () => {
    setJob(null);
    pickFile(null);
    setSourceMode("upload");
    setSelectedProjectId("");
    setUploadPercent(null);
    setError(null);
    setNotice(null);
  };

  if (loading) return <main className="min-h-screen bg-[#05030a] text-white grid place-items-center"><LoaderCircle className="animate-spin" /></main>;
  if (!user) return <main className="min-h-screen bg-[#05030a] text-white grid place-items-center"><Link href="/login" className="rounded-full bg-white px-6 py-3 text-black">Ingresar</Link></main>;
  if (role !== "admin") return <main className="min-h-screen bg-[#05030a] text-white grid place-items-center"><p>Video AI está habilitado para administradores durante esta integración.</p></main>;

  return (
    <main className="min-h-screen bg-[#05030a] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_25%_0%,rgba(124,58,237,.22),transparent_38%),radial-gradient(circle_at_85%_20%,rgba(14,165,233,.12),transparent_32%)]" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#05030a]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/crear/video" className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5"><ArrowLeft size={18} /></Link>
            <div className="flex items-center gap-2"><CloverIcon size={24} /><strong>VIDEO AI LAB</strong></div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`rounded-full border px-3 py-1.5 ${runtime?.ready ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-100"}`}>
              {runtime?.ready ? "GPU LISTA" : "GPU PENDIENTE"}
            </span>
            <button type="button" onClick={reset} className="rounded-full border border-white/10 px-3 py-1.5 text-white/65 hover:text-white">Nuevo</button>
          </div>
        </div>
      </header>
      <div className="relative mx-auto grid max-w-[1500px] gap-4 px-4 py-5 xl:grid-cols-[320px_minmax(0,1fr)_350px]">
        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <section className="rounded-3xl border border-white/10 bg-white/[.035] p-4">
            <div className="mb-3 flex items-center gap-2"><Upload size={17} /><strong>Video base</strong></div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSourceMode("upload")} className={`rounded-xl border px-3 py-2 text-xs font-bold ${sourceMode === "upload" ? "border-violet-400/45 bg-violet-400/15" : "border-white/10 bg-black/25 text-white/45"}`}>SUBIR VIDEO</button>
              <button type="button" onClick={() => pickClouvaProject(selectedProjectId)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${sourceMode === "clouva" ? "border-violet-400/45 bg-violet-400/15" : "border-white/10 bg-black/25 text-white/45"}`}>CLOUVA VIDEO</button>
            </div>

            {sourceMode === "upload" ? (
              <>
                <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
                  className="grid min-h-36 w-full place-items-center rounded-2xl border border-dashed border-white/15 bg-black/25 px-4 text-center text-sm text-white/45 hover:border-violet-400/50">
                  {file ? <span><strong className="block text-white">{file.name}</strong><span>{bytesLabel(file.size)}</span></span> : <span><Upload className="mx-auto mb-2" size={22} />MP4 · MOV · WebM<br />hasta 4 GB</span>}
                </button>
                <input ref={inputRef} type="file" className="hidden" accept="video/mp4,video/quicktime,video/webm" onChange={(event) => pickFile(event.target.files?.[0] ?? null)} />
                {uploadPercent !== null ? <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-violet-300 transition-all" style={{ width: `${uploadPercent}%` }} /></div><p className="mt-1 text-right text-[11px] text-white/40">{uploadPercent}%</p></div> : null}
              </>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {videoProjects.length ? videoProjects.map((item) => (
                  <button key={item.id} type="button" onClick={() => pickClouvaProject(item.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-2 text-left ${selectedProjectId === item.id ? "border-violet-400/45 bg-violet-400/10" : "border-white/10 bg-black/25 hover:bg-white/[.06]"}`}>
                    <div className="h-12 w-16 overflow-hidden rounded-xl bg-black">
                      {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Film size={16} className="text-white/25" /></div>}
                    </div>
                    <div className="min-w-0 flex-1"><strong className="block truncate text-xs">{item.title}</strong><span className="text-[11px] text-white/40">{item.targetDurationSeconds}s · render final</span></div>
                  </button>
                )) : <p className="py-7 text-center text-xs text-white/30">No hay renders terminados en CLOUVA Video.</p>}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[.035] p-4">
            <div className="mb-3 flex items-center gap-2"><History size={17} /><strong>Últimos renders</strong></div>
            <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
              {history.length ? history.map((item) => (
                <button key={item.id} type="button" onClick={() => loadJobConfig(item)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-2 text-left hover:bg-white/[.06]">
                  <div className="h-12 w-16 overflow-hidden rounded-xl bg-black">
                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Film size={16} className="text-white/25" /></div>}
                  </div>
                  <div className="min-w-0 flex-1"><strong className="block truncate text-xs">{item.title}</strong><span className="text-[11px] text-white/40">{statusText(item.status)} · {item.outputResolution}</span></div>
                </button>
              )) : <p className="py-8 text-center text-xs text-white/30">Todavía no hay renders.</p>}
            </div>
          </section>
        </aside>
        <section className="space-y-4">
          <section className="overflow-hidden rounded-3xl border border-white/10 bg-black/35">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div><span className="text-[10px] font-bold uppercase tracking-[.24em] text-violet-300">Video → Video</span><h1 className="text-xl font-black">LTX Transform</h1></div>
              {job ? <span className="text-xs text-white/45">{statusText(job.status)} · {job.progress}%</span> : null}
            </div>
            <div className={`grid min-h-[430px] ${job?.outputUrl ? "md:grid-cols-2" : ""}`}>
              <div className="relative grid min-h-[430px] place-items-center bg-black">
                {sourcePreview ? <video src={sourcePreview} controls playsInline className="max-h-[68vh] w-full" /> : <div className="text-center text-white/25"><Film className="mx-auto mb-3" size={38} /><p>Cargá tu video base</p></div>}
                {job?.outputUrl ? <span className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-[10px] font-bold">ORIGINAL</span> : null}
              </div>
              {job?.outputUrl ? <div className="relative grid min-h-[430px] place-items-center border-l border-white/10 bg-black"><video src={job.outputUrl} controls playsInline autoPlay loop className="max-h-[68vh] w-full" /><span className="absolute left-3 top-3 rounded-full bg-violet-500/80 px-3 py-1 text-[10px] font-bold">AI RESULT</span></div> : null}
            </div>
            {job && activeStatuses.has(job.status) ? <div className="border-t border-white/10 p-4"><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-sky-300 transition-all" style={{ width: `${job.progress}%` }} /></div><div className="mt-2 flex justify-between text-[11px] text-white/40"><span>Cloud Run GPU · LTX</span><span>{job.progress}%</span></div></div> : null}
            {job?.status === "completed" && job.outputUrl ? <div className="flex flex-wrap gap-2 border-t border-white/10 p-4"><a href={job.outputUrl} download className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black"><ArrowDownToLine size={16} />Descargar MP4</a><button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm"><RefreshCcw size={15} />Otro video</button>{job.gpuSeconds ? <span className="ml-auto self-center text-xs text-white/35">GPU {Math.round(job.gpuSeconds)}s</span> : null}</div> : null}
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[.035] p-4 sm:p-5">
            <label className="grid gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-white/40">Transformación</span><textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 4000))} placeholder="Ej: Convertir el video en un videoclip cinematográfico helado, iluminación azul de estudio, humo frío, materiales realistas; conservar exactamente el movimiento y la cámara…" className="resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/60" /></label>
            <details className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3"><summary className="cursor-pointer text-xs text-white/55">Negative prompt</summary><textarea rows={3} value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value.slice(0, 2000))} className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none" /></details>
          </section>
          {error ? <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}
          {notice ? <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{notice}</div> : null}
        </section>
        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <section className="rounded-3xl border border-white/10 bg-[#0d0914]/95 p-4 shadow-2xl shadow-violet-950/20">
            <div className="mb-4 flex items-center gap-2"><WandSparkles size={18} /><strong>Transform</strong></div>
            <div className="grid grid-cols-3 gap-2">
              {(["faithful", "balanced", "reimagine"] as const).map((value) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-xl border px-2 py-2 text-xs font-semibold capitalize ${mode === value ? "border-violet-400/50 bg-violet-400/15 text-white" : "border-white/10 bg-black/25 text-white/45"}`}>{value}</button>)}
            </div>
            <label className="mt-5 block"><div className="mb-2 flex justify-between text-xs"><span>Fuerza visual</span><strong>{Math.round(strength * 100)}%</strong></div><input type="range" min="0" max="1" step="0.01" value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="w-full accent-violet-500" /></label>
            <div className="my-4 border-t border-white/10" />
            <div className="grid gap-3 text-sm">
              {[
                ["Movimiento", preserveMotion, setPreserveMotion],
                ["Cámara", preserveCamera, setPreserveCamera],
                ["Sujeto", preserveSubject, setPreserveSubject],
                ["Audio original", preserveAudio, setPreserveAudio],
              ].map(([label, checked, setter]) => <label key={String(label)} className="flex items-center justify-between gap-3"><span>{String(label)}</span><input type="checkbox" checked={Boolean(checked)} onChange={(e) => (setter as (value: boolean) => void)(e.target.checked)} className="h-4 w-4 accent-violet-500" /></label>)}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[.035] p-4">
            <div className="mb-4 flex items-center gap-2"><SlidersHorizontal size={17} /><strong>Salida</strong></div>
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs text-white/45">Modelo<select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-white"><option value="ltxv-13b-0.9.8-distilled">LTX 13B DISTILLED · PRO</option><option value="ltxv-2b-0.9.8-distilled">LTX 2B DISTILLED · FAST</option></select></label>
              <div className="grid grid-cols-2 gap-2"><label className="grid gap-1.5 text-xs text-white/45">Resolución<select value={resolution} onChange={(e) => setResolution(e.target.value as "480p" | "720p")} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-white"><option value="720p">720p PRO</option><option value="480p">480p FAST</option></select></label><label className="grid gap-1.5 text-xs text-white/45">FPS<select value={fps} onChange={(e) => setFps(Number(e.target.value) as 24 | 25 | 30)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-white"><option value={24}>24</option><option value={25}>25</option><option value={30}>30</option></select></label></div>
              <label className="grid gap-1.5 text-xs text-white/45">Seed<input type="number" value={seed} onChange={(e) => setSeed(Math.trunc(Number(e.target.value) || 0))} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-white" /></label>
              <div className="grid grid-cols-2 gap-2"><label className="grid gap-1.5 text-xs text-white/45">Inicio (s)<input type="number" min={0} step={0.1} value={trimStart} onChange={(e) => setTrimStart(Math.max(0, Number(e.target.value) || 0))} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-white" /></label><label className="grid gap-1.5 text-xs text-white/45">Duración<input type="number" min={0.1} step={0.1} value={trimDuration} placeholder="Todo" onChange={(e) => setTrimDuration(e.target.value)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-white" /></label></div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[.035] p-4">
            <div className="flex items-center gap-2"><Cpu size={17} /><strong>GPU</strong></div>
            <div className="mt-3 grid gap-2 text-xs text-white/45"><div className="flex justify-between"><span>Región</span><span className="text-white/75">{runtime?.location || "—"}</span></div><div className="flex justify-between"><span>Worker</span><span className={runtime?.ready ? "text-emerald-300" : "text-amber-200"}>{runtime?.ready ? "LISTO" : "CUOTA PENDIENTE"}</span></div><div className="flex justify-between"><span>Normalización IA</span><span className="text-white/75">24 FPS CFR</span></div></div>
            <button type="button" onClick={() => void createAndRun()} disabled={!canRun} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3.5 font-black text-black disabled:cursor-not-allowed disabled:opacity-35">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <Sparkles size={18} />}TRANSFORMAR VIDEO</button>
            {!runtime?.ready ? <p className="mt-2 text-center text-[10px] leading-4 text-amber-100/55">El front y el worker están preparados; Google Cloud todavía debe habilitar la cuota GPU del proyecto.</p> : null}
          </section>
        </aside>
      </div>
    </main>
  );
}
