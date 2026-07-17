"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Box,
  CheckCircle2,
  CircleDashed,
  Download,
  ImagePlus,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { SmartTryOnViewer, type AnchorBoneKey, type AnchorDiagnostics, type TryOnAdjustments } from "@/components/creator-studio/SmartTryOnViewer";
import { ReferenceAssetLibrary } from "@/components/creator-studio/ReferenceAssetLibrary";
import { ResultRigPreview, type ResultRigInfo } from "@/components/creator-studio/ResultRigPreview";
import {
  getReferenceAssetById,
  markReferenceAssetError,
  promoteReferenceAssetToTemplate,
  saveRiggedReferenceAsset,
  setReferenceAssetProcessing,
  type ReferenceAsset,
  type ReferenceCategory,
} from "@/lib/creator-studio/reference-assets";

const rawPipeline = [
  "Subiendo GLB existente",
  "Importando en Blender",
  "Alineando con clouva_base_v1",
  "Aplicando ajuste de superficie",
  "Transfiriendo Vertex Groups",
  "Transfiriendo pesos",
  "Vinculando Armature",
  "Normalizando influencias",
  "Prueba T-Pose",
  "Prueba Idle",
  "Prueba Walk",
  "Guardando GLB riggeado en Supabase",
];

const templatePipeline = [
  "Cargando plantilla existente",
  "Importando en Blender",
  "Conservando topología",
  "Conservando Vertex Groups",
  "Conservando pesos",
  "Vinculando al Armature oficial",
  "Aplicando deformaciones",
  "Corrigiendo clipping",
  "Prueba T-Pose",
  "Prueba Idle",
  "Prueba Walk",
  "Exportando GLB validado",
];

const categories = [
  "hoodie",
  "remera",
  "campera",
  "baggy",
  "zapatillas",
  "gorra",
  "cadena",
  "lentes",
  "mochila",
  "aros",
  "guantes",
  "pulseras",
  "anillos",
];

const anchorByCategory: Record<string, string> = {
  hoodie: "Torso + brazos",
  remera: "Torso",
  campera: "Torso + brazos",
  baggy: "Cintura + piernas",
  zapatillas: "Pies",
  gorra: "Cabeza / Head",
  cadena: "Cuello",
  lentes: "Ojos",
  mochila: "Espalda",
  aros: "Orejas",
  guantes: "Manos",
  pulseras: "Muñecas",
  anillos: "Dedos",
};

const rigidCategories = new Set(["gorra", "cadena", "lentes", "mochila", "aros", "pulseras", "anillos"]);

// Categorías con anclaje real a hueso implementado hoy. El resto de rigidCategories
// (aros, guantes) sigue usando el posicionamiento aproximado por altura como antes.
const SIDED_CATEGORIES = new Set(["pulseras", "anillos"]);

function resolveAnchorBoneKey(category: string, side: "left" | "right"): AnchorBoneKey | null {
  switch (category) {
    case "gorra":
    case "lentes":
      return "head";
    case "cadena":
      return "neck";
    case "mochila":
      return "chest";
    case "pulseras":
    case "anillos":
      return side === "left" ? "leftHand" : "rightHand";
    default:
      return null;
  }
}
const requiredBonesByCategory: Record<string, string> = {
  hoodie: "Spine, Chest, Shoulders, Upper Arms",
  remera: "Spine, Chest, Shoulders",
  campera: "Spine, Chest, Shoulders, Upper Arms",
  baggy: "Hips, Upper Legs, Lower Legs",
  zapatillas: "Feet, Toes",
  gorra: "Head",
  cadena: "Neck, Chest",
  lentes: "Head",
  mochila: "Spine, Chest",
  aros: "Head",
  guantes: "Hands",
  pulseras: "Hands, Lower Arms",
  anillos: "Hands, Fingers",
};

const ACTIVE_JOB_KEY = "clouva.creatorStudio.activeRigJob.v2";
const doneStates = new Set(["completed", "complete", "finished", "done", "success", "succeeded"]);
const failedStates = new Set(["failed", "error", "cancelled", "canceled"]);

type Tab = "library" | "avatarRig" | "objectRig" | "fit" | "animations" | "process" | "publish";
type Fit = "Slim" | "Regular" | "Oversize";
type Pose = "T-Pose" | "Idle" | "Walk";
type View = "Frente" | "Lateral" | "Espalda";

type PersistedJob = {
  jobId: string;
  assetId: string;
  assetName: string;
  category: string;
  templateMode: boolean;
  previewSettings: Record<string, unknown>;
  startedAt: number;
};

type JobStatusResponse = {
  ok?: boolean;
  jobId?: string;
  status?: string;
  progress?: number;
  stage?: string | null;
  resultUrl?: string | null;
  error?: string | null;
  details?: unknown;
};

const tabItems: Array<{ id: Tab; label: string }> = [
  { id: "library", label: "Biblioteca" },
  { id: "avatarRig", label: "Rig del avatar" },
  { id: "objectRig", label: "Rig del objeto" },
  { id: "fit", label: "Ajustar al avatar" },
  { id: "animations", label: "Animaciones" },
  { id: "process", label: "Blender" },
  { id: "publish", label: "Resultado" },
];

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

function saveActiveJob(job: PersistedJob | null) {
  if (typeof window === "undefined") return;
  if (job) window.localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
  else window.localStorage.removeItem(ACTIVE_JOB_KEY);
}

