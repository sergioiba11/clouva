"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Loader2,
  Move3d,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import {
  SmartTryOnViewer,
  type AnchorBoneKey,
  type TryOnAdjustments,
} from "@/components/creator-studio/SmartTryOnViewer";
import { ReferenceAssetLibrary } from "@/components/creator-studio/ReferenceAssetLibrary";
import { ResultRigPreview } from "@/components/creator-studio/ResultRigPreview";
import {
  markReferenceAssetError,
  saveRiggedReferenceAsset,
  setReferenceAssetProcessing,
  type ReferenceAsset,
  type ReferenceCategory,
} from "@/lib/creator-studio/reference-assets";
import { resolveRigProfile } from "@/lib/creator-studio/rig-profiles";

type Step = "asset" | "fit" | "rig" | "result";
type Fit = "Slim" | "Regular" | "Oversize";
type Pose = "T-Pose" | "Idle" | "Walk";
type View = "Frente" | "Lateral" | "Espalda";
type Side = "left" | "right";

type JobStatusResponse = {
  status?: string;
  progress?: number;
  stage?: string | null;
  resultUrl?: string | null;
  error?: string | null;
};

const DONE = new Set(["completed", "complete", "finished", "done", "success", "succeeded"]);
const FAILED = new Set(["failed", "error", "cancelled", "canceled"]);

const initialAdjustments: TryOnAdjustments = {
  scale: 100,
  length: 100,
  width: 100,
  x: 0,
  y: 0,
  rotation: 0,
  height: 0,
  distance: 8,
  sleeveLength: 100,
  legLength: 100,
  waistHeight: 50,
  neckSize: 50,
  hoodSize: 50,
};

const STEPS: Array<{ id: Step; label: string; short: string }> = [
  { id: "asset", label: "Elegir modelo", short: "Modelo" },
  { id: "fit", label: "Ajustar al cuerpo", short: "Ajuste" },
  { id: "rig", label: "Aplicar rig", short: "Rig" },
  { id: "result", label: "Resultado", short: "Listo" },
];

function anchorFor(category: string, side: Side): AnchorBoneKey | null {
  const profile = resolveRigProfile(category);
  if (profile.sided) return side === "left" ? "leftHand" : "rightHand";
  return profile.anchorKey as AnchorBoneKey | null;
}

