"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Box,
  Check,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  ImagePlus,
  Loader2,
  PackageCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { OutfitPreview } from "@/components/avatar-engine/OutfitPreview";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";

const CATEGORIES = [
  { value: "hoodie", label: "Buzo", glyph: "🧥", hint: "Capucha y torso" },
  { value: "shirt", label: "Remera", glyph: "👕", hint: "Manga corta" },
  { value: "jacket", label: "Campera", glyph: "🥼", hint: "Capa exterior" },
  { value: "pants", label: "Pantalón baggy", glyph: "👖", hint: "Piernas completas" },
  { value: "shorts", label: "Short", glyph: "🩳", hint: "Pierna corta" },
  { value: "shoes", label: "Zapatillas", glyph: "👟", hint: "Par completo" },
  { value: "accessory", label: "Accesorio", glyph: "⛓️", hint: "Objeto vestible" },
] as const;

const FITS = ["Entallado", "Normal", "Oversized", "Baggy"] as const;
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_STATUS_ERRORS = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const CREATIVE_TIPS = [
  "Describí la silueta",
  "Agregá detalles visibles",
  "Mencioná materiales",
  "Indicá el estilo general",
];

const STEPS = [
  { number: 1, title: "Definí la prenda", caption: "Elegí tipo y describila" },
  { number: 2, title: "Subí referencias", caption: "Frente y espalda" },
  { number: 3, title: "Generá el objeto 3D", caption: "Meshy crea tu pieza" },
  { number: 4, title: "Exportá a Unreal", caption: "Descargá el FBX" },
];

type Phase = "idle" | "creating" | "preview" | "refining" | "rigging" | "done" | "error";

type MeshyStatus = {
  status?: string;
  progress?: number;
  model_urls?: { glb?: string };
  task_error?: { message?: string };
  error?: string;
};