function makeObjectUrl(asset: ReferenceAsset | null) {
  return asset ? URL.createObjectURL(asset.file) : null;
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 MB";
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function CreatorStudio() {
  const [category, setCategory] = useState("hoodie");
  const [tab, setTab] = useState<Tab>("library");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Elegí un GLB para comenzar el flujo de validación.");
  const [fit, setFit] = useState<Fit>("Regular");
  const [pose, setPose] = useState<Pose>("Idle");
  const [view, setView] = useState<View>("Frente");
  const [background, setBackground] = useState("#120b1f");
  const [showBody, setShowBody] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [adjustments, setAdjustments] = useState<TryOnAdjustments>(initialAdjustments);
  const [referenceAsset, setReferenceAsset] = useState<ReferenceAsset | null>(null);
  const [referenceModelUrl, setReferenceModelUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState("idle");
  const [jobStage, setJobStage] = useState<string | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [promoting, setPromoting] = useState(false);
  const [side, setSide] = useState<"left" | "right">("right");
  const [showAnchorGizmo, setShowAnchorGizmo] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [resultRigInfo, setResultRigInfo] = useState<ResultRigInfo | null>(null);
  const handleResultRigInfo = useCallback((info: ResultRigInfo) => setResultRigInfo(info), []);
  const [anchorDiagnostics, setAnchorDiagnostics] = useState<AnchorDiagnostics | null>(null);

  const anchorBoneKey = useMemo(() => resolveAnchorBoneKey(category, side), [category, side]);

  const templateMode = Boolean(referenceAsset?.isTemplate);
  const pipeline = templateMode ? templatePipeline : rawPipeline;
  const currentStep = useMemo(
    () => Math.min(Math.floor((progress / 100) * pipeline.length), pipeline.length - 1),
    [pipeline.length, progress],
  );
  const currentPreviewSettings = useMemo(
    () => ({
      fit,
      pose,
      view,
      adjustments,
      category,
      anchor: anchorByCategory[category],
      animationValidation: { loop: true, rootMotion: false },
      // Anclaje real por hueso (o su fallback aproximado). rigMode/anchorBone reflejan
      // lo que el visor efectivamente logró resolver, no solo lo solicitado.
      rigMode: anchorDiagnostics?.mode ?? (anchorBoneKey ? "approx_fallback" : "approx_fallback"),
      anchorBone: anchorDiagnostics?.anchorBoneKey ?? anchorBoneKey,
      anchorBoneName: anchorDiagnostics?.boneName ?? null,
      side: SIDED_CATEGORIES.has(category) ? side : null,
      position: [adjustments.x / 100, (adjustments.y + adjustments.height) / 100, adjustments.distance / 100],
      rotation: [0, ((rotation + adjustments.rotation) * Math.PI) / 180, 0],
      scale: [adjustments.scale / 100, adjustments.scale / 100, adjustments.scale / 100],
      presetVersion: 1,
    }),
    [adjustments, anchorBoneKey, anchorDiagnostics, category, fit, pose, rotation, side, view],
  );

  const updateAdjustment = (key: keyof TryOnAdjustments, value: number) => {
    setAdjustments((current) => ({ ...current, [key]: value }));
  };

  const applyJobStatus = useCallback(
    async (
      data: JobStatusResponse,
      activeJobId: string,
      activeAsset: ReferenceAsset | null,
      previewSettings: Record<string, unknown>,
    ) => {
      const normalizedStatus = String(data.status ?? "processing").toLowerCase();
      const realProgress = Number.isFinite(Number(data.progress))
        ? Math.max(0, Math.min(100, Number(data.progress)))
        : 0;
      setJobStatus(normalizedStatus);
      setJobStage(data.stage ?? null);
      setProgress(realProgress);

      if (failedStates.has(normalizedStatus)) {
        setRunning(false);
        setTab("publish");
        setMessage(data.error || data.stage || `El Auto Rig ${activeJobId} falló.`);
        saveActiveJob(null);
        if (activeAsset && !activeAsset.isTemplate) void markReferenceAssetError(activeAsset.id);
        return;
      }

      if (doneStates.has(normalizedStatus) || data.resultUrl) {
        setRunning(false);
        setProgress(100);
        setResultUrl(data.resultUrl ?? null);
        setTab("publish");
        saveActiveJob(null);

        if (data.resultUrl && activeAsset) {
          try {
            const readyAsset = await saveRiggedReferenceAsset(activeAsset.id, data.resultUrl, previewSettings);
            setReferenceAsset(readyAsset);
            setReferenceModelUrl((current) => {
              if (current) URL.revokeObjectURL(current);
              return makeObjectUrl(readyAsset);
            });
            setLibraryVersion((value) => value + 1);
            setMessage("Auto Rig terminado. El GLB riggeado quedó guardado como plantilla en Supabase.");
          } catch (error) {
            setMessage(
              `El rig terminó y se puede descargar, pero no se guardó en la biblioteca: ${
                error instanceof Error ? error.message : "error desconocido"
              }`,
            );
          }
        } else {
          setMessage(
            data.resultUrl
              ? "Auto Rig terminado. El GLB riggeado está listo."
              : "Blender terminó el proceso, pero el worker no devolvió una URL de descarga.",
          );
        }
        return;
      }

      setRunning(true);
      setTab("process");
      setMessage(data.stage || `Auto Rig ${activeJobId}: ${normalizedStatus}.`);
    },
    [],
  );

  const checkJob = useCallback(
    async (
      activeJobId: string,
      activeAsset: ReferenceAsset | null,
      previewSettings: Record<string, unknown>,
    ) => {
      const response = await fetch(
        `/api/creator-studio/blender/status?jobId=${encodeURIComponent(activeJobId)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as JobStatusResponse;
      if (!response.ok) {
        const details = typeof data.details === "string" ? data.details : "";
        throw new Error(data.error || details || `No se pudo consultar el trabajo ${activeJobId}.`);
      }
      await applyJobStatus(data, activeJobId, activeAsset, previewSettings);
    },
    [applyJobStatus],
  );

  useEffect(() => {
    const raw = window.localStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as PersistedJob;
      if (!saved.jobId || !saved.assetId) return;
      setJobId(saved.jobId);
      setCategory(saved.category || "hoodie");
      setRunning(true);
      setTab("process");
      setMessage(`Recuperando Auto Rig ${saved.jobId}…`);
      void (async () => {
        const asset = await getReferenceAssetById(saved.assetId);
        setReferenceAsset(asset);
        setReferenceModelUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return makeObjectUrl(asset);
        });
        await checkJob(saved.jobId, asset, saved.previewSettings ?? {});
      })().catch((error) => {
        setMessage(error instanceof Error ? error.message : "No se pudo recuperar el Auto Rig.");
      });
    } catch {
      saveActiveJob(null);
    }
  }, [checkJob]);

  useEffect(() => {
    if (!jobId || !running) return;
    const interval = window.setInterval(() => {
      void checkJob(jobId, referenceAsset, currentPreviewSettings).catch((error) => {
        setMessage(
          error instanceof Error
            ? `${error.message} Se volverá a intentar.`
            : "No se pudo consultar el progreso. Se volverá a intentar.",
        );
      });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [checkJob, currentPreviewSettings, jobId, referenceAsset, running]);

  useEffect(
    () => () => {
      if (referenceModelUrl) URL.revokeObjectURL(referenceModelUrl);
    },
    [referenceModelUrl],
  );

  function resetPreview() {
    setFit("Regular");
    setPose("Idle");
    setView("Frente");
    setRotation(0);
    setZoom(1);
    setShowBody(true);
    setAdjustments(initialAdjustments);
  }

  function resetProject() {
    setReferenceAsset(null);
    setReferenceModelUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setResultUrl(null);
    setProgress(0);
    setJobId(null);
    setJobStatus("idle");
    setJobStage(null);
    setRunning(false);
    saveActiveJob(null);
    resetPreview();
    setTab("library");
    setMessage("Nuevo proyecto creado.");
  }

  async function promoteSelectedAsset() {
    if (!referenceAsset || referenceAsset.isTemplate || promoting) return;
    setPromoting(true);
    setMessage("Marcando el GLB existente como plantilla base…");
    try {
      await promoteReferenceAssetToTemplate(referenceAsset.id, currentPreviewSettings);
      const readyAsset: ReferenceAsset = {
        ...referenceAsset,
        status: "ready",
        isTemplate: true,
        riggedStoragePath: referenceAsset.storagePath,
        previewSettings: currentPreviewSettings,
      };
      setReferenceAsset(readyAsset);
      setLibraryVersion((value) => value + 1);
      setMessage("Plantilla base guardada. Blender conservará su rig y sus pesos.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la plantilla.");
    } finally {
      setPromoting(false);
    }
  }

  async function rigReference() {
    if (!referenceAsset || running) return;
    const isTemplate = referenceAsset.isTemplate;
    setRunning(true);
    setTab("process");
    setProgress(1);
    setJobStatus("uploading");
    setJobStage(isTemplate ? "Cargando plantilla existente" : "Subiendo GLB existente");
    setMessage(
      isTemplate
        ? "Enviando la plantilla al Blender Worker sin recalcular pesos…"
        : "Enviando el GLB existente al Blender Worker para transferir el rig…",
    );

    try {
      if (!isTemplate) await setReferenceAssetProcessing(referenceAsset.id, currentPreviewSettings);
      const form = new FormData();
      form.set("file", referenceAsset.file, referenceAsset.fileName);
      form.set(
        "payload",
        JSON.stringify({
          category,
          rig: "clouva_base_v1",
          autoFix: true,
          autoWeight: !isTemplate,
          autoExport: true,
          templateMode: isTemplate,
          templateId: referenceAsset.id,
          sourceStoragePath: referenceAsset.riggedStoragePath ?? referenceAsset.storagePath ?? null,
          preserveExistingSkinning: isTemplate,
          targetPolycount: 25000,
          maxFileSizeMb: 18,
          textureResolution: 2048,
          formats: ["glb"],
          previewSettings: currentPreviewSettings,
          referenceAssetName: referenceAsset.name,
        }),
      );

      const response = await fetch("/api/creator-studio/blender", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.details?.message || "Falló el Auto Rig");
      if (!data.jobId && !data.resultUrl) {
        throw new Error("El worker respondió, pero no devolvió jobId ni resultado.");
      }

      if (data.resultUrl) {
        await applyJobStatus(
          { ...data, status: "completed" },
          String(data.jobId ?? "direct"),
          referenceAsset,
          currentPreviewSettings,
        );
        return;
      }

      const nextJobId = String(data.jobId);
      setJobId(nextJobId);
      setJobStatus(String(data.status ?? "queued").toLowerCase());
      setProgress(3);
      saveActiveJob({
        jobId: nextJobId,
        assetId: referenceAsset.id,
        assetName: referenceAsset.name,
        category,
        templateMode: isTemplate,
        previewSettings: currentPreviewSettings,
        startedAt: Date.now(),
      });
      setMessage(`Trabajo ${nextJobId} creado. Consultando el progreso real de Blender…`);
      await checkJob(nextJobId, referenceAsset, currentPreviewSettings);
    } catch (error) {
      setRunning(false);
      setJobStatus("error");
      setTab("publish");
      setMessage(error instanceof Error ? error.message : "No se pudo riggear la referencia.");
      if (!isTemplate) void markReferenceAssetError(referenceAsset.id);
    }
  }

  const errorCount = failedStates.has(jobStatus) || jobStatus === "error" ? "1" : "0";
  const objectRigMode = rigidCategories.has(category) ? "Anclaje rígido" : "Prenda deformable";

  const viewer = (
    options: {
      objectUrl?: string | null;
      body: boolean;
      objectOnly: boolean;
      viewerPose?: Pose;
      viewerView?: View;
    },
  ) => (
    <div style={{ ...smartViewer, background }}>
      <SmartTryOnViewer
        category={category}
        fit={fit}
        pose={options.viewerPose ?? pose}
        view={options.viewerView ?? view}
        background={background}
        showBody={options.body}
        garmentOnly={options.objectOnly}
        adjustments={{
          ...adjustments,
          rotation: adjustments.rotation + rotation,
          scale: adjustments.scale * zoom,
        }}
        referenceModelUrl={options.objectUrl}
        anchorBoneKey={options.objectOnly ? null : anchorBoneKey}
        showAnchorGizmo={showAnchorGizmo}
        showSkeleton={showSkeleton}
        onReferenceStatus={running ? undefined : setMessage}
        onAnchorDiagnostics={setAnchorDiagnostics}
      />
      <div style={viewerBadge}>
        {options.objectUrl && referenceAsset
          ? `${referenceAsset.name} · ${templateMode ? "plantilla" : "referencia"}`
          : "Avatar activo"}
      </div>
    </div>
  );

  return (
    <main style={page}>
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <header style={header}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#c4a7ff", fontWeight: 800 }}>
              <WandSparkles size={18} /> CLOUVA
            </div>
            <h1 style={{ margin: "5px 0 3px", fontSize: "clamp(28px,5vw,52px)" }}>Creator Studio</h1>
            <p style={{ margin: 0, color: "#aaa3b5" }}>
              Biblioteca → rig del avatar → rig del objeto → ajuste → animaciones → Blender
            </p>
          </div>
          <button onClick={resetProject} style={primaryButton}>
            <Sparkles size={18} /> Nuevo modelo
          </button>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 18 }}>
          {[
            { label: "Referencias", value: referenceAsset ? "1" : "0", icon: <Box /> },
            { label: "Procesando", value: running ? "1" : "0", icon: <Activity /> },
            { label: "Plantillas", value: referenceAsset?.isTemplate ? "1" : "0", icon: <CheckCircle2 /> },
            { label: "Errores", value: errorCount, icon: <CircleDashed /> },
          ].map((item) => (
            <div key={item.label} style={card}>
              <div style={{ color: "#bda2ff" }}>{item.icon}</div>
              <strong style={{ fontSize: 26 }}>{item.value}</strong>
              <span style={{ color: "#9e97a8" }}>{item.label}</span>
            </div>
          ))}
        </section>

        <nav style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16, paddingBottom: 4 }}>
          {tabItems.map((item, index) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              style={{ ...tabButton, ...(tab === item.id ? activeTab : {}) }}
            >
              {index + 1}. {item.label}
            </button>
          ))}
        </nav>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(280px,.7fr)", gap: 16 }} className="creator-grid">
          <section style={{ ...panel, minHeight: 620 }}>
            {tab === "library" && (
              <div>
                <h2 style={title}><ImagePlus /> Biblioteca de GLB</h2>
                <div style={formGrid}>
                  <Field label="Categoría">
                    <select value={category} onChange={(event) => setCategory(event.target.value)} style={input}>
                      {categories.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </Field>
                  <Field label="Anclaje previsto"><div style={readonlyField}>{anchorByCategory[category]}</div></Field>
                  <Field label="Costo del visor"><div style={readonlyField}>0 créditos</div></Field>
                </div>
                <ReferenceAssetLibrary
                  key={libraryVersion}
                  selectedAssetId={referenceAsset?.id ?? null}
                  onCategoryChange={(value: ReferenceCategory) => setCategory(value)}
                  onSelect={(asset, url) => {
                    setReferenceAsset(asset);
                    setReferenceModelUrl((current) => {
                      if (current) URL.revokeObjectURL(current);
                      return url;
                    });
                    if (asset) {
                      setMessage(
                        asset.isTemplate
                          ? `${asset.name} es una plantilla con rig para inspeccionar.`
                          : `${asset.name} está listo para analizar su rig.`,
                      );
                    }
                  }}
                />
                <button
                  disabled={!referenceAsset}
                  onClick={() => setTab("avatarRig")}
                  style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 14, opacity: referenceAsset ? 1 : 0.5 }}
                >
                  <UserRound /> Comenzar validación
                </button>
              </div>
            )}

            {tab === "avatarRig" && (
              <div>
                <h2 style={title}><UserRound /> Rig del avatar activo</h2>
                <p style={sectionLead}>Esta pantalla revisa solamente el personaje base. No carga la gorra ni ninguna prenda.</p>
                {viewer({ objectUrl: null, body: true, objectOnly: false, viewerPose: "T-Pose" })}
                <div style={toolRow}>
                  {(["Frente", "Lateral", "Espalda"] as View[]).map((item) => (
                    <button key={item} onClick={() => setView(item)} style={{ ...toolButton, ...(view === item ? activeTool : {}) }}>{item}</button>
                  ))}
                </div>
                <div style={diagnosticGrid}>
                  <Diagnostic title="Base" value="Avatar activo del usuario" state="Listo para inspección" />
                  <Diagnostic title="Rig requerido" value="Hips, Spine, Head, brazos y piernas" state="Se valida en Blender" />
                  <Diagnostic title="Pose de referencia" value="T-Pose limpia" state="Sin objetos equipados" />
                </div>
                <button disabled={!referenceAsset} onClick={() => setTab("objectRig")} style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 14, opacity: referenceAsset ? 1 : 0.5 }}>
                  Continuar al rig del objeto
                </button>
              </div>
            )}

            {tab === "objectRig" && (
              <div>
                <h2 style={title}><Box /> Rig del objeto</h2>
                {!referenceAsset ? (
                  <EmptyState onBack={() => setTab("library")} text="Elegí un GLB de la biblioteca para inspeccionar su rig." />
                ) : (
                  <>
                    <p style={sectionLead}>El objeto se muestra aislado para no confundir problemas de malla, rig o escala con el cuerpo.</p>
                    {viewer({ objectUrl: referenceModelUrl, body: false, objectOnly: true, viewerPose: "Idle" })}
                    <div style={toolRow}>
                      {(["Frente", "Lateral", "Espalda"] as View[]).map((item) => (
                        <button key={item} onClick={() => setView(item)} style={{ ...toolButton, ...(view === item ? activeTool : {}) }}>{item}</button>
                      ))}
                    </div>
                    <div style={diagnosticGrid}>
                      <Diagnostic title="Archivo" value={referenceAsset.fileName} state={formatBytes(referenceAsset.size)} />
                      <Diagnostic title="Tipo de rig" value={objectRigMode} state={templateMode ? "Conservar pesos existentes" : "Pendiente de remapeo"} />
                      <Diagnostic title="Ancla final" value={anchorByCategory[category]} state={`Huesos: ${requiredBonesByCategory[category]}`} />
                      <Diagnostic title="Estado" value={referenceAsset.status} state={templateMode ? "Plantilla validada" : "Referencia sin validar"} />
                    </div>
                    <div style={notice}>
                      {templateMode
                        ? "Blender conservará el armature, Vertex Groups y pesos existentes, y los remapeará al rig del avatar cuando corresponda."
                        : rigidCategories.has(category)
                          ? `El objeto se tratará como accesorio rígido vinculado a ${anchorByCategory[category]}.`
                          : "El objeto recibirá transferencia de pesos desde las regiones equivalentes del avatar."}
                    </div>
                    {!templateMode && (
                      <button disabled={promoting} onClick={() => void promoteSelectedAsset()} style={{ ...secondaryButton, width: "100%", justifyContent: "center", marginTop: 10 }}>
                        <CheckCircle2 size={17} /> {promoting ? "Guardando plantilla…" : "Este objeto ya tiene rig: conservarlo"}
                      </button>
                    )}
                    <button onClick={() => setTab("fit")} style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 10 }}>
                      Ajustar sobre el avatar
                    </button>
                  </>
                )}
              </div>
            )}

            {tab === "fit" && (
              <div>
                <h2 style={title}><Settings2 /> Ajuste combinado</h2>
                {!referenceAsset ? (
                  <EmptyState onBack={() => setTab("library")} text="Elegí primero el objeto que querés ajustar." />
                ) : (
                  <>
                    <p style={sectionLead}>Acá se corrigen solamente posición, escala y proporciones. Las animaciones se prueban en la etapa siguiente.</p>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(250px,.8fr)", gap: 16 }} className="preview-grid">
                      <div>
                        {viewer({ objectUrl: referenceModelUrl, body: showBody, objectOnly: false, viewerPose: "Idle" })}
                        <div style={toolRow}>
                          {(["Frente", "Lateral", "Espalda"] as View[]).map((item) => (
                            <button key={item} onClick={() => setView(item)} style={{ ...toolButton, ...(view === item ? activeTool : {}) }}>{item}</button>
                          ))}
                        </div>
                        <div style={toolRow}>
                          <button onClick={() => setRotation((value) => value - 15)} style={toolButton}>↶ Girar objeto</button>
                          <button onClick={() => setRotation((value) => value + 15)} style={toolButton}>Girar objeto ↷</button>
                          <button onClick={() => setZoom((value) => Math.min(2, value + 0.05))} style={toolButton}>Escala +</button>
                          <button onClick={() => setZoom((value) => Math.max(0.35, value - 0.05))} style={toolButton}>Escala −</button>
                          <button onClick={() => setShowBody((value) => !value)} style={toolButton}>{showBody ? "Ocultar cuerpo" : "Mostrar cuerpo"}</button>
                          <button onClick={() => setShowAnchorGizmo((value) => !value)} style={{ ...toolButton, ...(showAnchorGizmo ? activeTool : {}) }}>
                            {showAnchorGizmo ? "Ocultar hueso de anclaje" : "Ver hueso de anclaje"}
                          </button>
                          <button onClick={() => setShowSkeleton((value) => !value)} style={{ ...toolButton, ...(showSkeleton ? activeTool : {}) }}>
                            {showSkeleton ? "Ocultar esqueleto" : "Ver esqueleto"}
                          </button>
                          <button onClick={resetPreview} style={toolButton}><RotateCcw size={15} /> Reiniciar</button>
                        </div>
                      </div>
                      <div>
                        <Field label="Ajuste">
                          <select value={fit} onChange={(event) => setFit(event.target.value as Fit)} style={input}>
                            <option>Slim</option><option>Regular</option><option>Oversize</option>
                          </select>
                        </Field>
                        {SIDED_CATEGORIES.has(category) && (
                          <Field label="Lado">
                            <select value={side} onChange={(event) => setSide(event.target.value as "left" | "right")} style={input}>
                              <option value="right">Derecha</option>
                              <option value="left">Izquierda</option>
                            </select>
                          </Field>
                        )}
                        <Field label="Fondo"><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} style={{ ...input, height: 46, padding: 5 }} /></Field>
                        <Range label="Escala" value={adjustments.scale} min={25} max={300} onChange={(value) => updateAdjustment("scale", value)} />
                        <Range label="Largo / altura" value={adjustments.length} min={35} max={240} onChange={(value) => updateAdjustment("length", value)} />
                        <Range label="Ancho" value={adjustments.width} min={35} max={240} onChange={(value) => updateAdjustment("width", value)} />
                        <Range label="Posición X" value={adjustments.x} min={-150} max={150} onChange={(value) => updateAdjustment("x", value)} />
                        <Range label="Posición Y" value={adjustments.y} min={-150} max={150} onChange={(value) => updateAdjustment("y", value)} />
                        <Range label="Rotación" value={adjustments.rotation} min={-180} max={180} onChange={(value) => updateAdjustment("rotation", value)} />
                        <Range label="Altura" value={adjustments.height} min={-100} max={100} onChange={(value) => updateAdjustment("height", value)} />
                        <Range label="Profundidad" value={adjustments.distance} min={-40} max={60} onChange={(value) => updateAdjustment("distance", value)} />
                      </div>
                    </div>
                    <div style={diagnosticGrid}>
                      <Diagnostic
                        title="Anclaje"
                        value={anchorBoneKey ?? "Sin hueso (aproximado)"}
                        state={anchorDiagnostics?.boneName ? `Hueso real: ${anchorDiagnostics.boneName}` : "Sin hueso detectado en este avatar"}
                      />
                      <Diagnostic
                        title="Modo"
                        value={anchorDiagnostics?.mode === "rigid_anchor" ? "Anclaje rígido" : "Aproximado por altura"}
                        state={anchorDiagnostics?.mode === "rigid_anchor" ? "Sigue el hueso en cada frame" : "Fallback: no se encontró el hueso"}
                      />
                      <Diagnostic
                        title="Seguimiento de animación"
                        value={anchorDiagnostics?.mode === "rigid_anchor" ? "Activo" : "No disponible"}
                        state={anchorDiagnostics?.mode === "rigid_anchor" ? "El objeto se mueve con el hueso" : "Puede desalinearse al animar"}
                      />
                    </div>
                    <button onClick={() => { setPose("Idle"); setTab("animations"); }} style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 14 }}>
                      Probar animaciones
                    </button>
                  </>
                )}
              </div>
            )}

            {tab === "animations" && (
              <div>
                <h2 style={title}><Play /> Laboratorio de animaciones</h2>
                {!referenceAsset ? (
                  <EmptyState onBack={() => setTab("library")} text="Elegí y ajustá un objeto antes de probar animaciones." />
                ) : (
                  <>
                    <p style={sectionLead}>Esta etapa no cambia la posición guardada. Solo verifica que el avatar y el objeto se muevan juntos.</p>
                    {viewer({ objectUrl: referenceModelUrl, body: true, objectOnly: false })}
                    <div style={toolRow}>
                      {(["Frente", "Lateral", "Espalda"] as View[]).map((item) => (
                        <button key={item} onClick={() => setView(item)} style={{ ...toolButton, ...(view === item ? activeTool : {}) }}>{item}</button>
                      ))}
                    </div>
                    <div style={toolRow}>
                      {(["T-Pose", "Idle", "Walk"] as Pose[]).map((item) => (
                        <button key={item} onClick={() => setPose(item)} style={{ ...toolButton, ...(pose === item ? activeTool : {}) }}>{item}</button>
                      ))}
                    </div>
                    <div style={diagnosticGrid}>
                      <Diagnostic title="Clip activo" value={pose} state="Vista en tiempo real" />
                      <Diagnostic title="Loop" value="Activado" state="Reproducción continua" />
                      <Diagnostic title="Root motion" value="Bloqueado" state="Camina en el lugar" />
                      <Diagnostic title="Objeto" value={referenceAsset.name} state={`Debe seguir ${anchorByCategory[category]}`} />
                    </div>
                    <div style={notice}>Revisá Frente, Lateral y Espalda en Idle y Walk. Si el objeto se separa del cuerpo, volvé a Rig del objeto. Si solo está desplazado, volvé a Ajustar al avatar.</div>
                    <button disabled={running} onClick={() => void rigReference()} style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 12, opacity: running ? 0.5 : 1 }}>
                      <Settings2 /> {running ? "Rigeando objeto…" : templateMode ? "Rigear objeto (validar plantilla)" : "Rigear objeto con Blender"}
                    </button>
                  </>
                )}
              </div>
            )}

            {tab === "process" && (
              <div>
                <h2 style={title}><Settings2 /> {templateMode ? "Procesando plantilla" : "Auto Rig con Blender Worker"}</h2>
                <div style={{ marginBottom: 12, color: "#c9bfd3" }}>{jobId ? `Trabajo: ${jobId}` : "Preparando trabajo…"}</div>
                <div style={progressTrack}><div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg,#7c3aed,#d8b4fe)", transition: "width .35s" }} /></div>
                {jobStage && <div style={notice}>Etapa real: {jobStage}</div>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8, marginTop: 14 }}>
                  {pipeline.map((step, index) => (
                    <div key={step} style={{ display: "flex", alignItems: "center", gap: 10, padding: 11, borderRadius: 12, background: index < currentStep ? "#17251e" : index === currentStep ? "#261b35" : "#110e15", color: index <= currentStep ? "white" : "#736d7b" }}>
                      {index < currentStep ? <CheckCircle2 color="#65d894" size={18} /> : <CircleDashed size={18} />} {step}
                    </div>
                  ))}
                </div>
                <div style={{ ...notice, marginTop: 16 }}>Podés refrescar o cerrar la página. CLOUVA guarda el jobId y retoma el seguimiento automáticamente.</div>
              </div>
            )}

            {tab === "publish" && (
              <div>
                <h2 style={title}><Download /> Resultado de Blender</h2>
                <div style={failedStates.has(jobStatus) || jobStatus === "error" ? errorBox : successBox}>
                  <CheckCircle2 size={42} />
                  <div>
                    <strong>{resultUrl ? "GLB procesado" : failedStates.has(jobStatus) || jobStatus === "error" ? "Proceso con error" : "Proceso en espera"}</strong>
                    <p style={{ margin: "5px 0 0", color: "#b8c9bd" }}>{message}</p>
                    {jobId && <small style={{ display: "block", marginTop: 8 }}>Job: {jobId}</small>}
                  </div>
                </div>
                {resultUrl ? (
                  <a href={resultUrl} style={{ ...primaryButton, textDecoration: "none" }}><Download size={16} /> Descargar GLB riggeado</a>
                ) : (
                  <button onClick={() => setTab(jobId ? "process" : "animations")} style={primaryButton}><Play size={16} /> {jobId ? "Ver seguimiento" : "Volver a animaciones"}</button>
                )}
                {resultUrl && (
                  <>
                    <ResultRigPreview url={resultUrl} onInfo={handleResultRigInfo} />
                    <div style={diagnosticGrid}>
                      <Diagnostic
                        title="Huesos en el resultado"
                        value={resultRigInfo?.loading ? "Cargando…" : String(resultRigInfo?.bones ?? 0)}
                        state={resultRigInfo?.error ?? "Del armature del avatar exportado junto al objeto"}
                      />
                      <Diagnostic
                        title="Objeto detectado"
                        value={resultRigInfo?.objectMeshName ?? "No identificado"}
                        state="Malla del GLB que subiste, ya unida al avatar"
                      />
                      <Diagnostic
                        title="Hueso de anclaje real"
                        value={resultRigInfo?.anchorBoneName ?? "Sin datos"}
                        state={
                          resultRigInfo?.weightedVertexRatio != null
                            ? `${Math.round(resultRigInfo.weightedVertexRatio * 100)}% de la malla soldada a ese hueso`
                            : "Blender no reportó pesos de skinning"
                        }
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          <aside style={panel}>
            <h3 style={{ marginTop: 0 }}>Etapa actual</h3>
            <div style={stageCard}>
              <strong>{tabItems.find((item) => item.id === tab)?.label}</strong>
              <span>{stageDescription(tab)}</span>
            </div>
            <h3>Estado</h3>
            <div style={statusBox}>{message}</div>
            <div style={{ marginTop: 14, color: "#91899b", fontSize: 13 }}>Progreso real: {progress}% · Estado: {jobStatus}</div>
            {jobId && <Info title="Job activo" value={jobId} />}
            <Info title="Asset activo" value={referenceAsset?.name ?? "Ninguno"} />
            <Info title="Categoría" value={category} />
            <Info title="Modo del objeto" value={objectRigMode} />
            <Info title="Anclaje" value={anchorByCategory[category]} />
            <Info title="Huesos requeridos" value={requiredBonesByCategory[category]} />
          </aside>
        </div>
      </div>
      <style jsx>{`@media(max-width:850px){.creator-grid,.preview-grid{grid-template-columns:1fr!important}}`}</style>
    </main>
  );
}

function stageDescription(tab: Tab) {
  const descriptions: Record<Tab, string> = {
    library: "Elegir y clasificar el GLB.",
    avatarRig: "Revisar el esqueleto base sin objetos.",
    objectRig: "Analizar el GLB, su ancla y estrategia de pesos.",
    fit: "Guardar posición, escala y rotación sobre el avatar.",
    animations: "Validar T-Pose, Idle y Walk sin modificar el ajuste.",
    process: "Procesar y exportar en Blender Worker.",
    publish: "Descargar o guardar el resultado validado.",
  };
  return descriptions[tab];
}

function EmptyState({ text, onBack }: { text: string; onBack: () => void }) {
  return (
    <div style={{ ...notice, padding: 24, textAlign: "center" }}>
      <p>{text}</p>
      <button onClick={onBack} style={primaryButton}>Volver a Biblioteca</button>
    </div>
  );
}

function Diagnostic({ title: diagnosticTitle, value, state }: { title: string; value: string; state: string }) {
  return (
    <div style={diagnosticCard}>
      <span style={{ color: "#9e97a8", fontSize: 12 }}>{diagnosticTitle}</span>
      <strong>{value}</strong>
      <small style={{ color: "#bda2ff" }}>{state}</small>
    </div>
  );
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) {
  return <label><span style={label}>{text}</span>{children}</label>;
}

function Range({ label: text, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ ...label, display: "flex", justifyContent: "space-between" }}><span>{text}</span><strong>{value}</strong></span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ width: "100%" }} />
    </label>
  );
}

function Info({ title: infoTitle, value }: { title: string; value: string }) {
  return (
    <div style={infoCard}>
      <strong style={{ display: "block", marginBottom: 6 }}>{infoTitle}</strong>
      <span style={{ color: "#bda2ff", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

const page: React.CSSProperties = { minHeight: "100dvh", background: "radial-gradient(circle at 20% 0%,#271045 0,#0b0711 38%,#050507 100%)", color: "white", padding: 22, fontFamily: "Inter,system-ui,sans-serif" };
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", marginBottom: 22, flexWrap: "wrap" };
const card: React.CSSProperties = { background: "rgba(19,14,24,.86)", border: "1px solid #2a2133", borderRadius: 18, padding: 16, display: "grid", gap: 6 };
const panel: React.CSSProperties = { background: "rgba(13,10,17,.91)", border: "1px solid #2d2337", borderRadius: 22, padding: "clamp(16px,3vw,26px)", boxShadow: "0 24px 80px rgba(0,0,0,.28)" };
const primaryButton: React.CSSProperties = { border: 0, borderRadius: 14, padding: "13px 18px", background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "white", fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" };
const secondaryButton: React.CSSProperties = { ...primaryButton, background: "#16101c", border: "1px solid #684296", color: "#d7c4fa" };
const tabButton: React.CSSProperties = { border: "1px solid #33273e", background: "#100c14", color: "#aaa2b2", padding: "11px 15px", borderRadius: 12, whiteSpace: "nowrap", cursor: "pointer" };
const activeTab: React.CSSProperties = { background: "#2c1742", borderColor: "#8351c6", color: "white" };
const activeTool: React.CSSProperties = { background: "#382050", borderColor: "#9b6ee8", color: "white" };
const title: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginTop: 0 };
const sectionLead: React.CSSProperties = { color: "#aaa3b5", lineHeight: 1.5, marginTop: -4 };
const label: React.CSSProperties = { display: "block", color: "#aaa1b4", fontSize: 13, margin: "13px 0 7px" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#0d0a10", border: "1px solid #33283e", borderRadius: 12, color: "white", padding: "12px 13px", outline: "none" };
const readonlyField: React.CSSProperties = { ...input, color: "#cbb7ef", minHeight: 44 };
const formGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 18 };
const smartViewer: React.CSSProperties = { minHeight: 500, borderRadius: 18, border: "1px solid #31253b", position: "relative", overflow: "hidden" };
const viewerBadge: React.CSSProperties = { position: "absolute", left: 14, bottom: 14, padding: "7px 10px", borderRadius: 99, background: "rgba(0,0,0,.55)", border: "1px solid rgba(255,255,255,.14)", fontSize: 12, zIndex: 5 };
const toolRow: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 };
const toolButton: React.CSSProperties = { border: "1px solid #3a2c46", background: "#16101c", color: "#d3cadb", borderRadius: 11, padding: "9px 11px", display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" };
const notice: React.CSSProperties = { marginTop: 14, padding: 12, borderRadius: 12, background: "#16101c", border: "1px solid #3a2c46", color: "#cfc3db" };
const diagnosticGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 14 };
const diagnosticCard: React.CSSProperties = { display: "grid", gap: 7, padding: 14, borderRadius: 14, background: "#100c14", border: "1px solid #30243a" };
const infoCard: React.CSSProperties = { marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid #30243a", background: "#0e0a12" };
const stageCard: React.CSSProperties = { display: "grid", gap: 6, padding: 14, background: "#171020", border: "1px solid #4d316a", borderRadius: 14, color: "#d9c7f3" };
const statusBox: React.CSSProperties = { padding: 14, background: "#100c14", borderRadius: 14, color: "#c9bfd3", lineHeight: 1.5 };
const progressTrack: React.CSSProperties = { height: 10, background: "#211a29", borderRadius: 99, overflow: "hidden", marginBottom: 18 };
const successBox: React.CSSProperties = { display: "flex", gap: 14, alignItems: "center", padding: 18, background: "#132018", border: "1px solid #2c6640", borderRadius: 16, color: "#81e3a3", marginBottom: 16 };
const errorBox: React.CSSProperties = { ...successBox, background: "#261315", border: "1px solid #7f3037", color: "#ff9da6" };