function percent(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

export function CreatorStudioPro() {
  const [step, setStep] = useState<Step>("asset");
  const [asset, setAsset] = useState<ReferenceAsset | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [category, setCategory] = useState<ReferenceCategory>("hoodie");
  const [fit, setFit] = useState<Fit>("Regular");
  const [pose, setPose] = useState<Pose>("Idle");
  const [view, setView] = useState<View>("Frente");
  const [side, setSide] = useState<Side>("right");
  const [adjustments, setAdjustments] = useState<TryOnAdjustments>(initialAdjustments);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Elegí un GLB para comenzar.");
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const profile = useMemo(() => resolveRigProfile(category), [category]);
  const anchorBoneKey = useMemo(() => anchorFor(category, side), [category, side]);

  const previewSettings = useMemo(
    () => ({
      fit,
      pose,
      view,
      category,
      side: profile.sided ? side : null,
      adjustments,
      rigProfileVersion: 3,
      rigMode: profile.mode,
      rigPipeline: profile.pipeline,
      requiredBones: profile.requiredBones,
      validationPoses: profile.validationPoses,
    }),
    [adjustments, category, fit, pose, profile, side, view],
  );

  function updateAdjustment(key: keyof TryOnAdjustments, value: number) {
    setAdjustments((current) => ({ ...current, [key]: value }));
  }

  function resetFit() {
    setFit("Regular");
    setPose("Idle");
    setView("Frente");
    setAdjustments(initialAdjustments);
  }

  async function pollJob(jobId: string): Promise<JobStatusResponse> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await fetch(`/api/creator-studio/blender/status?jobId=${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as JobStatusResponse;
      if (!response.ok) throw new Error(data.error || "No se pudo consultar Blender.");

      setProgress(percent(data.progress));
      setStatus(data.stage || data.status || "Procesando en Blender…");
      const normalized = String(data.status ?? "").toLowerCase();
      if (FAILED.has(normalized)) throw new Error(data.error || data.stage || "Blender no pudo completar el rig.");
      if (DONE.has(normalized) || data.resultUrl) return data;
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
    }
    throw new Error("El proceso superó el tiempo máximo de espera.");
  }

  async function runDeformableRig() {
    if (!asset) throw new Error("Elegí una prenda primero.");
    await setReferenceAssetProcessing(asset.id, previewSettings);

    const form = new FormData();
    form.set("file", asset.file, asset.fileName);
    form.set(
      "payload",
      JSON.stringify({
        category: profile.workerCategory,
        rig: "clouva_base_v1",
        autoFix: true,
        autoWeight: !asset.isTemplate,
        autoExport: true,
        templateMode: asset.isTemplate,
        templateId: asset.id,
        sourceStoragePath: asset.riggedStoragePath ?? asset.storagePath ?? null,
        preserveExistingSkinning: asset.isTemplate,
        targetPolycount: 25000,
        maxFileSizeMb: 18,
        textureResolution: 2048,
        formats: ["glb"],
        previewSettings,
        referenceAssetName: asset.name,
      }),
    );

    const response = await fetch("/api/creator-studio/blender", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.details?.message || "Falló el rig de la prenda.");
    if (data.resultUrl) return String(data.resultUrl);
    if (!data.jobId) throw new Error("Blender no devolvió un identificador de trabajo.");
    const finalStatus = await pollJob(String(data.jobId));
    if (!finalStatus.resultUrl) throw new Error("Blender terminó sin devolver el GLB final.");
    return finalStatus.resultUrl;
  }

  async function runRigidRig() {
    if (!asset) throw new Error("Elegí un accesorio primero.");
    const form = new FormData();
    form.set("file", asset.file, asset.fileName);
    form.set("category", category);

    setStatus("Creando el rig propio del accesorio…");
    const rigResponse = await fetch("/api/creator-studio/blender/rig-object", { method: "POST", body: form });
    const rigData = await rigResponse.json();
    if (!rigResponse.ok || !rigData.jobId) throw new Error(rigData.error || "No se pudo riggear el accesorio.");
    await pollJob(String(rigData.jobId));

    setProgress(55);
    setStatus(`Conectando el accesorio a ${profile.anchor.toLowerCase()}…`);
    const attachResponse = await fetch("/api/creator-studio/blender/attach-object", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ riggedObjectJobId: rigData.jobId, category, side }),
    });
    const attachData = await attachResponse.json();
    if (!attachResponse.ok || !attachData.jobId) throw new Error(attachData.error || "No se pudo conectar el accesorio al avatar.");
    const finalStatus = await pollJob(String(attachData.jobId));
    if (!finalStatus.resultUrl) throw new Error("Blender terminó sin devolver el GLB final.");
    return finalStatus.resultUrl;
  }

  async function applySmartRig() {
    if (!asset || running) return;
    setRunning(true);
    setError(null);
    setProgress(3);
    setStatus(profile.mode === "deformable" ? "Preparando transferencia de pesos…" : "Preparando anclaje rígido…");

    try {
      const workerResultUrl = profile.pipeline === "garment" ? await runDeformableRig() : await runRigidRig();
      setProgress(92);
      setStatus("Guardando el GLB validado en tu biblioteca…");
      const readyAsset = await saveRiggedReferenceAsset(asset.id, workerResultUrl, previewSettings);
      setAsset(readyAsset);
      setResultUrl(workerResultUrl);
      setProgress(100);
      setStatus("Rig terminado y guardado. El asset ya comparte el esqueleto del avatar.");
      setStep("result");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo completar el rig.";
      setError(message);
      setStatus("El proceso se detuvo antes de publicar el resultado.");
      if (asset && !asset.isTemplate) void markReferenceAssetError(asset.id);
    } finally {
      setRunning(false);
    }
  }

  const selectedIndex = STEPS.findIndex((item) => item.id === step);

  return (
    <main className="min-h-screen bg-[#060408] pb-28 text-white">
      <div className="sticky top-0 z-40 border-b border-white/10 bg-[#08050c]/95 px-3 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-violet-300">
              <WandSparkles className="h-4 w-4" /> Creator Studio
            </div>
            <p className="truncate text-sm text-white/55">Un modelo, un rig correcto, un resultado claro.</p>
          </div>
          {asset ? (
            <div className="max-w-[42vw] truncate rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-2 text-xs font-bold text-violet-200">
              {asset.name}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-7">
        <nav className="mb-4 grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-white/[0.035] p-2 sm:mb-6">
          {STEPS.map((item, index) => {
            const active = item.id === step;
            const completed = index < selectedIndex || (item.id === "result" && Boolean(resultUrl));
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (index === 0 || asset) setStep(item.id);
                }}
                disabled={index > 0 && !asset}
                className={`rounded-xl px-2 py-3 text-center transition ${
                  active
                    ? "bg-violet-600 text-white shadow-lg shadow-violet-950/40"
                    : completed
                      ? "bg-emerald-500/10 text-emerald-200"
                      : "text-white/45 disabled:opacity-30"
                }`}
              >
                <span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full border border-current text-[11px] font-black">
                  {completed ? "✓" : index + 1}
                </span>
                <span className="block text-[10px] font-black uppercase tracking-[0.08em] sm:hidden">{item.short}</span>
                <span className="hidden text-xs font-bold sm:block">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {step === "asset" ? (
          <section>
            <div className="mb-4 rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-600/15 to-transparent p-4 sm:p-6">
              <h1 className="text-2xl font-black sm:text-4xl">Elegí qué querés vestir</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                CLOUVA detecta la categoría y activa automáticamente el rig correcto. Una prenda recibe pesos de cuerpo; un accesorio recibe un anclaje rígido.
              </p>
            </div>
            <ReferenceAssetLibrary
              selectedAssetId={asset?.id ?? null}
              onCategoryChange={(nextCategory) => setCategory(nextCategory)}
              onSelect={(nextAsset, url) => {
                setAsset(nextAsset);
                setPreviewUrl(url);
                setResultUrl(null);
                setError(null);
                if (nextAsset) {
                  setCategory(nextAsset.category);
                  setStatus(`${nextAsset.name} listo. CLOUVA activó el perfil ${resolveRigProfile(nextAsset.category).label}.`);
                }
              }}
            />
            {asset ? (
              <button type="button" onClick={() => setStep("fit")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-4 font-black shadow-xl shadow-violet-950/40">
                Ajustar {asset.name} <ArrowRight className="h-5 w-5" />
              </button>
            ) : null}
          </section>
        ) : null}

        {step === "fit" && asset ? (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,.7fr)]">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#100918]">
              <div className="h-[58vh] min-h-[480px] max-h-[760px]">
                <SmartTryOnViewer
                  category={category}
                  fit={fit}
                  pose={pose}
                  view={view}
                  background="#100918"
                  showBody
                  garmentOnly={false}
                  adjustments={adjustments}
                  referenceModelUrl={previewUrl}
                  anchorBoneKey={profile.mode === "rigid" ? anchorBoneKey : null}
                  showAnchorGizmo={profile.mode === "rigid"}
                  showSkeleton={showSkeleton}
                  onReferenceStatus={running ? undefined : setStatus}
                />
              </div>
            </div>

            <aside className="space-y-3">
              <ProfileCard category={category} side={side} onSideChange={setSide} />

              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 font-black"><Move3d className="h-4 w-4 text-violet-300" /> Ajuste visual</h2>
                  <button type="button" onClick={resetFit} className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/55"><RotateCcw className="h-3 w-3" /> Reiniciar</button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["Frente", "Lateral", "Espalda"] as View[]).map((item) => (
                    <button key={item} type="button" onClick={() => setView(item)} className={`rounded-xl border px-2 py-3 text-sm font-bold ${view === item ? "border-violet-400 bg-violet-500/20" : "border-white/10 bg-black/20 text-white/55"}`}>{item}</button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(["Slim", "Regular", "Oversize"] as Fit[]).map((item) => (
                    <button key={item} type="button" onClick={() => setFit(item)} className={`rounded-xl border px-2 py-3 text-sm font-bold ${fit === item ? "border-violet-400 bg-violet-500/20" : "border-white/10 bg-black/20 text-white/55"}`}>{item}</button>
                  ))}
                </div>
                <div className="mt-4 space-y-4">
                  <Slider label="Escala" value={adjustments.scale} min={40} max={180} onChange={(value) => updateAdjustment("scale", value)} />
                  <Slider label="Ancho" value={adjustments.width} min={50} max={180} onChange={(value) => updateAdjustment("width", value)} />
                  <Slider label="Largo" value={adjustments.length} min={50} max={180} onChange={(value) => updateAdjustment("length", value)} />
                  <Slider label="Altura" value={adjustments.height} min={-80} max={80} onChange={(value) => updateAdjustment("height", value)} />
                  <Slider label="Profundidad" value={adjustments.distance} min={-30} max={50} onChange={(value) => updateAdjustment("distance", value)} />
                </div>
                <button type="button" onClick={() => setShowSkeleton((value) => !value)} className="mt-4 w-full rounded-xl border border-white/10 px-3 py-3 text-sm font-bold text-white/65">
                  {showSkeleton ? "Ocultar esqueleto" : "Ver esqueleto"}
                </button>
              </div>

              <button type="button" onClick={() => setStep("rig")} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-4 font-black shadow-xl shadow-violet-950/40">
                Confirmar ajuste <ArrowRight className="h-5 w-5" />
              </button>
            </aside>
          </section>
        ) : null}

        {step === "rig" && asset ? (
          <section className="mx-auto max-w-3xl">
            <ProfileCard category={category} side={side} onSideChange={setSide} expanded />
            <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-violet-500/15 p-3 text-violet-300"><Sparkles className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-black">Rig inteligente por categoría</h2>
                  <p className="mt-1 text-sm leading-6 text-white/55">No tenés que elegir entre scripts técnicos. CLOUVA usa automáticamente el pipeline correcto para {profile.label.toLowerCase()}.</p>
                </div>
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <InfoPill label="Modo" value={profile.mode === "deformable" ? "Prenda deformable" : "Accesorio rígido"} />
                <InfoPill label="Destino" value={profile.anchor} />
                <InfoPill label="Validación" value={profile.validationPoses.join(" · ")} />
              </div>

              {running || progress > 0 ? (
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="text-white/65">{status}</span><strong>{Math.round(progress)}%</strong></div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-400 transition-all" style={{ width: `${progress}%` }} /></div>
                </div>
              ) : null}

              {error ? <div className="mt-4 rounded-2xl border border-red-400/35 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : null}

              <button type="button" disabled={running} onClick={() => void applySmartRig()} className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-5 text-base font-black shadow-2xl shadow-violet-950/50 disabled:cursor-wait disabled:opacity-60">
                {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <WandSparkles className="h-5 w-5" />}
                {running ? "Blender está trabajando…" : profile.actionLabel}
              </button>
              <button type="button" disabled={running} onClick={() => setStep("fit")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white/50"><ArrowLeft className="h-4 w-4" /> Volver al ajuste</button>
            </div>
          </section>
        ) : null}

        {step === "result" && asset ? (
          <section className="mx-auto max-w-4xl">
            {resultUrl ? (
              <>
                <div className="mb-4 rounded-3xl border border-emerald-400/25 bg-emerald-500/10 p-5 sm:p-7">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-1 h-7 w-7 shrink-0 text-emerald-300" />
                    <div>
                      <h1 className="text-2xl font-black">Asset listo y guardado</h1>
                      <p className="mt-1 text-sm leading-6 text-emerald-100/70">{status}</p>
                    </div>
                  </div>
                </div>
                <ResultRigPreview url={resultUrl} />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <a href={resultUrl} className="flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-4 font-black"><Download className="h-5 w-5" /> Descargar GLB final</a>
                  <button type="button" onClick={() => { setPose("Walk"); setStep("fit"); }} className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 font-black"><Play className="h-5 w-5" /> Revisar sobre el avatar</button>
                </div>
                <button type="button" onClick={() => { setStep("asset"); setAsset(null); setPreviewUrl(null); setResultUrl(null); setProgress(0); setStatus("Elegí un GLB para comenzar."); }} className="mt-3 w-full rounded-xl px-4 py-3 text-sm font-bold text-white/50">Procesar otro modelo</button>
              </>
            ) : (
              <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-8 text-center">
                <ShieldCheck className="mx-auto h-10 w-10 text-violet-300" />
                <h2 className="mt-4 text-xl font-black">Todavía no hay resultado</h2>
                <button type="button" onClick={() => setStep("rig")} className="mt-4 rounded-2xl bg-violet-600 px-5 py-3 font-black">Ir al rig</button>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function ProfileCard({ category, side, onSideChange, expanded = false }: { category: ReferenceCategory; side: Side; onSideChange: (side: Side) => void; expanded?: boolean }) {
  const profile = resolveRigProfile(category);
  return (
    <div className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-600/12 to-white/[0.025] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Perfil activado automáticamente</p>
          <h2 className="mt-1 text-lg font-black">{profile.label}</h2>
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.1em] ${profile.mode === "deformable" ? "bg-cyan-400/10 text-cyan-200" : "bg-amber-400/10 text-amber-200"}`}>
          {profile.mode === "deformable" ? "Deformable" : "Rígido"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-white/60">{profile.summary}</p>
      {expanded ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <InfoPill label="Huesos requeridos" value={profile.requiredBones.join(" · ")} />
          <InfoPill label="Regiones" value={profile.bodyRegions.join(" · ")} />
        </div>
      ) : null}
      {profile.sided ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onSideChange("left")} className={`rounded-xl border px-3 py-3 text-sm font-bold ${side === "left" ? "border-violet-400 bg-violet-500/20" : "border-white/10 text-white/50"}`}>Izquierda</button>
          <button type="button" onClick={() => onSideChange("right")} className={`rounded-xl border px-3 py-3 text-sm font-bold ${side === "right" ? "border-violet-400 bg-violet-500/20" : "border-white/10 text-white/50"}`}>Derecha</button>
        </div>
      ) : null}
    </div>
  );
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-xs font-bold text-white/55"><span>{label}</span><strong className="text-white">{Math.round(value)}</strong></span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-violet-500" />
    </label>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/35">{label}</p>
      <p className="mt-1 text-sm font-bold text-white/75">{value}</p>
    </div>
  );
}
