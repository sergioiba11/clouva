"use client";

import {
  Activity,
  BadgeCheck,
  Bone,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Cpu,
  Download,
  Eye,
  FileCheck2,
  Gauge,
  Loader2,
  PackageOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Ruler,
  Search,
  Settings2,
  Shirt,
  TriangleAlert,
  User,
  Wrench,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import { RealGarmentReview } from "./RealGarmentReview";
import { StandaloneObjectPreview } from "./StandaloneObjectPreview";
import styles from "./unreal-object-export.module.css";

type StorageAsset = { id: string; kind: "storage"; name: string; path: string; label: string };
type ClothingAsset = {
  id: string;
  kind: "clothing";
  name: string;
  clothingItemId: string;
  category: string;
  modelUrl?: string;
  thumbnailUrl?: string;
  rigged: boolean;
  fitStatus?: string;
  label: string;
};
type ObjectAsset = StorageAsset | ClothingAsset;
type StorageEntry = { name: string; metadata?: Record<string, unknown> | null };
type ExportResult = { url?: string; filename?: string; scale?: string; error?: string };
type ClothingResponse = {
  items?: Array<{
    id: string;
    name: string;
    category: string;
    modelUrl?: string;
    thumbnailUrl?: string;
    rigged: boolean;
    fitStatus?: string;
  }>;
  error?: string;
};

type DiagnosticStatus = "ok" | "warning" | "error" | "pending" | "info";
type DiagnosticStage = {
  id: string;
  label: string;
  status: DiagnosticStatus;
  summary: string;
};
type WorkerTool = {
  id: string;
  name: string;
  script?: string;
  purpose?: string;
  version?: string;
  status?: string;
};
type AssetInspection = {
  meshCount?: number;
  armatureCount?: number;
  boneCount?: number;
  vertices?: number;
  polygons?: number;
  weightedVertexRatio?: number;
  rawBounds?: { dimensionsCm?: number[] } | null;
  evaluatedBounds?: { dimensionsCm?: number[] } | null;
  evaluatedDifference?: {
    maximumSizeError?: number;
    centerError?: number;
    different?: boolean;
  } | null;
  legacyRecoveryRecommended?: boolean;
  metadataKeys?: string[];
};
type WorkerDiagnostics = {
  ok?: boolean;
  error?: string;
  generatedAt?: string;
  worker?: {
    inspectorVersion?: string;
    rigVersion?: string;
    legacyRecoveryVersion?: string;
    exportVersion?: string;
    rigRouteVersion?: string;
    blenderVersion?: string;
  };
  tools?: WorkerTool[];
  stages?: DiagnosticStage[];
  garment?: AssetInspection;
  avatar?: AssetInspection;
  outputInspection?: { garment?: AssetInspection } | null;
  pipeline?: {
    ok?: boolean | null;
    error?: string | null;
    returnCode?: number | null;
    outputBytes?: number;
    stdout?: string;
    stderr?: string;
  };
  diagnosis?: {
    legacyGeometryDifferenceDetected?: boolean;
    recommendedAction?: string;
  };
};

type ReviewView = "Frente" | "Lateral" | "Espalda";
type ReviewPose = "Idle" | "T-Pose" | "Walk";

const CATEGORY_LABELS: Record<string, string> = {
  hoodie: "Buzo",
  shirt: "Remera",
  jacket: "Campera",
  pants: "Pantalón",
  shorts: "Short",
  shoes: "Zapatillas",
  accessory: "Accesorio",
};

const STAGE_STATUS_LABELS: Record<DiagnosticStatus, string> = {
  ok: "OK",
  warning: "REVISAR",
  error: "FALLÓ",
  pending: "PENDIENTE",
  info: "INFO",
};

const APPROVAL_STORAGE_KEY = "clouva-unreal-visual-approvals-v2";

async function listGlbs(userId: string, path = userId, depth = 0): Promise<StorageAsset[]> {
  const { data, error } = await supabase.storage.from("creator-assets").list(path, {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  });
  if (error) return [];
  const found: StorageAsset[] = [];
  for (const raw of data ?? []) {
    const entry = raw as StorageEntry;
    const fullPath = `${path}/${entry.name}`;
    const folder = !entry.metadata && !entry.name.includes(".");
    if (folder && depth < 4) found.push(...(await listGlbs(userId, fullPath, depth + 1)));
    else if (/\.glb$/i.test(entry.name) && !/avatar/i.test(entry.name)) {
      found.push({
        id: `storage:${fullPath}`,
        kind: "storage",
        name: entry.name,
        path: fullPath,
        label: `Archivo · ${entry.name.replace(/[-_]+/g, " ")}`,
      });
    }
  }
  return found;
}

function dimensions(value?: number[] | null) {
  if (!value?.length) return "Sin medir";
  return value.map((item) => Number(item).toFixed(1)).join(" × ") + " cm";
}

function percent(value?: number | null) {
  if (!Number.isFinite(value)) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function stageIcon(status: DiagnosticStatus) {
  if (status === "ok") return <CheckCircle2 />;
  if (status === "error") return <XCircle />;
  if (status === "warning") return <TriangleAlert />;
  return <CircleDot />;
}

function friendlyExportError(raw: string) {
  if (/module not found|modulenotfound/i.test(raw)) return "El exportador de Blender no terminó de cargar. Revisá el registro técnico.";
  if (/validation|validaci/i.test(raw)) return "Blender procesó la prenda, pero la validación final encontró algo para corregir.";
  if (/timeout|tiempo/i.test(raw)) return "Blender tardó más de lo permitido. Probá nuevamente.";
  return "No se pudo terminar el FBX. El motivo técnico quedó guardado abajo.";
}

export function UnrealObjectExport() {
  const { user, session, loading } = useAuth();
  const [objects, setObjects] = useState<ObjectAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<WorkerDiagnostics | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewView, setReviewView] = useState<ReviewView>("Frente");
  const [reviewPose, setReviewPose] = useState<ReviewPose>("Idle");
  const [viewerRevision, setViewerRevision] = useState(0);
  const [previewStatus, setPreviewStatus] = useState("Esperando un objeto para revisar.");
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(APPROVAL_STORAGE_KEY);
      if (stored) setApprovals(JSON.parse(stored) as Record<string, boolean>);
    } catch {
      setApprovals({});
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!user || !session?.access_token) return;
    setLoadingObjects(true);
    setError(null);
    try {
      const [storageAssets, clothingResponse] = await Promise.all([
        listGlbs(user.id),
        fetch("/api/assets/export-unreal", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        }),
      ]);
      const clothingData = (await clothingResponse.json().catch(() => ({}))) as ClothingResponse;
      if (!clothingResponse.ok) throw new Error(clothingData.error || "No se pudieron cargar tus piezas");

      const clothingAssets: ClothingAsset[] = (clothingData.items ?? []).map((item) => ({
        id: `clothing:${item.id}`,
        kind: "clothing",
        name: item.name,
        clothingItemId: item.id,
        category: item.category,
        modelUrl: item.modelUrl,
        thumbnailUrl: item.thumbnailUrl,
        rigged: item.rigged === true,
        fitStatus: item.fitStatus,
        label: `${CATEGORY_LABELS[item.category] || "Objeto"} · ${item.name}${item.rigged ? " · rig real" : " · Meshy"}`,
      }));

      const next: ObjectAsset[] = [...clothingAssets, ...storageAssets];
      setObjects(next);
      setSelectedId((current) => (next.some((item) => item.id === current) ? current : next[0]?.id || ""));
    } catch (cause) {
      setObjects([]);
      setSelectedId("");
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los objetos");
    } finally {
      setLoadingObjects(false);
    }
  }, [session?.access_token, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectObject = (nextId: string) => {
    setSelectedId(nextId);
    setResult(null);
    setError(null);
    setDiagnostics(null);
    setDiagnosticError(null);
    setShowDiagnostics(false);
    setReviewView("Frente");
    setReviewPose("Idle");
    setPreviewStatus("Cargando el objeto seleccionado…");
    setViewerRevision((value) => value + 1);
  };

  const exportObject = async () => {
    const selected = objects.find((item) => item.id === selectedId);
    if (!selected || !session?.access_token) return;
    setExporting(true);
    setResult(null);
    setError(null);
    try {
      const requestBody = selected.kind === "clothing"
        ? { clothingItemId: selected.clothingItemId, name: selected.name }
        : { bucket: "creator-assets", path: selected.path, name: selected.name };

      const response = await fetch("/api/assets/export-unreal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(requestBody),
      });
      const data = (await response.json().catch(() => ({}))) as ExportResult;
      if (!response.ok || !data.url) throw new Error(data.error || `No se pudo generar el FBX (${response.status})`);
      setResult(data);
      const link = document.createElement("a");
      link.href = data.url;
      link.download = data.filename || "clouva-object-unreal.fbx";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo exportar el objeto");
    } finally {
      setExporting(false);
    }
  };

  const diagnoseWorker = async () => {
    const selected = objects.find((item) => item.id === selectedId);
    if (selected?.kind !== "clothing" || !session?.access_token) return;
    setDiagnosing(true);
    setDiagnosticError(null);
    setDiagnostics(null);
    setShowDiagnostics(true);
    try {
      const response = await fetch("/api/assets/export-unreal/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ clothingItemId: selected.clothingItemId, runPipeline: true }),
      });
      const data = (await response.json().catch(() => ({}))) as WorkerDiagnostics;
      if (!response.ok) throw new Error(data.error || `No se pudo inspeccionar el Worker (${response.status})`);
      setDiagnostics(data);
    } catch (cause) {
      setDiagnosticError(cause instanceof Error ? cause.message : "No se pudo abrir el Inspector del Worker");
    } finally {
      setDiagnosing(false);
    }
  };

  if (loading || !user) return null;

  const selected = objects.find((item) => item.id === selectedId);
  const filteredObjects = objects.filter((item) => item.label.toLowerCase().includes(searchTerm.trim().toLowerCase()));
  const isRiggedClothing = selected?.kind === "clothing" && selected.rigged;
  const approved = Boolean(isRiggedClothing && approvals[selected.id] === true);
  const previewReady = selected?.kind !== "clothing" || Boolean(isRiggedClothing && previewStatus.startsWith("✓"));
  const rigReady = selected?.kind === "clothing" ? selected.rigged : true;
  const workerReady = diagnostics?.ok === true;
  const sourceDimensions = diagnostics?.garment?.evaluatedBounds?.dimensionsCm;
  const rawDimensions = diagnostics?.garment?.rawBounds?.dimensionsCm;
  const outputDimensions = diagnostics?.outputInspection?.garment?.evaluatedBounds?.dimensionsCm;
  const canExport = Boolean(
    selected
    && !exporting
    && !diagnosing
    && (selected.kind !== "clothing" || (selected.rigged && approved)),
  );

  const toggleApproval = () => {
    if (!selected || selected.kind !== "clothing" || !selected.rigged || !previewReady) return;
    const next = { ...approvals, [selected.id]: !approved };
    setApprovals(next);
    try {
      window.localStorage.setItem(APPROVAL_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // La aprobación sigue disponible durante la sesión aunque el navegador bloquee storage.
    }
  };

  const pipelineLabel = diagnosing
    ? "Blender procesando"
    : workerReady
      ? "Worker revisado"
      : diagnostics || diagnosticError
        ? "Requiere revisión"
        : "Sin revisar";

  const exportLabel = result?.url
    ? "FBX listo"
    : selected?.kind === "clothing" && !selected.rigged
      ? "Falta rig real"
      : approved
        ? "Aprobado para exportar"
        : "Pendiente de aprobación";

  return (
    <section id="unreal-objects" className={styles.card} aria-label="Estudio visual para exportar objetos a Unreal">
      <div className={styles.heading}>
        <span className={styles.icon}><PackageOpen /></span>
        <div>
          <small>ESTUDIO DE REVISIÓN CLOUVA</small>
          <h2>Revisar y exportar a Unreal</h2>
          <p>La prenda solo aparece vestida cuando Blender ya creó un rig real compatible con tu avatar.</p>
        </div>
        <button className={styles.refresh} type="button" onClick={() => void refresh()} disabled={loadingObjects} aria-label="Actualizar objetos">
          <RefreshCw className={loadingObjects ? styles.spin : undefined} />
        </button>
      </div>

      {objects.length ? (
        <>
          <div className={styles.pipelineSummary}>
            <span><User /> <small>Avatar</small><strong>Tu cuerpo 3D activo</strong></span>
            <span><Shirt /> <small>Objeto</small><strong>{selected?.name || "Sin selección"}</strong></span>
            <span className={workerReady ? styles.summaryOk : undefined}><Activity /> <small>Blender</small><strong>{pipelineLabel}</strong></span>
            <span className={result?.url ? styles.summaryOk : approved ? styles.summaryApproved : undefined}><FileCheck2 /> <small>Exportación</small><strong>{exportLabel}</strong></span>
          </div>

          <div className={styles.reviewWorkspace}>
            <aside className={styles.objectLibrary} aria-label="Objetos guardados">
              <div className={styles.libraryHeader}>
                <div><small>BIBLIOTECA</small><strong>Objetos guardados</strong></div>
                <span>{objects.length}</span>
              </div>
              <label className={styles.searchBox}>
                <Search />
                <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Buscar prenda…" />
              </label>
              <div className={styles.objectList}>
                {filteredObjects.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.objectItem} ${item.id === selectedId ? styles.objectItemActive : ""}`}
                    onClick={() => selectObject(item.id)}
                    disabled={exporting || diagnosing}
                  >
                    <span className={styles.objectThumb}>
                      {item.kind === "clothing" && item.thumbnailUrl
                        ? <img src={item.thumbnailUrl} alt="" />
                        : item.kind === "clothing" ? <Shirt /> : <Box />}
                    </span>
                    <span className={styles.objectMeta}>
                      <strong>{item.name}</strong>
                      <small>{item.kind === "clothing" ? CATEGORY_LABELS[item.category] || "Objeto" : "Archivo GLB"}</small>
                    </span>
                    {item.kind === "clothing" ? (
                      <span className={item.rigged ? styles.itemReady : styles.itemRaw}>{item.rigged ? "RIG REAL" : "MESHY"}</span>
                    ) : null}
                  </button>
                ))}
                {!filteredObjects.length ? <p className={styles.noObjects}>No encontramos objetos con ese nombre.</p> : null}
              </div>
            </aside>

            <section className={styles.visualReview} aria-label="Vista previa real de la prenda">
              <div className={styles.reviewHeader}>
                <div>
                  <small>VISTA PREVIA PRINCIPAL</small>
                  <h3>{selected?.kind === "clothing" ? selected.rigged ? "Rig real sobre el avatar" : "Original de Meshy" : "Objeto que irá al FBX"}</h3>
                </div>
                {selected?.kind === "clothing" ? (
                  <span className={approved ? styles.approvedBadge : styles.pendingBadge}>
                    {approved ? <BadgeCheck /> : <CircleDot />}
                    {approved ? "APROBADA" : selected.rigged ? "PENDIENTE" : "SIN RIG"}
                  </span>
                ) : null}
              </div>

              <div className={styles.mainViewport}>
                {selected?.kind === "clothing" ? (
                  <RealGarmentReview
                    key={`${selected.id}-${viewerRevision}-${selected.rigged ? "rig" : "raw"}`}
                    itemId={selected.clothingItemId}
                    name={selected.name}
                    modelUrl={selected.modelUrl}
                    thumbnailUrl={selected.thumbnailUrl}
                    rigged={selected.rigged}
                    accessToken={session?.access_token || ""}
                    pose={reviewPose}
                    view={reviewView}
                    onStatus={setPreviewStatus}
                    onProcessed={async () => {
                      await refresh();
                      setViewerRevision((value) => value + 1);
                    }}
                  />
                ) : selected?.kind === "storage" ? (
                  <StandaloneObjectPreview key={`${selected.id}-${viewerRevision}`} modelUrl={supabase.storage.from("creator-assets").getPublicUrl(selected.path).data.publicUrl} />
                ) : (
                  <div className={styles.previewEmpty}>Elegí un objeto de la biblioteca para empezar la revisión.</div>
                )}
                {selected?.kind !== "clothing" || selected.rigged ? (
                  <div className={styles.viewportHint}><Eye /> Arrastrá para girar · rueda para acercar</div>
                ) : null}
              </div>

              {selected?.kind === "clothing" ? (
                <>
                  {selected.rigged ? (
                    <div className={styles.controlRows}>
                      <div className={styles.controlGroup}>
                        <span>Vista</span>
                        {(["Frente", "Lateral", "Espalda"] as ReviewView[]).map((view) => (
                          <button key={view} type="button" className={reviewView === view ? styles.controlActive : ""} onClick={() => setReviewView(view)}>{view === "Lateral" ? "Costado" : view}</button>
                        ))}
                      </div>
                      <div className={styles.controlGroup}>
                        <span>Pose real</span>
                        {([
                          ["Idle", "A pose"],
                          ["T-Pose", "T pose"],
                          ["Walk", "Caminar"],
                        ] as Array<[ReviewPose, string]>).map(([pose, label]) => (
                          <button key={pose} type="button" className={reviewPose === pose ? styles.controlActive : ""} onClick={() => setReviewPose(pose)}>{pose === "Walk" ? <Play /> : null}{label}</button>
                        ))}
                      </div>
                      <button className={styles.resetViewer} type="button" onClick={() => setViewerRevision((value) => value + 1)}><RotateCcw /> Restablecer</button>
                    </div>
                  ) : null}
                  <div className={styles.previewMessage}>
                    <CircleDot />
                    <span>{previewStatus}</span>
                  </div>
                </>
              ) : null}
            </section>
          </div>

          <section className={styles.resultReview} aria-label="Estado del resultado">
            <div className={styles.resultHeading}>
              <div><small>RESULTADO DEL PROCESO</small><h3>¿Está lista para salir?</h3></div>
              <span>{selected?.kind === "clothing" ? CATEGORY_LABELS[selected.category] || "Objeto" : "GLB"} · {selected?.name}</span>
            </div>
            <div className={styles.reviewChecks}>
              <article className={rigReady ? styles.checkReady : styles.checkPending}><CheckCircle2 /><div><small>Fitting</small><strong>{rigReady ? "Hecho" : "Falta procesar"}</strong></div></article>
              <article className={rigReady ? styles.checkReady : styles.checkPending}><Bone /><div><small>Rig y pesos</small><strong>{rigReady ? "Aplicados" : "Sin rig real"}</strong></div></article>
              <article className={styles.checkReady}><FileCheck2 /><div><small>Materiales</small><strong>Embebidos</strong></div></article>
              <article className={styles.checkReady}><Ruler /><div><small>Escala Unreal</small><strong>Uniform Scale = 1</strong></div></article>
              <article className={approved ? styles.checkReady : styles.checkPending}><BadgeCheck /><div><small>Aprobación visual</small><strong>{approved ? "Aprobada" : "Pendiente"}</strong></div></article>
            </div>

            <div className={styles.primaryActions}>
              {selected?.kind === "clothing" ? (
                <button className={styles.secondaryAction} type="button" onClick={() => void diagnoseWorker()} disabled={diagnosing || exporting}>
                  {diagnosing ? <Loader2 className={styles.spin} /> : <Settings2 />}
                  {diagnosing ? "BLENDER ESTÁ REVISANDO…" : "REVISAR CON BLENDER"}
                </button>
              ) : null}
              {selected?.kind === "clothing" ? (
                <button className={`${styles.approveAction} ${approved ? styles.approveActionActive : ""}`} type="button" onClick={toggleApproval} disabled={!selected.rigged || !previewReady || exporting || diagnosing}>
                  <BadgeCheck /> {approved ? "APROBACIÓN LISTA" : selected.rigged ? "APROBAR PRENDA" : "PRIMERO GENERÁ EL RIG REAL"}
                </button>
              ) : null}
              <button className={styles.exportButton} type="button" onClick={() => void exportObject()} disabled={!canExport}>
                {exporting ? <Loader2 className={styles.spin} /> : <Box />}
                {exporting ? "BLENDER ESTÁ PREPARANDO EL FBX…" : "EXPORTAR A UNREAL"}
              </button>
            </div>
            {selected?.kind === "clothing" && !selected.rigged ? (
              <p className={styles.approvalHint}>El Meshy original no se coloca sobre el cuerpo. Tocá “Generar vista riggeada real” dentro del visor y recién después probá brazos y caminar.</p>
            ) : selected?.kind === "clothing" && !approved ? (
              <p className={styles.approvalHint}>Probá la prenda riggeada en A pose, T pose y caminar; después tocá “Aprobar prenda”.</p>
            ) : null}
          </section>

          {result?.url ? <div className={styles.success}><CheckCircle2 /><span><strong>Objeto listo para Unreal</strong>{result.filename} · {result.scale}</span><a href={result.url} download={result.filename || true}><Download /> Descargar otra vez</a></div> : null}
          {error ? (
            <div className={styles.userError}>
              <TriangleAlert />
              <div><strong>No se pudo terminar la exportación</strong><span>{friendlyExportError(error)}</span></div>
              <details><summary>Ver error técnico</summary><pre>{error}</pre></details>
            </div>
          ) : null}

          {selected?.kind === "clothing" ? (
            <button className={styles.inspectorButton} type="button" onClick={() => setShowDiagnostics((value) => !value)} disabled={!diagnostics && !diagnosticError}>
              <Activity />
              <span>INSPECTOR TÉCNICO DEL WORKER</span>
              {showDiagnostics ? <ChevronUp /> : <ChevronDown />}
            </button>
          ) : null}

          {showDiagnostics ? (
            <section className={styles.diagnosticsPanel} aria-label="Inspector del Blender Worker">
              <div className={styles.diagnosticsHeader}>
                <div>
                  <small>BLENDER WORKER EN VIVO</small>
                  <h3>Qué entra, qué herramienta trabaja y dónde falla</h3>
                </div>
                {diagnostics ? (
                  <span className={diagnostics.ok ? styles.workerOnline : styles.workerWarning}>
                    <CircleDot /> {diagnostics.ok ? "PRUEBA COMPLETA" : "FALLA DETECTADA"}
                  </span>
                ) : null}
              </div>

              {diagnosing ? (
                <div className={styles.diagnosticsLoading}>
                  <Loader2 className={styles.spin} />
                  <div><strong>Ejecutando Blender real</strong><span>Importando GLB, midiendo geometría y probando el rig contra tu avatar.</span></div>
                </div>
              ) : null}

              {diagnosticError ? <div className={styles.diagnosticError}><TriangleAlert /><span>{diagnosticError}</span></div> : null}

              {diagnostics ? (
                <>
                  <div className={styles.workerVersions}>
                    <span><Cpu /> Blender {diagnostics.worker?.blenderVersion || "—"}</span>
                    <span><Wrench /> Rig {diagnostics.worker?.rigVersion || "—"}</span>
                    <span><Activity /> Recuperación {diagnostics.worker?.legacyRecoveryVersion || "—"}</span>
                    <span><FileCheck2 /> FBX {diagnostics.worker?.exportVersion || "—"}</span>
                  </div>

                  <div className={styles.metricsGrid}>
                    <article><Ruler /><span>Malla cruda</span><strong>{dimensions(rawDimensions)}</strong></article>
                    <article><Eye /><span>Forma visible</span><strong>{dimensions(sourceDimensions)}</strong></article>
                    <article><Bone /><span>Huesos detectados</span><strong>{diagnostics.garment?.boneCount ?? 0}</strong></article>
                    <article><Gauge /><span>Vértices con peso</span><strong>{percent(diagnostics.garment?.weightedVertexRatio)}</strong></article>
                    <article><Box /><span>Salida del rig</span><strong>{dimensions(outputDimensions)}</strong></article>
                    <article><Activity /><span>Diferencia visible</span><strong>{percent(diagnostics.garment?.evaluatedDifference?.maximumSizeError)}</strong></article>
                  </div>

                  <div className={styles.toolsSection}>
                    <h4>Herramientas activas</h4>
                    <div className={styles.toolsGrid}>
                      {(diagnostics.tools ?? []).map((tool) => (
                        <article key={tool.id}>
                          <span className={tool.status === "ready" ? styles.toolReady : styles.toolMissing}><CircleDot /></span>
                          <div><strong>{tool.name}</strong><small>{tool.script}{tool.version ? ` · ${tool.version}` : ""}</small><p>{tool.purpose}</p></div>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className={styles.pipelineSection}>
                    <h4>Recorrido de esta prenda</h4>
                    <div className={styles.stageList}>
                      {(diagnostics.stages ?? []).map((stage, index) => (
                        <article key={`${stage.id}-${index}`} className={styles[`stage_${stage.status}`]}>
                          <span className={styles.stageIcon}>{stageIcon(stage.status)}</span>
                          <div><strong>{stage.label}</strong><p>{stage.summary}</p></div>
                          <small>{STAGE_STATUS_LABELS[stage.status]}</small>
                        </article>
                      ))}
                    </div>
                  </div>

                  {diagnostics.diagnosis?.recommendedAction ? (
                    <div className={diagnostics.diagnosis.legacyGeometryDifferenceDetected ? styles.diagnosisWarning : styles.diagnosisOk}>
                      <Activity />
                      <div><strong>Lectura del Inspector</strong><span>{diagnostics.diagnosis.recommendedAction}</span></div>
                    </div>
                  ) : null}

                  <details className={styles.technicalDetails}>
                    <summary>Ver registro técnico completo</summary>
                    <pre>{JSON.stringify({
                      worker: diagnostics.worker,
                      garment: diagnostics.garment,
                      avatar: diagnostics.avatar,
                      pipeline: diagnostics.pipeline,
                      outputInspection: diagnostics.outputInspection,
                    }, null, 2)}</pre>
                  </details>
                </>
              ) : null}
            </section>
          ) : null}
        </>
      ) : (
        <div className={styles.empty}><PackageOpen /><span>{loadingObjects ? "Buscando tus objetos…" : "Todavía no hay piezas listas. Crealas desde Crear prenda con frente + espalda."}</span></div>
      )}
    </section>
  );
}
