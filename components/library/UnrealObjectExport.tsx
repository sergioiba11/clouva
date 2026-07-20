"use client";

import {
  Activity,
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
  RefreshCw,
  Ruler,
  TriangleAlert,
  Wrench,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
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

export function UnrealObjectExport() {
  const { user, session, loading } = useAuth();
  const [objects, setObjects] = useState<ObjectAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<WorkerDiagnostics | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        label: `${CATEGORY_LABELS[item.category] || "Objeto"} · ${item.name}${item.rigged ? " · ajustado" : ""}`,
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
  const sourceDimensions = diagnostics?.garment?.evaluatedBounds?.dimensionsCm;
  const rawDimensions = diagnostics?.garment?.rawBounds?.dimensionsCm;
  const outputDimensions = diagnostics?.outputInspection?.garment?.evaluatedBounds?.dimensionsCm;

  return (
    <section id="unreal-objects" className={styles.card} aria-label="Exportar objetos para Unreal">
      <div className={styles.heading}>
        <span className={styles.icon}><PackageOpen /></span>
        <div>
          <small>OBJETOS CLOUVA</small>
          <h2>Pasar objeto a Unreal</h2>
          <p>Las piezas creadas con frente + espalda aparecen acá cuando Meshy y Blender terminan.</p>
        </div>
        <button className={styles.refresh} type="button" onClick={() => void refresh()} disabled={loadingObjects} aria-label="Actualizar objetos">
          <RefreshCw className={loadingObjects ? styles.spin : undefined} />
        </button>
      </div>

      {objects.length ? (
        <>
          <label className={styles.selector}>
            <span>Objeto guardado</span>
            <select
              value={selectedId}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setResult(null);
                setError(null);
                setDiagnostics(null);
                setDiagnosticError(null);
                setShowDiagnostics(false);
              }}
              disabled={exporting || diagnosing}
            >
              {objects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>

          {selected?.kind === "clothing" ? (
            <section className={styles.preview} aria-label={`Vista previa del objeto ${selected.name}`}>
              <div className={styles.previewHeader}>
                <p className={styles.previewTitle}>
                  <Eye />
                  <span>OBJETO A EXPORTAR · {selected.name}</span>
                </p>
                <span className={styles.previewBadge}>{selected.rigged ? "RIGGEADO" : "GLB"}</span>
              </div>

              <div className={styles.previewViewport}>
                {selected.modelUrl ? (
                  <StandaloneObjectPreview modelUrl={selected.modelUrl} />
                ) : selected.thumbnailUrl ? (
                  <img src={selected.thumbnailUrl} alt={`Vista previa de ${selected.name}`} className={styles.previewImage} />
                ) : (
                  <div className={styles.previewEmpty}>Esta pieza no tiene una vista previa disponible, pero sigue lista para exportar.</div>
                )}
              </div>

              <div className={styles.previewFooter}>
                <span>{CATEGORY_LABELS[selected.category] || "Objeto"}</span>
                <span>Solo se muestra la malla que irá al FBX</span>
              </div>
            </section>
          ) : null}

          <div className={styles.specs}>
            <span><CheckCircle2 /> {selected?.kind === "clothing" && selected.rigged ? "Medidas calibradas al avatar activo" : "Escala original preservada"}</span>
            <span><CheckCircle2 /> Materiales embebidos</span>
            <span><CheckCircle2 /> Rig y skinning conservados</span>
            <span><CheckCircle2 /> Import Uniform Scale = 1</span>
          </div>

          {selected?.kind === "clothing" ? (
            <button className={styles.inspectorButton} type="button" onClick={() => void diagnoseWorker()} disabled={diagnosing || exporting}>
              {diagnosing ? <Loader2 className={styles.spin} /> : <Activity />}
              <span>{diagnosing ? "BLENDER ESTÁ REVISANDO CADA ETAPA…" : "ABRIR INSPECTOR DEL WORKER"}</span>
              {!diagnosing && (showDiagnostics ? <ChevronUp /> : <ChevronDown />)}
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

          <button className={styles.exportButton} type="button" onClick={() => void exportObject()} disabled={exporting || diagnosing || !selectedId}>
            {exporting ? <Loader2 className={styles.spin} /> : <Box />}
            {exporting ? "BLENDER ESTÁ PREPARANDO EL OBJETO…" : "GENERAR Y DESCARGAR OBJETO FBX"}
          </button>
        </>
      ) : (
        <div className={styles.empty}><PackageOpen /><span>{loadingObjects ? "Buscando tus objetos…" : "Todavía no hay piezas listas. Crealas desde Crear prenda con frente + espalda."}</span></div>
      )}

      {result?.url ? <div className={styles.success}><CheckCircle2 /><span><strong>Objeto listo para Unreal</strong>{result.filename} · {result.scale}</span><a href={result.url} download={result.filename || true}><Download /> Descargar otra vez</a></div> : null}
      {error ? <div className={styles.error}><TriangleAlert /><span>{error}</span></div> : null}
    </section>
  );
}