type Result = {
  id: string;
  modelUrl: string;
  rigged?: boolean;
  fitStatus?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readableError(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  if (cause && typeof cause === "object") {
    const value = cause as Record<string, unknown>;
    for (const key of ["error", "message", "detail", "details", "error_description"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return fallback;
}

function validateImage(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return "Usá una imagen PNG, JPG, JPEG o WEBP.";
  if (file.size > MAX_IMAGE_BYTES) return "Cada imagen debe pesar menos de 8 MB.";
  return null;
}

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  return url;
}

function SectionHeader({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-violet-400/70 bg-violet-500/10 text-sm font-black text-violet-200">
        {number}
      </span>
      <div>
        <h2 className="text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-white/45">{description}</p>
      </div>
    </div>
  );
}

function ReferenceInput({
  side,
  file,
  disabled,
  onChange,
  onError,
}: {
  side: "front" | "back";
  file: File | null;
  disabled: boolean;
  onChange: (file: File | null) => void;
  onError: (message: string | null) => void;
}) {
  const preview = useObjectUrl(file);
  const [dragging, setDragging] = useState(false);
  const inputId = `garment-${side}-reference`;
  const title = side === "front" ? "Imagen de frente" : "Imagen de atrás";
  const hint = side === "front" ? "Vista recta desde adelante" : "La misma pieza desde atrás";

  const acceptFile = (next: File | null) => {
    if (!next) return;
    const validation = validateImage(next);
    if (validation) {
      onError(validation);
      return;
    }
    onError(null);
    onChange(next);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border transition ${
        dragging ? "border-violet-300 bg-violet-500/10" : "border-violet-400/25 bg-[#0b0d18]"
      }`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) acceptFile(event.dataTransfer.files?.[0] ?? null);
      }}
    >
      <div className="flex items-center justify-between border-b border-white/7 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="mt-0.5 text-[11px] text-white/35">{hint}</p>
        </div>
        {file ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300">
            <Check className="h-3 w-3" /> Subido
          </span>
        ) : (
          <CircleHelp className="h-4 w-4 text-white/25" />
        )}
      </div>

      {file && preview ? (
        <div className="p-3">
          <div className="grid min-h-56 place-items-center overflow-hidden rounded-xl border border-dashed border-violet-400/35 bg-white/[0.025] p-3">
            <img src={preview} alt={`${title} de la prenda`} className="max-h-52 w-full rounded-lg object-contain" />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/7 bg-white/[0.025] px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-white/75">{file.name}</p>
              <p className="mt-0.5 text-[10px] text-white/35">{formatBytes(file.size)}</p>
            </div>
            <ImagePlus className="h-4 w-4 shrink-0 text-violet-300" />
          </div>
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <label htmlFor={inputId} className="cursor-pointer rounded-xl border border-violet-400/40 bg-violet-500/10 px-3 py-2.5 text-center text-xs font-bold text-violet-100 transition hover:bg-violet-500/20 focus-within:ring-2 focus-within:ring-violet-400">
              Cambiar imagen
            </label>
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled}
              className="grid h-10 w-11 place-items-center rounded-xl border border-rose-400/25 bg-rose-500/10 text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40"
              aria-label={`Eliminar ${title.toLowerCase()}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <label htmlFor={inputId} className="grid min-h-72 cursor-pointer place-items-center p-5 text-center outline-none transition hover:bg-violet-500/[0.04] focus-within:ring-2 focus-within:ring-inset focus-within:ring-violet-400">
          <div>
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-violet-400/25 bg-violet-500/10 text-violet-200 shadow-[0_0_35px_rgba(139,92,246,0.15)]">
              <UploadCloud className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm font-bold text-white">Subir {title.toLowerCase()}</p>
            <p className="mx-auto mt-2 max-w-52 text-xs leading-relaxed text-white/40">Arrastrá una imagen o tocá para elegirla. PNG, JPG o WEBP hasta 8 MB.</p>
          </div>
        </label>
      )}

      <input
        id={inputId}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled}
        onChange={(event) => {
          acceptFile(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

function ArtInput({
  file,
  disabled,
  onChange,
  onError,
}: {
  file: File | null;
  disabled: boolean;
  onChange: (file: File | null) => void;
  onError: (message: string | null) => void;
}) {
  const preview = useObjectUrl(file);
  const inputId = "garment-art-reference";

  const acceptFile = (next: File | null) => {
    if (!next) return;
    const validation = validateImage(next);
    if (validation) {
      onError(validation);
      return;
    }
    onError(null);
    onChange(next);
  };

  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
      {file && preview ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="grid h-28 w-full shrink-0 place-items-center overflow-hidden rounded-xl border border-white/8 bg-black/30 p-2 sm:w-32">
            <img src={preview} alt="Arte o logo para la textura" className="max-h-24 max-w-full rounded-lg object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white/80">{file.name}</p>
            <p className="mt-1 text-xs text-white/35">{formatBytes(file.size)}</p>
            <div className="mt-3 flex gap-2">
              <label htmlFor={inputId} className="cursor-pointer rounded-xl border border-violet-400/35 bg-violet-500/10 px-4 py-2 text-xs font-bold text-violet-100 hover:bg-violet-500/20">
                Cambiar archivo
              </label>
              <button type="button" onClick={() => onChange(null)} disabled={disabled} className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-rose-300 hover:bg-rose-500/20" aria-label="Eliminar arte">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <label htmlFor={inputId} className="flex min-h-28 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-white/12 bg-white/[0.02] p-4 text-center transition hover:border-violet-400/40 hover:bg-violet-500/[0.04]">
          <ImagePlus className="h-5 w-5 text-violet-300" />
          <span className="text-sm font-medium text-white/65">Subir logo, portada o diseño</span>
        </label>
      )}
      <input
        id={inputId}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled}
        onChange={(event) => {
          acceptFile(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

export default function GarmentFlowClient() {
  const { user, session } = useAuth();
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const loadActiveAvatar = useActiveAvatarStore((state) => state.loadActiveAvatar);
  const avatarLoading = useActiveAvatarStore((state) => state.loading);

  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("hoodie");
  const [name, setName] = useState("");
  const [fit, setFit] = useState<(typeof FITS)[number]>("Oversized");
  const [color, setColor] = useState("#6d28d9");
  const [description, setDescription] = useState("");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [art, setArt] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    void loadActiveAvatar(user?.id ?? null);
  }, [loadActiveAvatar, user?.id]);

  const busy = ["creating", "preview", "refining", "rigging"].includes(phase);
  const hasReferencePair = Boolean(front && back);
  const hasIncompletePair = Boolean((front && !back) || (!front && back));

  const activeStep = useMemo(() => {
    if (phase === "done") return 4;
    if (["creating", "preview", "refining", "rigging"].includes(phase)) return 3;
    if (front || back) return 2;
    return 1;
  }, [back, front, phase]);

  const poll = async (taskId: string): Promise<MeshyStatus> => {
    const startedAt = Date.now();
    let consecutiveErrors = 0;

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);

      try {
        const response = await fetch(`/api/meshy/status?taskId=${encodeURIComponent(taskId)}&t=${Date.now()}`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as MeshyStatus;

        if (!response.ok || data.error) {
          throw new Error(data.error || `Meshy respondió ${response.status}`);
        }

        consecutiveErrors = 0;
        const status = String(data.status ?? "").toUpperCase();
        const reported = typeof data.progress === "number" ? Math.round(data.progress) : 0;
        setProgress(status === "SUCCEEDED" ? 100 : Math.max(0, Math.min(99, reported)));

        if (status === "SUCCEEDED") return { ...data, status };
        if (status === "FAILED" || status === "EXPIRED" || status === "CANCELED") return { ...data, status };
      } catch (statusError) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_STATUS_ERRORS) throw statusError;
      }
    }

    throw new Error("Meshy tardó más de 15 minutos. La tarea puede seguir activa; revisá Mis piezas en unos minutos.");
  };

  const generate3D = async () => {
    if (busy) return;
    setError(null);
    setProgress(0);

    try {
      if (!session?.access_token) throw new Error("Iniciá sesión para crear una pieza.");
      if (!avatar.modelUrl) throw new Error("No encontramos un avatar activo para adaptar la pieza.");
      if (hasIncompletePair) throw new Error("Para usar referencias necesitás subir la imagen de frente y la imagen de atrás.");
      if (!hasReferencePair && !description.trim()) throw new Error("Describí cómo querés la prenda o subí las vistas de frente y atrás.");

      for (const file of [front, back, art]) {
        if (!file) continue;
        const validation = validateImage(file);
        if (validation) throw new Error(validation);
      }

      setPhase("creating");
      const form = new FormData();
      form.append("category", category);
      form.append("name", name.trim() || "Prenda CLOUVA");
      form.append("fit", fit);
      form.append("color", color);
      form.append("description", description.trim());
      if (front && back) {
        form.append("front", front);
        form.append("back", back);
      }
      if (art) form.append("art", art);

      const createResponse = await fetch("/api/clothing/create", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const created = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok || created.error || !created.taskId || !created.item?.id) {
        throw new Error(readableError(created, `No se pudo iniciar Meshy (${createResponse.status}).`));
      }

      setPhase("preview");
      const preview = await poll(created.taskId);
      if (preview.status !== "SUCCEEDED") {
        throw new Error(preview.task_error?.message || preview.error || "Meshy no pudo crear la forma inicial.");
      }

      setPhase("refining");
      setProgress(0);
      const refineResponse = await fetch("/api/clothing/refine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ previewTaskId: created.taskId, itemId: created.item.id }),
      });
      const refinedTask = await refineResponse.json().catch(() => ({}));
      if (!refineResponse.ok || refinedTask.error || !refinedTask.taskId) {
        throw new Error(readableError(refinedTask, `No se pudo refinar la pieza (${refineResponse.status}).`));
      }

      const refined = await poll(refinedTask.taskId);
      if (refined.status !== "SUCCEEDED" || !refined.model_urls?.glb) {
        throw new Error(refined.task_error?.message || refined.error || "Meshy no pudo terminar la pieza o no devolvió un GLB.");
      }

      setPhase("rigging");
      setProgress(100);
      const saveResponse = await fetch("/api/clothing/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ itemId: created.item.id, modelUrl: refined.model_urls.glb }),
      });
      const saved = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok || saved.error || !saved.item?.model_url) {
        throw new Error(readableError(saved, `No se pudo guardar y adaptar la pieza (${saveResponse.status}).`));
      }

      setResult({
        id: saved.item.id,
        modelUrl: saved.item.model_url,
        rigged: saved.item.rigged,
        fitStatus: saved.item.fit_status,
      });
      setPhase("done");
      setProgress(100);
    } catch (cause) {
      setError(readableError(cause, "No se pudo completar la creación de la pieza."));
      setPhase("error");
    }
  };

  const reset = () => {
    setResult(null);
    setPhase("idle");
    setProgress(0);
    setError(null);
    setName("");
    setDescription("");
    setFront(null);
    setBack(null);
    setArt(null);
  };

  const phaseLabel =
    phase === "creating" ? (hasReferencePair ? "Enviando frente y atrás a Meshy…" : "Enviando diseño a Meshy…") :
    phase === "preview" && progress >= 99 ? "Meshy está cerrando la forma…" :
    phase === "preview" ? `Creando forma 3D… ${progress}%` :
    phase === "refining" && progress >= 99 ? "Meshy está terminando materiales…" :
    phase === "refining" ? `Agregando detalles y materiales… ${progress}%` :
    phase === "rigging" ? "CLOUVA está adaptando y riggeando la pieza…" :
    "Generar objeto 3D";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#070910] pb-28 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-45" style={{ backgroundImage: "linear-gradient(rgba(139,92,246,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.07) 1px, transparent 1px)", backgroundSize: "52px 52px" }} />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-violet-700/10 blur-[130px]" />

      <div className="relative mx-auto w-full max-w-[1280px] px-4 pb-16 pt-5 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/mi-flow/avatar" className="inline-flex items-center gap-2 text-sm font-medium text-white/55 transition hover:text-violet-200">
            <ArrowLeft className="h-4 w-4" /> Volver a mi flow
          </Link>
          <span className="rounded-full border border-violet-400/15 bg-violet-500/[0.06] px-3 py-1 text-[10px] font-black tracking-[0.18em] text-violet-200/80">GARMENT FLOW</span>
        </div>

        {!result ? (
          <>
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_230px]">
              <header className="py-4 text-center lg:pl-[230px]">
                <span className="mx-auto inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/[0.07] px-3 py-1 text-[11px] font-bold text-violet-200">
                  <Sparkles className="h-3.5 w-3.5" /> CREADOR 3D CLOUVA
                </span>
                <h1 className="mt-4 text-3xl font-black tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl">Crear una prenda para tu avatar</h1>
                <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/50 sm:text-base">
                  Subí referencias de frente y espalda para generar una pieza 3D lista para adaptar a tu avatar y exportar después a Unreal.
                </p>
              </header>

              <aside className="overflow-hidden rounded-2xl border border-violet-400/35 bg-gradient-to-b from-violet-950/70 to-[#0a0b13] shadow-[0_0_45px_rgba(124,58,237,0.12)]">
                <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
                  <span className="inline-flex items-center gap-2 text-[10px] font-black tracking-[0.12em] text-violet-100"><span className="h-2 w-2 rounded-full bg-emerald-400" /> AVATAR ACTIVO</span>
                  <span className="max-w-24 truncate text-[9px] text-white/30">{avatar.id}</span>
                </div>
                <div className="h-52 bg-black/25">
                  {avatarLoading ? (
                    <div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin text-violet-300" /></div>
                  ) : (
                    <OutfitPreview avatarUrl={avatar.modelUrl} layers={[]} className="h-full w-full" />
                  )}
                </div>
                <Link href="/mi-flow/avatar" className="m-3 flex items-center justify-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 py-2.5 text-xs font-bold text-violet-100 transition hover:bg-violet-500/20">
                  Ver avatar 3D <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </aside>
            </div>

            <section className="mt-7 rounded-3xl border border-violet-400/20 bg-[#0d0e18]/90 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.35)] sm:p-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {STEPS.map((step, index) => {
                  const selected = step.number === activeStep;
                  const complete = step.number < activeStep;
                  return (
                    <div key={step.number} className={`relative rounded-2xl border px-4 py-4 transition ${selected ? "border-violet-400/60 bg-violet-500/10" : complete ? "border-emerald-400/20 bg-emerald-500/[0.04]" : "border-white/8 bg-white/[0.02]"}`}>
                      {index < STEPS.length - 1 ? <span className="absolute -right-3 top-1/2 z-10 hidden h-px w-6 bg-gradient-to-r from-violet-500/60 to-transparent lg:block" /> : null}
                      <div className="flex items-center gap-3">
                        <span className={`grid h-9 w-9 place-items-center rounded-full border text-sm font-black ${complete ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" : selected ? "border-violet-300 bg-violet-500/20 text-white" : "border-white/10 bg-black/20 text-white/35"}`}>
                          {complete ? <Check className="h-4 w-4" /> : step.number}
                        </span>
                        <div>
                          <p className={`text-sm font-bold ${selected || complete ? "text-white" : "text-white/45"}`}>{step.title}</p>
                          <p className="mt-0.5 text-[11px] text-white/30">{step.caption}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="mt-5 space-y-4">
              <section className="rounded-3xl border border-violet-400/18 bg-[#0d0e18]/90 p-5 sm:p-6">
                <SectionHeader number={1} title="Tipo de prenda" description="Elegí qué querés crear. La categoría se conserva durante todo el pipeline." />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {CATEGORIES.map((item) => {
                    const selected = category === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setCategory(item.value)}
                        disabled={busy}
                        aria-pressed={selected}
                        className={`group min-h-28 rounded-2xl border p-3 text-center outline-none transition focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-45 ${selected ? "border-violet-400 bg-gradient-to-b from-violet-500/20 to-violet-500/[0.06] shadow-[0_0_30px_rgba(124,58,237,0.12)]" : "border-white/8 bg-white/[0.02] hover:border-violet-400/30 hover:bg-violet-500/[0.05]"}`}
                      >
                        <span className="text-3xl grayscale-[0.2] transition group-hover:scale-105">{item.glyph}</span>
                        <span className={`mt-2 block text-xs font-bold ${selected ? "text-white" : "text-white/65"}`}>{item.label}</span>
                        <span className="mt-1 block text-[10px] text-white/30">{item.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-3xl border border-violet-400/18 bg-[#0d0e18]/90 p-5 sm:p-6">
                <SectionHeader number={2} title="Datos de la prenda" description="Información básica que acompaña la pieza en tu Biblioteca." />
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_180px_minmax(300px,0.8fr)]">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold text-white/55">Nombre de la prenda</span>
                    <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={busy} placeholder="Ej: Buzo Oversized CLOUVA V1" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-violet-400/55 focus:ring-2 focus:ring-violet-500/10" />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold text-white/55">Color principal</span>
                    <span className="flex h-12 items-center gap-3 rounded-xl border border-white/10 bg-black/25 px-3">
                      <input type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={busy} className="h-8 w-12 cursor-pointer rounded-lg border-0 bg-transparent" aria-label="Color principal" />
                      <span className="text-xs font-medium uppercase text-white/45">{color}</span>
                    </span>
                  </label>

                  <fieldset>
                    <legend className="mb-2 text-xs font-semibold text-white/55">Ajuste / fit</legend>
                    <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
                      {FITS.map((item) => (
                        <button key={item} type="button" onClick={() => setFit(item)} disabled={busy} aria-pressed={fit === item} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${fit === item ? "border-violet-400 bg-violet-500/15 text-white" : "border-white/10 text-white/50 hover:border-violet-400/30"}`}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </section>

              <section className="rounded-3xl border border-violet-400/18 bg-[#0d0e18]/90 p-5 sm:p-6">
                <SectionHeader number={3} title="Descripción creativa" description="Contanos cómo es tu prenda, sus materiales, detalles y estilo. Esto guía la generación 3D." />
                <div className="relative">
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={800} disabled={busy} rows={5} placeholder="Ej: buzo negro oversized con mangas anchas, capucha profunda, costuras violetas, bolsillo canguro y estética futurista urbana." className="w-full resize-y rounded-2xl border border-white/10 bg-black/25 p-4 pb-9 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-violet-400/55 focus:ring-2 focus:ring-violet-500/10" />
                  <span className="absolute bottom-3 right-4 text-[10px] text-white/30">{description.length} / 800</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-[11px] font-semibold text-white/35">Tips:</span>
                  {CREATIVE_TIPS.map((tip) => <span key={tip} className="rounded-full border border-violet-400/15 bg-violet-500/[0.05] px-3 py-1.5 text-[11px] text-violet-100/65">{tip}</span>)}
                </div>
              </section>

              <section className="rounded-3xl border border-violet-400/30 bg-gradient-to-b from-[#111225] to-[#0b0c16] p-5 shadow-[0_0_60px_rgba(124,58,237,0.08)] sm:p-6">
                <SectionHeader number={4} title="Referencias de forma 3D" description="Subí la misma pieza vista de frente y de espalda. Las dos imágenes deben mostrarla completa, centrada y con una escala similar." />

                <div className="grid gap-5 lg:grid-cols-[245px_minmax(0,1fr)]">
                  <aside className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <p className="text-sm font-bold text-white/80">Recomendaciones</p>
                    <div className="mt-4 space-y-3">
                      {["Fondo liso o limpio", "Objeto completo y centrado", "Misma escala en ambas vistas", "Evitar personas y elementos extra", "Buena iluminación y contraste"].map((tip) => (
                        <div key={tip} className="flex items-start gap-2.5 text-xs leading-relaxed text-white/50">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> {tip}
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 rounded-xl border border-violet-400/15 bg-violet-500/[0.05] p-3 text-[11px] leading-relaxed text-violet-100/60">
                      Las dos vistas viajan juntas a Meshy. Una sola referencia no inicia la generación.
                    </div>
                  </aside>

                  <div className="grid gap-4 md:grid-cols-2">
                    <ReferenceInput side="front" file={front} disabled={busy} onChange={setFront} onError={setError} />
                    <ReferenceInput side="back" file={back} disabled={busy} onChange={setBack} onError={setError} />
                  </div>
                </div>

                {hasIncompletePair ? <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">Para usar referencias necesitás subir la imagen de frente y la imagen de atrás.</p> : null}
                {hasReferencePair ? <p className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4" /> Listo: Meshy recibirá frente + espalda como referencias de forma.</p> : null}
              </section>

              <section className="rounded-3xl border border-violet-400/18 bg-[#0d0e18]/90 p-5 sm:p-6">
                <SectionHeader number={5} title="Arte o logo opcional" description="Subí un logo, portada o diseño para aplicarlo como textura. No define la forma 3D ni modifica la geometría." />
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <ArtInput file={art} disabled={busy} onChange={setArt} onError={setError} />
                  <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.05] p-4">
                    <div className="flex gap-3">
                      <CircleHelp className="h-5 w-5 shrink-0 text-violet-300" />
                      <div>
                        <p className="text-sm font-bold text-white/80">¿Qué pasa con este archivo?</p>
                        <p className="mt-2 text-xs leading-6 text-white/45">Se guarda como fuente de textura y Blender puede aplicarlo cuando adapta la pieza. No reemplaza las referencias de frente y espalda.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-violet-400/18 bg-[#0d0e18]/90 p-5 sm:p-6">
                <div className="mb-5 flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-300"><Workflow className="h-5 w-5" /></span>
                  <div>
                    <h2 className="text-lg font-bold">Resultado esperado</h2>
                    <p className="mt-1 text-sm text-white/40">Esto es lo que hará CLOUVA con tu pedido.</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  {[
                    ["Meshy genera la pieza 3D", "Usando referencias y descripción."],
                    ["CLOUVA la adapta al avatar", "Ajusta escala, posición y compatibilidad."],
                    ["Se guarda en tu Biblioteca", "Lista para usar, editar y combinar."],
                    ["Queda lista para Unreal", "El exportador genera el FBX con escala 1."],
                  ].map(([title, caption], index) => (
                    <div key={title} className="relative rounded-2xl border border-white/8 bg-white/[0.025] p-4">
                      {index < 3 ? <span className="absolute -right-2 top-1/2 z-10 hidden text-violet-400 md:block">→</span> : null}
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/10 text-violet-300">{index === 0 ? <WandSparkles className="h-4 w-4" /> : index === 1 ? <Sparkles className="h-4 w-4" /> : index === 2 ? <PackageCheck className="h-4 w-4" /> : <Box className="h-4 w-4" />}</span>
                      <p className="mt-3 text-sm font-bold text-white/80">{title}</p>
                      <p className="mt-2 text-xs leading-5 text-white/35">{caption}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="pt-2 text-center">
                <button type="button" onClick={() => void generate3D()} disabled={busy || hasIncompletePair || !session?.access_token} className="mx-auto flex min-h-16 w-full max-w-3xl items-center justify-center gap-3 rounded-2xl border border-violet-300/30 bg-gradient-to-r from-violet-700 via-violet-600 to-indigo-600 px-6 text-lg font-black text-white shadow-[0_18px_55px_rgba(109,40,217,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_65px_rgba(109,40,217,0.38)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0">
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <WandSparkles className="h-5 w-5" />}
                  {phaseLabel}
                </button>
                <p className="mt-3 text-xs text-white/35">{hasReferencePair ? "Se enviará a Meshy usando frente + espalda + descripción." : "Sin referencias, Meshy usará la descripción para crear la forma inicial."}</p>

                {busy ? (
                  <div className="mx-auto mt-5 max-w-3xl">
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className={`h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all duration-500 ${progress >= 99 ? "animate-pulse" : ""}`} style={{ width: `${Math.max(6, progress)}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-white/40">{phaseLabel}{progress >= 99 ? " Puede tardar unos minutos mientras Meshy empaqueta el modelo." : ""}</p>
                  </div>
                ) : null}

                {error ? <div role="alert" className="mx-auto mt-5 max-w-3xl rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-left text-sm leading-relaxed text-rose-200">{error}</div> : null}
              </section>
            </div>
          </>
        ) : (
          <section className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-emerald-400/20 bg-[#0d0e18]/95 p-5 shadow-[0_25px_90px_rgba(0,0,0,0.45)] sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4" /> PIPELINE COMPLETADO</span>
                <h1 className="mt-3 text-3xl font-black">Prenda 3D lista</h1>
                <p className="mt-2 text-sm text-white/45">Quedó guardada en tus piezas y ya puede aparecer en Biblioteca para exportarla como FBX.</p>
              </div>
              <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${result.rigged ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300" : "border-amber-400/25 bg-amber-500/10 text-amber-200"}`}>
                {result.rigged ? "Adaptada y riggeada" : "Guardada con ajuste visual"}
              </span>
            </div>

            <div className="mt-6 h-[520px] overflow-hidden rounded-2xl border border-white/10 bg-black/40">
              <OutfitPreview avatarUrl={avatar.modelUrl} layers={[{ id: result.id, url: result.modelUrl, visible: true, category, preFitted: result.fitStatus === "fitted" && result.rigged === true }]} />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Link href="/biblioteca#unreal-objects" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-center text-sm font-bold text-white"><Box className="h-4 w-4" /> Ir a Biblioteca y exportar</Link>
              <Link href="/mi-flow/armario" className="flex min-h-12 items-center justify-center rounded-xl border border-white/12 bg-white/[0.03] px-4 text-center text-sm font-bold text-white/75 hover:border-violet-400/30">Ver en mis piezas</Link>
              <button type="button" onClick={reset} className="min-h-12 rounded-xl border border-white/12 bg-white/[0.03] px-4 text-sm font-bold text-white/75 hover:border-violet-400/30">Crear otra pieza</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
