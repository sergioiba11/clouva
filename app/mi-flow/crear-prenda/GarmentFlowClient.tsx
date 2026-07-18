"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  ImagePlus,
  Loader2,
  PackageCheck,
  Palette,
  RefreshCw,
  Shirt,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { OutfitPreview } from "@/components/avatar-engine/OutfitPreview";

const CATEGORIES = [
  ["hoodie", "Buzo", "🧥"],
  ["shirt", "Remera", "👕"],
  ["jacket", "Campera", "🥋"],
  ["pants", "Pantalón baggy", "👖"],
  ["shorts", "Short", "🩳"],
  ["shoes", "Zapatillas", "👟"],
  ["accessory", "Accesorio", "⛓️"],
] as const;

const FITS = ["Entallado", "Normal", "Oversized", "Baggy"];
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_STATUS_ERRORS = 5;
const MAX_DESCRIPTION = 800;

type Phase = "idle" | "creating" | "preview" | "refining" | "rigging" | "done" | "error";

type MeshyStatus = {
  status?: string;
  progress?: number;
  model_urls?: { glb?: string };
  task_error?: { message?: string };
  error?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Step({ number, title, subtitle, active, complete }: { number: number; title: string; subtitle: string; active: boolean; complete: boolean }) {
  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-3">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-sm font-black transition ${complete ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-200" : active ? "border-violet-300 bg-violet-500/25 text-white shadow-[0_0_30px_rgba(139,92,246,.35)]" : "border-white/10 bg-white/[0.03] text-white/35"}`}>
        {complete ? <Check className="h-4 w-4" /> : number}
      </div>
      <div className="min-w-0">
        <p className={`truncate text-sm font-semibold ${active || complete ? "text-white" : "text-white/40"}`}>{title}</p>
        <p className="truncate text-xs text-white/35">{subtitle}</p>
      </div>
    </div>
  );
}

function SectionTitle({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-violet-400/60 bg-violet-500/10 text-sm font-black text-violet-200">{number}</span>
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-white/45">{description}</p>
      </div>
    </div>
  );
}

function ReferenceInput({
  label,
  hint,
  file,
  preview,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  file: File | null;
  preview: string | null;
  disabled: boolean;
  onChange: (file: File | null) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const acceptFile = (next: File | undefined) => {
    if (!next) return;
    if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(next.type)) return;
    onChange(next);
  };

  return (
    <div className={`rounded-2xl border p-3 transition ${dragging ? "border-violet-300 bg-violet-500/10" : "border-violet-400/20 bg-black/25"}`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-0.5 text-xs text-white/40">{hint}</p>
        </div>
        {file ? <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-bold text-emerald-300">SUBIDO</span> : null}
      </div>

      <label
        className="flex min-h-64 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 bg-white/[0.025] p-4 text-center transition hover:border-violet-400/60"
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          acceptFile(event.dataTransfer.files?.[0]);
        }}
      >
        {preview ? (
          <img src={preview} alt={label} className="h-52 w-full rounded-lg object-contain" />
        ) : (
          <>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><UploadCloud /></span>
            <strong className="mt-4 text-sm">Arrastrá o elegí una imagen</strong>
            <span className="mt-1 text-xs text-white/35">PNG, JPG o WEBP · máximo 8 MB</span>
          </>
        )}
        <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={(event) => acceptFile(event.target.files?.[0])} />
      </label>

      {file ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-white/60">{file.name}</span>
          <span className="text-white/35">{formatBytes(file.size)}</span>
          <label className="cursor-pointer rounded-lg border border-white/10 px-3 py-2 text-white/70 hover:border-violet-400/50">
            Cambiar imagen
            <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={(event) => acceptFile(event.target.files?.[0])} />
          </label>
          <button type="button" onClick={() => onChange(null)} disabled={disabled} className="rounded-lg border border-rose-400/20 p-2 text-rose-300 hover:bg-rose-400/10" aria-label={`Eliminar ${label}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function GarmentFlowClient() {
  const { session } = useAuth();
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const [category, setCategory] = useState("hoodie");
  const [name, setName] = useState("");
  const [fit, setFit] = useState("Oversized");
  const [color, setColor] = useState("#0a0a0a");
  const [description, setDescription] = useState("");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [art, setArt] = useState<File | null>(null);
  const [artPreview, setArtPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; modelUrl: string; rigged?: boolean; fitStatus?: string } | null>(null);

  const busy = ["creating", "preview", "refining", "rigging"].includes(phase);
  const hasReferencePair = Boolean(front && back);
  const hasIncompletePair = Boolean((front && !back) || (!front && back));

  useEffect(() => () => {
    if (frontPreview) URL.revokeObjectURL(frontPreview);
    if (backPreview) URL.revokeObjectURL(backPreview);
    if (artPreview) URL.revokeObjectURL(artPreview);
  }, [frontPreview, backPreview, artPreview]);

  const updateReference = (side: "front" | "back", file: File | null) => {
    if (side === "front") {
      if (frontPreview) URL.revokeObjectURL(frontPreview);
      setFront(file);
      setFrontPreview(file ? URL.createObjectURL(file) : null);
    } else {
      if (backPreview) URL.revokeObjectURL(backPreview);
      setBack(file);
      setBackPreview(file ? URL.createObjectURL(file) : null);
    }
  };

  const updateArt = (file: File | null) => {
    if (artPreview) URL.revokeObjectURL(artPreview);
    setArt(file);
    setArtPreview(file ? URL.createObjectURL(file) : null);
  };

  const currentStep = useMemo(() => {
    if (phase === "done") return 4;
    if (["creating", "preview", "refining", "rigging"].includes(phase)) return 3;
    if (hasReferencePair) return 2;
    return 1;
  }, [hasReferencePair, phase]);

  const poll = async (taskId: string): Promise<MeshyStatus> => {
    const startedAt = Date.now();
    let consecutiveErrors = 0;
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const response = await fetch(`/api/meshy/status?taskId=${encodeURIComponent(taskId)}&t=${Date.now()}`, { cache: "no-store" });
        const data = (await response.json()) as MeshyStatus;
        if (!response.ok || data.error) throw new Error(data.error || `Meshy respondió ${response.status}`);
        consecutiveErrors = 0;
        const status = String(data.status ?? "").toUpperCase();
        const reported = typeof data.progress === "number" ? Math.round(data.progress) : 0;
        setProgress(status === "SUCCEEDED" ? 100 : Math.max(0, Math.min(99, reported)));
        if (status === "SUCCEEDED") return { ...data, status };
        if (status === "FAILED" || status === "EXPIRED") return { ...data, status };
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
      if (!session?.access_token) throw new Error("Iniciá sesión.");
      if (!avatar.modelUrl) throw new Error("No hay un avatar activo.");
      if (hasIncompletePair) throw new Error("Para usar referencias necesitás subir la imagen de frente y la imagen de atrás.");
      if (!hasReferencePair && !description.trim()) throw new Error("Describí cómo querés la prenda o subí las vistas de frente y atrás.");

      setPhase("creating");
      const form = new FormData();
      form.append("category", category);
      form.append("name", name || "Prenda CLOUVA");
      form.append("fit", fit);
      form.append("color", color);
      form.append("description", description.trim());
      if (front && back) { form.append("front", front); form.append("back", back); }
      if (art) form.append("art", art);

      const createResponse = await fetch("/api/clothing/create", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: form });
      const created = await createResponse.json();
      if (!createResponse.ok || created.error) throw new Error(created.error || "No se pudo iniciar Meshy.");

      setPhase("preview");
      const preview = await poll(created.taskId);
      if (preview.status !== "SUCCEEDED") throw new Error(preview.task_error?.message || "Meshy no pudo crear la forma inicial.");

      setPhase("refining");
      setProgress(0);
      const refineResponse = await fetch("/api/clothing/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ previewTaskId: created.taskId, itemId: created.item.id }),
      });
      const refinedTask = await refineResponse.json();
      if (!refineResponse.ok || refinedTask.error) throw new Error(refinedTask.error || "No se pudo refinar la prenda.");

      const refined = await poll(refinedTask.taskId);
      if (refined.status !== "SUCCEEDED" || !refined.model_urls?.glb) throw new Error(refined.task_error?.message || "Meshy no pudo terminar la prenda.");

      setPhase("rigging");
      setProgress(100);
      const saveResponse = await fetch("/api/clothing/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ itemId: created.item.id, modelUrl: refined.model_urls.glb }),
      });
      const saved = await saveResponse.json();
      if (!saveResponse.ok || saved.error || !saved.item?.model_url) throw new Error(saved.error || "No se pudo guardar y riggear la prenda.");

      setResult({ id: saved.item.id, modelUrl: saved.item.model_url, rigged: saved.item.rigged, fitStatus: saved.item.fit_status });
      setPhase("done");
      setProgress(100);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la generación.");
      setPhase("error");
    }
  };

  const phaseLabel = phase === "creating" ? (hasReferencePair ? "Enviando frente y atrás a Meshy…" : "Enviando diseño a Meshy…") : phase === "preview" && progress >= 99 ? "Meshy está cerrando la forma…" : phase === "preview" ? `Creando forma 3D… ${progress}%` : phase === "refining" && progress >= 99 ? "Meshy está terminando materiales…" : phase === "refining" ? `Agregando detalles y materiales… ${progress}%` : phase === "rigging" ? "Adaptando, texturizando y riggeando…" : "Generar objeto 3D";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-10%,rgba(124,58,237,.16),transparent_36%),linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] bg-[size:auto,32px_32px,32px_32px] px-4 pb-28 pt-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/mi-flow/avatar" className="text-sm text-violet-200 hover:text-white">← Volver a mi flow</Link>
          <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-[10px] font-bold tracking-[0.22em] text-violet-200">GARMENT FLOW</span>
        </div>

        {!result ? (
          <>
            <div className="mb-6 grid gap-5 lg:grid-cols-[1fr_240px] lg:items-stretch">
              <section className="flex flex-col justify-center rounded-3xl border border-violet-400/20 bg-[#0e0b18]/90 p-6 shadow-2xl backdrop-blur sm:p-8">
                <p className="mb-3 text-xs font-black tracking-[0.2em] text-violet-300">CLOUVA CREATOR</p>
                <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">Crear una prenda para tu avatar</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-white/50 sm:text-base">Subí referencias de frente y espalda para generar una pieza 3D lista para adaptar a tu avatar y exportar después a Unreal.</p>
              </section>

              <aside className="overflow-hidden rounded-3xl border border-violet-400/30 bg-[#130c24]/95 p-3 shadow-2xl">
                <div className="mb-2 flex items-center justify-between px-2">
                  <span className="text-[10px] font-black tracking-[0.16em] text-emerald-300">● AVATAR ACTIVO</span>
                  <RefreshCw className="h-4 w-4 text-white/35" />
                </div>
                <div className="h-52 overflow-hidden rounded-2xl border border-white/5 bg-black/40">
                  {avatar.modelUrl ? <OutfitPreview avatarUrl={avatar.modelUrl} layers={[]} /> : <div className="grid h-full place-items-center text-xs text-white/35">Sin avatar activo</div>}
                </div>
                <Link href="/mi-flow/avatar" className="mt-3 block rounded-xl border border-white/10 py-2 text-center text-xs font-semibold text-white/70 hover:border-violet-400/50">Ver avatar 3D</Link>
              </aside>
            </div>

            <section className="mb-6 rounded-3xl border border-violet-400/20 bg-[#0e0b18]/90 p-5 shadow-2xl sm:p-6">
              <div className="grid gap-4 md:grid-cols-4">
                <Step number={1} title="Definí la prenda" subtitle="Tipo, nombre y estilo" active={currentStep === 1} complete={currentStep > 1} />
                <Step number={2} title="Subí referencias" subtitle="Frente y espalda" active={currentStep === 2} complete={currentStep > 2} />
                <Step number={3} title="Generá el objeto 3D" subtitle="Meshy + CLOUVA" active={currentStep === 3} complete={currentStep > 3} />
                <Step number={4} title="Exportá a Unreal" subtitle="FBX con escala 1" active={currentStep === 4} complete={false} />
              </div>
            </section>

            <div className="space-y-5">
              <section className="rounded-3xl border border-violet-400/20 bg-[#0e0b18]/90 p-5 shadow-2xl sm:p-6">
                <SectionTitle number={1} title="Tipo de prenda" description="Elegí qué querés crear." />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {CATEGORIES.map(([value, label, icon]) => (
                    <button key={value} type="button" onClick={() => setCategory(value)} aria-pressed={category === value} className={`group min-h-28 rounded-2xl border p-3 text-center transition focus:outline-none focus:ring-2 focus:ring-violet-400 ${category === value ? "border-violet-300 bg-violet-500/15 shadow-[0_0_25px_rgba(124,58,237,.2)]" : "border-white/10 bg-white/[0.025] hover:border-violet-400/40"}`}>
                      <span className="block text-3xl transition group-hover:scale-105">{icon}</span>
                      <span className="mt-3 block text-sm font-semibold">{label}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-violet-400/20 bg-[#0e0b18]/90 p-5 shadow-2xl sm:p-6">
                <SectionTitle number={2} title="Datos de la prenda" description="Información básica de tu pieza." />
                <div className="grid gap-4 lg:grid-cols-[1fr_180px_1.2fr]">
                  <label className="block">
                    <span className="mb-2 block text-xs font-medium text-white/50">Nombre de la prenda</span>
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej: Buzo Oversized CLOUVA V1" className="h-12 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-violet-400/60" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-medium text-white/50">Color principal</span>
                    <span className="flex h-12 items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3">
                      <input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent" />
                      <span className="text-xs uppercase text-white/45">{color}</span>
                    </span>
                  </label>
                  <div>
                    <span className="mb-2 block text-xs font-medium text-white/50">Ajuste / fit</span>
                    <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-2">
                      {FITS.map((item) => <button key={item} type="button" onClick={() => setFit(item)} className={`rounded-full border px-3 py-1.5 text-xs transition ${fit === item ? "border-violet-300 bg-violet-500/20 text-white" : "border-white/10 text-white/50 hover:text-white"}`}>{item}</button>)}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-violet-400/20 bg-[#0e0b18]/90 p-5 shadow-2xl sm:p-6">
                <SectionTitle number={3} title="Descripción creativa" description="Contanos cómo es tu prenda, sus materiales, detalles y estilo." />
                <div className="relative">
                  <textarea value={description} maxLength={MAX_DESCRIPTION} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="Ej: buzo negro oversized con mangas anchas, capucha profunda, costuras violetas, bolsillo canguro y estética futurista urbana." className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 pb-9 text-sm leading-6 outline-none focus:border-violet-400/60" />
                  <span className="absolute bottom-3 right-4 text-[10px] text-white/30">{description.length}/{MAX_DESCRIPTION}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/50">
                  {["Describí la silueta", "Agregá detalles visibles", "Mencioná materiales", "Indicá el estilo general"].map((tip) => <span key={tip} className="rounded-full border border-violet-400/15 bg-violet-500/[0.06] px-3 py-1.5">{tip}</span>)}
                </div>
              </section>

              <section className="rounded-3xl border border-violet-400/30 bg-[#110c1f]/95 p-5 shadow-[0_0_50px_rgba(76,29,149,.12)] sm:p-6">
                <SectionTitle number={4} title="Referencias de forma 3D" description="Subí la misma pieza vista de frente y de espalda. Ambas imágenes deben mostrarla completa, centrada y con una escala similar." />
                <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
                  <aside className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-sm font-semibold">Recomendaciones</p>
                    <ul className="mt-4 space-y-3 text-xs text-white/55">
                      {["Fondo liso o limpio", "Objeto completo y centrado", "Misma escala en ambas vistas", "Evitar personas y elementos extra", "Buena iluminación y contraste"].map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />{item}</li>)}
                    </ul>
                  </aside>
                  <div className="grid gap-4 md:grid-cols-2">
                    <ReferenceInput label="Imagen de frente" hint="Vista recta desde adelante" file={front} preview={frontPreview} disabled={busy} onChange={(file) => updateReference("front", file)} />
                    <ReferenceInput label="Imagen de atrás" hint="La misma pieza desde atrás" file={back} preview={backPreview} disabled={busy} onChange={(file) => updateReference("back", file)} />
                  </div>
                </div>
                {hasIncompletePair ? <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">Para usar referencias necesitás subir la imagen de frente y la imagen de atrás.</p> : null}
                {hasReferencePair ? <p className="mt-4 flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />Listo: Meshy usará frente + espalda.</p> : null}
              </section>

              <section className="rounded-3xl border border-violet-400/20 bg-[#0e0b18]/90 p-5 shadow-2xl sm:p-6">
                <SectionTitle number={5} title="Arte o logo opcional" description="Se usa como arte para la textura. No define la forma 3D ni modifica la geometría." />
                <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                  <label className="flex min-h-36 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-white/15 bg-black/25 p-4 text-center hover:border-violet-400/50">
                    {artPreview ? <img src={artPreview} alt="Arte para la prenda" className="max-h-40 rounded-xl object-contain" /> : <div><ImagePlus className="mx-auto text-violet-300" /><p className="mt-3 text-sm font-semibold">Subir logo, portada o diseño</p><p className="mt-1 text-xs text-white/35">PNG, JPG o WEBP</p></div>}
                    <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => updateArt(event.target.files?.[0] ?? null)} />
                  </label>
                  <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.05] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold"><Palette className="h-4 w-4 text-violet-300" />¿Qué pasa con este archivo?</div>
                    <p className="mt-3 text-xs leading-5 text-white/45">Se aplicará como textura o arte visual una vez generada la malla. No cambia la forma del objeto.</p>
                    {art ? <div className="mt-4 flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs text-white/60">{art.name} · {formatBytes(art.size)}</span><button type="button" onClick={() => updateArt(null)} className="rounded-lg border border-rose-400/20 p-2 text-rose-300"><Trash2 className="h-4 w-4" /></button></div> : null}
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-violet-400/20 bg-[#0e0b18]/90 p-5 shadow-2xl sm:p-6">
                <div className="grid gap-4 lg:grid-cols-[220px_1fr] lg:items-center">
                  <div>
                    <h2 className="text-lg font-semibold">Resultado esperado</h2>
                    <p className="mt-2 text-sm text-white/45">Esto es lo que hará CLOUVA con tu pedido.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      [<Sparkles key="a" />, "Meshy genera la pieza 3D", "Usa referencias y descripción."],
                      [<Shirt key="b" />, "CLOUVA la adapta", "Ajusta escala, posición y compatibilidad."],
                      [<PackageCheck key="c" />, "Se guarda en Biblioteca", "Queda lista para usar y editar."],
                      [<Box key="d" />, "Lista para Unreal", "Generamos el FBX con escala 1."],
                    ].map(([icon, title, text]) => <div key={String(title)} className="rounded-2xl border border-white/10 bg-black/25 p-4"><span className="text-violet-300">{icon}</span><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-white/40">{text}</p></div>)}
                  </div>
                </div>
              </section>

              <div className="mx-auto max-w-3xl pt-2">
                <button type="button" onClick={() => void generate3D()} disabled={busy || hasIncompletePair} className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-violet-700 via-violet-500 to-violet-700 px-5 text-lg font-black shadow-[0_0_40px_rgba(124,58,237,.3)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{phaseLabel}
                </button>
                <p className="mt-3 text-center text-xs text-white/40">Se enviará a Meshy usando frente + espalda + descripción.</p>
                {busy ? <div className="mt-4"><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full bg-violet-400 transition-all ${progress >= 99 ? "animate-pulse" : ""}`} style={{ width: `${Math.max(6, progress)}%` }} /></div>{progress >= 99 ? <p className="mt-2 text-center text-xs text-white/45">El 99% puede tardar unos minutos mientras Meshy empaqueta el modelo.</p> : null}</div> : null}
                {error ? <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</p> : null}
              </div>
            </div>
          </>
        ) : (
          <section className="mx-auto max-w-5xl rounded-3xl border border-violet-400/25 bg-[#0e0b18]/95 p-5 shadow-2xl sm:p-7">
            <div className="mb-5 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300"><CheckCircle2 /></span><div><h1 className="text-2xl font-semibold">Prenda 3D lista</h1><p className="text-sm text-white/45">Quedó guardada en tus piezas y ya está disponible para Biblioteca y Unreal.</p></div></div>
            <div className="h-[520px] overflow-hidden rounded-2xl border border-white/10 bg-black/40"><OutfitPreview avatarUrl={avatar.modelUrl} layers={[{ id: result.id, url: result.modelUrl, visible: true, category, preFitted: result.fitStatus === "fitted" && result.rigged === true }]} /></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Link href="/biblioteca#unreal-objects" className="flex items-center justify-center gap-2 rounded-2xl bg-violet-500 py-3 text-center text-sm font-semibold text-white">Ir a Biblioteca y exportar <ChevronRight className="h-4 w-4" /></Link>
              <Link href="/mi-flow/armario" className="rounded-2xl border border-white/15 py-3 text-center text-sm">Ver en mis piezas</Link>
              <button type="button" onClick={() => { setResult(null); setPhase("idle"); setProgress(0); }} className="rounded-2xl border border-white/15 py-3 text-sm">Crear otra pieza</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
