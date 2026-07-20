"use client";

import {
  Activity,
  BadgeCheck,
  Bone,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Clock3,
  Cpu,
  Database,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  Gauge,
  HardDrive,
  Loader2,
  Maximize2,
  PackageOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Ruler,
  Search,
  Server,
  Settings2,
  Shirt,
  SlidersHorizontal,
  TriangleAlert,
  User,
  Wifi,
  WifiOff,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  OFFICIAL_CLOUVA_AVATAR,
  type ActiveAvatar,
  useActiveAvatarStore,
} from "@/lib/avatar-engine/active-avatar-store";
import { supabase } from "@/lib/supabase";
import { RealGarmentReview } from "./RealGarmentReview";
import { StandaloneObjectPreview } from "./StandaloneObjectPreview";
import styles from "./creator-studio-workspace.module.css";

type StorageAsset = {
  id: string;
  kind: "storage";
  name: string;
  path: string;
  label: string;
  sizeBytes?: number;
  updatedAt?: string;
};

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
type StorageEntry = { name: string; updated_at?: string; created_at?: string; metadata?: Record<string, unknown> | null };
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
type DiagnosticStage = { id: string; label: string; status: DiagnosticStatus; summary: string };
type WorkerTool = { id: string; name: string; script?: string; purpose?: string; version?: string; status?: string };
type AssetInspection = {
  meshCount?: number;
  armatureCount?: number;
  armatureName?: string;
  boneCount?: number;
  vertices?: number;
  polygons?: number;
  materials?: number;
  weightedVertexRatio?: number;
  rawBounds?: { dimensionsCm?: number[] } | null;
  evaluatedBounds?: { dimensionsCm?: number[] } | null;
  evaluatedDifference?: { maximumSizeError?: number; centerError?: number; different?: boolean } | null;
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
    memoryRssMb?: number;
    elapsedSeconds?: number;
  };
  diagnosis?: { legacyGeometryDifferenceDetected?: boolean; recommendedAction?: string };
  rigDiagnostics?: {
    armature?: string;
    boneCount?: number;
    canonicalHeight?: number;
    bindRestDifferenceAfter?: number;
    detectedScale?: number;
  };
};

type UnrealSnapshot = Record<string, any>;
type UnrealStatus = {
  status: "online" | "offline";
  capturedAt?: string | null;
  lastConnectionAt?: string | null;
  snapshot?: UnrealSnapshot | null;
  error?: string | null;
};

type AvatarChoice = { avatar: ActiveAvatar; label: string; detail: string; active: boolean };
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
const VISUAL_REVIEW_COPY = {
  raw: "Original de Meshy",
  blocked: "PRIMERO GENERÁ EL RIG REAL",
  ready: "RIG REAL",
} as const;

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
    if (folder && depth < 4) {
      found.push(...(await listGlbs(userId, fullPath, depth + 1)));
    } else if (/\.glb$/i.test(entry.name) && !/avatar/i.test(entry.name)) {
      const rawSize = Number(entry.metadata?.size ?? entry.metadata?.contentLength ?? 0);
      found.push({
        id: `storage:${fullPath}`,
        kind: "storage",
        name: entry.name,
        path: fullPath,
        label: `Archivo · ${entry.name.replace(/[-_]+/g, " ")}`,
        sizeBytes: Number.isFinite(rawSize) && rawSize > 0 ? rawSize : undefined,
        updatedAt: entry.updated_at ?? entry.created_at,
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

function formatBytes(value?: number | null) {
  if (!Number.isFinite(value) || !value) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
  if (/sigkill|-9|memory|memoria/i.test(raw)) return "Blender superó la memoria disponible. El último paso y el diagnóstico quedaron guardados abajo.";
  return "No se pudo terminar el FBX. El motivo técnico quedó guardado abajo.";
}

function avatarLabel(avatar: ActiveAvatar, index: number) {
  if (avatar.id === OFFICIAL_CLOUVA_AVATAR.id || avatar.source === "official") return "Avatar oficial CLOUVA";
  if (avatar.source === "uploaded") return `Avatar subido ${index + 1}`;
  return `Avatar generado ${index + 1}`;
}

function readSnapshot(snapshot?: UnrealSnapshot | null) {
  const skeletalMesh = String(snapshot?.skeletalMesh ?? snapshot?.skeletal_mesh ?? snapshot?.mesh?.path ?? "Sin snapshot");
  const bones = Array.isArray(snapshot?.bones) ? snapshot.bones.length : Number(snapshot?.boneCount ?? snapshot?.bone_count ?? 0);
  const height = Number(snapshot?.bounds?.imported?.sizeCm?.z ?? snapshot?.bounds?.sizeCm?.z ?? snapshot?.heightCm ?? 0);
  const scale = snapshot?.component?.worldTransform?.scale ?? snapshot?.actor?.worldTransform?.scale ?? snapshot?.scale ?? null;
  const scaleLabel = scale && typeof scale === "object"
    ? `${Number(scale.x ?? 1).toFixed(3)}, ${Number(scale.y ?? 1).toFixed(3)}, ${Number(scale.z ?? 1).toFixed(3)}`
    : "—";
  return {
    skeletalMesh,
    bones: Number.isFinite(bones) && bones > 0 ? bones : 0,
    height: Number.isFinite(height) && height > 0 ? `${height.toFixed(1)} cm` : "—",
    scale: scaleLabel,
  };
}

export function UnrealObjectExport() {
  const { user, session, loading } = useAuth();
  const activeAvatar = useActiveAvatarStore((state) => state.avatar);
  const loadActiveAvatar = useActiveAvatarStore((state) => state.loadActiveAvatar);
  const setActiveAvatar = useActiveAvatarStore((state) => state.setActiveAvatar);

  const [objects, setObjects] = useState<ObjectAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [avatarSearch, setAvatarSearch] = useState("");
  const [avatarChoices, setAvatarChoices] = useState<AvatarChoice[]>([]);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [loadingAvatars, setLoadingAvatars] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showAvatarLibrary, setShowAvatarLibrary] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [processingRig, setProcessingRig] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<WorkerDiagnostics | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [unrealStatus, setUnrealStatus] = useState<UnrealStatus>({ status: "offline", snapshot: null });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewView, setReviewView] = useState<ReviewView>("Frente");
  const [reviewPose, setReviewPose] = useState<ReviewPose>("Idle");
  const [viewerRevision, setViewerRevision] = useState(0);
  const [previewStatus, setPreviewStatus] = useState("Esperando una prenda para revisar.");
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [showAvatar, setShowAvatar] = useState(true);
  const [showGarment, setShowGarment] = useState(true);
  const [showRig, setShowRig] = useState(false);
  const [automaticFit, setAutomaticFit] = useState(true);
  const [settingsNotice, setSettingsNotice] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(APPROVAL_STORAGE_KEY);
      if (stored) setApprovals(JSON.parse(stored) as Record<string, boolean>);
    } catch {
      setApprovals({});
    }
  }, []);

  const refreshUnreal = useCallback(async () => {
    try {
      const response = await fetch("/api/unreal/avatar", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as UnrealStatus;
      setUnrealStatus({
        status: data.status === "online" ? "online" : "offline",
        capturedAt: data.capturedAt ?? null,
        lastConnectionAt: data.lastConnectionAt ?? null,
        snapshot: data.snapshot ?? null,
        error: data.error ?? null,
      });
    } catch (cause) {
      setUnrealStatus({ status: "offline", snapshot: null, error: cause instanceof Error ? cause.message : "No se pudo leer Unreal" });
    }
  }, []);

  const refreshAvatars = useCallback(async () => {
    if (!user) return;
    setLoadingAvatars(true);
    try {
      await loadActiveAvatar(user.id);
      const { data, error: avatarError } = await supabase
        .from("user_avatars")
        .select("id,source,status,model_url,front_rotation_y,updated_at,is_active")
        .eq("user_id", user.id)
        .eq("status", "ready")
        .is("archived_at", null)
        .not("model_url", "is", null)
        .order("updated_at", { ascending: false });
      if (avatarError) throw avatarError;
      const current = useActiveAvatarStore.getState().avatar;
      const mapped: AvatarChoice[] = (data ?? []).map((row: any, index: number) => {
        const avatar: ActiveAvatar = {
          id: String(row.id),
          source: row.source === "uploaded" ? "uploaded" : "generated",
          modelUrl: String(row.model_url),
          fallbackUrl: OFFICIAL_CLOUVA_AVATAR.modelUrl,
          status: "ready",
          frontRotationY: Number(row.front_rotation_y ?? 0),
          updatedAt: String(row.updated_at ?? new Date().toISOString()),
        };
        return {
          avatar,
          label: avatarLabel(avatar, index),
          detail: `${avatar.source === "uploaded" ? "Subido" : "Generado"} · ${formatDate(avatar.updatedAt)}`,
          active: current.id === avatar.id,
        };
      });
      const official: AvatarChoice = {
        avatar: OFFICIAL_CLOUVA_AVATAR,
        label: "Avatar oficial CLOUVA",
        detail: "Base oficial de respaldo",
        active: current.id === OFFICIAL_CLOUVA_AVATAR.id,
      };
      setAvatarChoices([official, ...mapped.filter((choice) => choice.avatar.id !== OFFICIAL_CLOUVA_AVATAR.id)]);
    } catch (cause) {
      console.error("Could not list CLOUVA avatars", cause);
      const current = useActiveAvatarStore.getState().avatar;
      setAvatarChoices([{ avatar: current, label: avatarLabel(current, 0), detail: "Avatar activo", active: true }]);
    } finally {
      setLoadingAvatars(false);
    }
  }, [loadActiveAvatar, user]);

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
        label: `${CATEGORY_LABELS[item.category] || "Objeto"} · ${item.name}${item.rigged ? " · rig real" : " · original"}`,
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
    void refreshAvatars();
    void refreshUnreal();
  }, [refresh, refreshAvatars, refreshUnreal]);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshUnreal(), 15000);
    return () => window.clearInterval(timer);
  }, [refreshUnreal]);

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
    setShowLibrary(false);
  };

  const chooseAvatar = async (choice: AvatarChoice) => {
    setActiveAvatar(choice.avatar);
    setAvatarChoices((current) => current.map((item) => ({ ...item, active: item.avatar.id === choice.avatar.id })));
    setShowAvatarLibrary(false);
    setPreviewStatus("Avatar seleccionado. Actualizando la vista real…");
    setViewerRevision((value) => value + 1);
    if (!user || choice.avatar.source === "official") return;
    try {
      await supabase.from("user_avatars").update({ is_active: false }).eq("user_id", user.id);
      await supabase.from("user_avatars").update({ is_active: true }).eq("user_id", user.id).eq("id", choice.avatar.id);
    } catch {
      // La selección sigue funcionando en esta sesión aunque RLS impida persistirla.
    }
  };

  const generateRig = async () => {
    const selected = objects.find((item) => item.id === selectedId);
    if (selected?.kind !== "clothing" || selected.rigged || !selected.modelUrl || !session?.access_token) return;
    const nextAttemptId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `attempt-${Date.now()}`;
    setAttemptId(nextAttemptId);
    setProcessingRig(true);
    setError(null);
    setPreviewStatus("Blender está ajustando la prenda al molde oficial y creando el rig…");
    try {
      const response = await fetch("/api/clothing/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ itemId: selected.clothingItemId, modelUrl: selected.modelUrl, attemptId: nextAttemptId }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; rigged?: boolean; error?: string; warning?: string };
      if (!response.ok || !data.ok || !data.rigged) throw new Error(data.error || data.warning || "Blender no pudo generar el rig real.");
      setPreviewStatus("✓ Prenda riggeada guardada. Cargando la preview sobre el avatar…");
      await refresh();
      setViewerRevision((value) => value + 1);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo procesar la prenda";
      setError(message);
      setPreviewStatus(message);
    } finally {
      setProcessingRig(false);
    }
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

  const selected = objects.find((item) => item.id === selectedId);
  const filteredObjects = objects.filter((item) => item.label.toLowerCase().includes(searchTerm.trim().toLowerCase()));
  const filteredAvatars = avatarChoices.filter((choice) => `${choice.label} ${choice.detail}`.toLowerCase().includes(avatarSearch.trim().toLowerCase()));

  if (loading || !user) return null;

  const isRiggedClothing = selected?.kind === "clothing" && selected.rigged;
  const approved = Boolean(isRiggedClothing && approvals[selected.id] === true);
  const previewReady = selected?.kind !== "clothing" || Boolean(isRiggedClothing && previewStatus.startsWith("✓"));
  const rigReady = selected?.kind === "clothing" ? selected.rigged : false;
  const sourceDimensions = diagnostics?.garment?.evaluatedBounds?.dimensionsCm;
  const rawDimensions = diagnostics?.garment?.rawBounds?.dimensionsCm;
  const outputDimensions = diagnostics?.outputInspection?.garment?.evaluatedBounds?.dimensionsCm;
  const snapshot = readSnapshot(unrealStatus.snapshot);
  const selectedThumbnail = selected?.kind === "clothing" ? selected.thumbnailUrl : undefined;
  const selectedSize = selected?.kind === "storage" ? selected.sizeBytes : diagnostics?.pipeline?.outputBytes;
  const selectedStatus = processingRig
    ? "Procesando"
    : selected?.kind === "clothing" && selected.rigged
      ? approved ? "Aprobada" : "Lista para revisar"
      : selected ? "GLB original" : "Sin selección";
  const workerProgress = processingRig || diagnosing ? 62 : rigReady ? 100 : selected ? 20 : 0;
  const currentStep = processingRig
    ? "Creando molde, rig y pesos"
    : diagnosing
      ? "Validando con Blender"
      : rigReady
        ? "Preview temporal disponible"
        : selected
          ? "Esperando generar rig"
          : "Esperando selección";
  const approvalBlocked = !selected || selected.kind !== "clothing" || !selected.rigged || !previewReady;
  const canExport = Boolean(
    selected
    && !exporting
    && !diagnosing
    && !processingRig
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

  const toggleFullscreen = async () => {
    const node = viewportRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      setPreviewStatus("El navegador no permitió abrir pantalla completa.");
    }
  };

  return (
    <section id="unreal-objects" className={styles.studio} aria-label="Creator Studio visual de CLOUVA">
      <header className={styles.studioHeader}>
        <div className={styles.brandMark}><PackageOpen /></div>
        <div>
          <small>CREATOR STUDIO</small>
          <h2>Obra digital 3D</h2>
          <p>Seleccioná una pieza existente, revisá cómo trabaja Blender y aprobá el resultado antes de guardarlo.</p>
        </div>
        <div className={styles.headerStatus}>
          <span className={unrealStatus.status === "online" ? styles.online : styles.offline}>
            {unrealStatus.status === "online" ? <Wifi /> : <WifiOff />}
            Unreal {unrealStatus.status === "online" ? "online" : "offline"}
          </span>
          <button type="button" onClick={() => { void refresh(); void refreshAvatars(); void refreshUnreal(); }} disabled={loadingObjects}>
            <RefreshCw className={loadingObjects ? styles.spin : undefined} /> Actualizar
          </button>
        </div>
      </header>

      {objects.length ? (
        <>
          <div className={styles.workspace}>
            <aside className={styles.flowColumn} aria-label="Flujo de creación">
              <div className={styles.panelTitle}><small>FLUJO DE CREACIÓN</small><strong>De la biblioteca al resultado</strong></div>
              <div className={styles.flowLine} />

              <article className={`${styles.flowStep} ${selected ? styles.flowReady : ""}`}>
                <span className={styles.stepNumber}>1</span>
                <div className={styles.stepHeading}><Database /><strong>GLB de biblioteca</strong>{selected ? <CheckCircle2 /> : <CircleDot />}</div>
                <div className={styles.stepAsset}>
                  <span className={styles.miniThumb}>{selectedThumbnail ? <img src={selectedThumbnail} alt="" /> : <Box />}</span>
                  <div><strong>{selected?.name || "Sin selección"}</strong><small>{selectedStatus}</small></div>
                </div>
                <button type="button" onClick={() => setShowLibrary(true)}>Cambiar <ChevronRight /></button>
              </article>

              <article className={`${styles.flowStep} ${activeAvatar.modelUrl ? styles.flowReady : ""}`}>
                <span className={styles.stepNumber}>2</span>
                <div className={styles.stepHeading}><User /><strong>Avatar</strong>{activeAvatar.modelUrl ? <CheckCircle2 /> : <CircleDot />}</div>
                <div className={styles.stepAsset}>
                  <span className={styles.miniThumb}><User /></span>
                  <div><strong>{avatarLabel(activeAvatar, 0)}</strong><small>{activeAvatar.source} · {activeAvatar.status}</small></div>
                </div>
                <button type="button" onClick={() => setShowAvatarLibrary(true)}>Cambiar <ChevronRight /></button>
              </article>

              <article className={`${styles.flowStep} ${rigReady ? styles.flowReady : styles.flowWarning}`}>
                <span className={styles.stepNumber}>3</span>
                <div className={styles.stepHeading}><Bone /><strong>Estado del rig</strong>{rigReady ? <CheckCircle2 /> : <TriangleAlert />}</div>
                {rigReady ? (
                  <div className={styles.rigSummary}>
                    <strong>Rig detectado</strong>
                    <span>{diagnostics?.garment?.boneCount ?? "—"} huesos · {diagnostics?.garment?.armatureName || diagnostics?.rigDiagnostics?.armature || "Armature oficial"}</span>
                    <small>Compatible con el avatar activo</small>
                  </div>
                ) : (
                  <div className={styles.rigSummary}>
                    <strong>No se encontró rig</strong>
                    <span>La pieza original todavía no tiene skinning real.</span>
                    <button type="button" className={styles.rigButton} onClick={() => void generateRig()} disabled={selected?.kind !== "clothing" || processingRig}>
                      {processingRig ? <Loader2 className={styles.spin} /> : <Wrench />}
                      {processingRig ? "Generando rig…" : "Generar rig"}
                    </button>
                  </div>
                )}
              </article>

              <article className={`${styles.flowStep} ${unrealStatus.status === "online" || unrealStatus.snapshot ? styles.flowReady : styles.flowMuted}`}>
                <span className={styles.stepNumber}>4</span>
                <div className={styles.stepHeading}><Server /><strong>Datos del avatar</strong>{unrealStatus.status === "online" ? <CheckCircle2 /> : <CircleDot />}</div>
                <dl className={styles.snapshotData}>
                  <div><dt>Conexión</dt><dd>{unrealStatus.status === "online" ? "Conectado" : "Snapshot guardado"}</dd></div>
                  <div><dt>Skeletal Mesh</dt><dd title={snapshot.skeletalMesh}>{snapshot.skeletalMesh.split("/").pop()}</dd></div>
                  <div><dt>Huesos</dt><dd>{snapshot.bones || "—"}</dd></div>
                  <div><dt>Altura</dt><dd>{snapshot.height}</dd></div>
                  <div><dt>Escala</dt><dd>{snapshot.scale}</dd></div>
                </dl>
              </article>
            </aside>

            <main className={styles.centerColumn}>
              <div className={styles.selectorCards}>
                <button type="button" className={styles.selectorCard} onClick={() => setShowLibrary(true)}>
                  <span className={styles.selectorIcon}><Box /></span>
                  <div><small>BOTÓN PARA SELECCIONAR</small><strong>GLB de biblioteca</strong><p>Seleccioná una prenda existente en tu biblioteca.</p></div>
                  <ChevronRight />
                </button>
                <button type="button" className={styles.selectorCard} onClick={() => setShowAvatarLibrary(true)}>
                  <span className={styles.selectorIcon}><User /></span>
                  <div><small>BOTÓN PARA SELECCIONAR</small><strong>Avatar</strong><p>Seleccioná el avatar que funcionará como molde.</p></div>
                  <ChevronRight />
                </button>
              </div>

              <section className={styles.viewportPanel} aria-label="Visor 3D principal">
                <div className={styles.viewportTopbar}>
                  <div><small>VISTA PREVIA REAL</small><strong>{selected?.name || "Sin prenda"}</strong></div>
                  <span className={rigReady ? styles.viewportReady : styles.viewportPending}>{rigReady ? VISUAL_REVIEW_COPY.ready : VISUAL_REVIEW_COPY.raw.toUpperCase()}</span>
                </div>

                <div className={styles.viewport} ref={viewportRef}>
                  <div className={styles.viewportToolbar}>
                    <button type="button" className={showAvatar ? styles.toolActive : ""} onClick={() => setShowAvatar((value) => !value)} title="Mostrar u ocultar avatar">{showAvatar ? <User /> : <EyeOff />}</button>
                    <button type="button" className={showGarment ? styles.toolActive : ""} onClick={() => setShowGarment((value) => !value)} title="Mostrar u ocultar prenda">{showGarment ? <Shirt /> : <EyeOff />}</button>
                    <button type="button" className={showRig ? styles.toolActive : ""} onClick={() => setShowRig((value) => !value)} title="Mostrar u ocultar rig"><Bone /></button>
                    <button type="button" onClick={() => setViewerRevision((value) => value + 1)} title="Centrar vista"><RotateCcw /></button>
                  </div>
                  <button type="button" className={styles.fullscreenButton} onClick={() => void toggleFullscreen()} title="Pantalla completa"><Maximize2 /></button>

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
                      showAvatar={showAvatar}
                      showGarment={showGarment}
                      showRig={showRig}
                      onStatus={setPreviewStatus}
                      onProcessed={async () => {
                        await refresh();
                        setViewerRevision((value) => value + 1);
                      }}
                    />
                  ) : selected?.kind === "storage" ? (
                    <div className={showGarment ? styles.storagePreview : styles.hiddenPreview}>
                      <StandaloneObjectPreview key={`${selected.id}-${viewerRevision}`} modelUrl={supabase.storage.from("creator-assets").getPublicUrl(selected.path).data.publicUrl} />
                    </div>
                  ) : (
                    <div className={styles.previewEmpty}>Elegí un GLB de la biblioteca para comenzar.</div>
                  )}
                  <div className={styles.floorRing} />
                  <div className={styles.viewportHint}><Eye /> Arrastrá para girar · rueda para acercar</div>
                </div>

                <div className={styles.viewerControls}>
                  <div>
                    <span>Vista</span>
                    {(["Frente", "Lateral", "Espalda"] as ReviewView[]).map((view) => (
                      <button key={view} type="button" className={reviewView === view ? styles.controlActive : ""} onClick={() => setReviewView(view)}>{view === "Lateral" ? "Costado" : view}</button>
                    ))}
                  </div>
                  <div>
                    <span>Pose</span>
                    {([["Idle", "A-Pose"], ["T-Pose", "T-Pose"], ["Walk", "Caminar"]] as Array<[ReviewPose, string]>).map(([pose, label]) => (
                      <button key={pose} type="button" className={reviewPose === pose ? styles.controlActive : ""} onClick={() => setReviewPose(pose)}>{pose === "Walk" ? <Play /> : null}{label}</button>
                    ))}
                  </div>
                  <p>{previewStatus}</p>
                </div>
              </section>

              <section className={styles.processPanel}>
                <div className={styles.processHeading}><div><small>PROCESO TÉCNICO</small><strong>Unreal → Blender Worker → Preview → Resultado</strong></div><span>{workerProgress}%</span></div>
                <div className={styles.progressBar}><span style={{ width: `${workerProgress}%` }} /></div>
                <div className={styles.processCards}>
                  <article className={unrealStatus.snapshot ? styles.processDone : ""}>
                    <span><Server /></span><div><small>UNREAL ENGINE</small><strong>Datos del cuerpo</strong><p>{unrealStatus.snapshot ? "Snapshot recibido" : "Esperando datos"}</p></div><ChevronRight />
                  </article>
                  <article className={processingRig || diagnosing ? styles.processActive : rigReady ? styles.processDone : ""}>
                    <span><Wrench /></span><div><small>BLENDER WORKER</small><strong>{currentStep}</strong><p>{diagnostics?.pipeline?.memoryRssMb ? `${diagnostics.pipeline.memoryRssMb.toFixed(0)} MB RAM` : "Memoria registrada en logs"}</p></div><ChevronRight />
                  </article>
                  <article className={rigReady ? styles.processDone : ""}>
                    <span><Eye /></span><div><small>PREVIEW TEMPORAL</small><strong>{rigReady ? "Disponible" : "Pendiente"}</strong><p>{diagnostics?.worker?.rigVersion || attemptId || "Sin intento"}</p></div><ChevronRight />
                  </article>
                  <article className={approved ? styles.processDone : rigReady ? styles.processActive : ""}>
                    <span><BadgeCheck /></span><div><small>RESULTADO</small><strong>{approved ? "Aprobada" : rigReady ? "Lista para aprobar" : "Pendiente"}</strong><p>Prenda acomodada al molde</p></div>
                  </article>
                </div>
              </section>
            </main>

            <aside className={styles.rightColumn} aria-label="Datos y configuración">
              <section className={styles.dataCard}>
                <div className={styles.panelTitle}><small>DATOS DE PRENDA</small><strong>{selected?.name || "Sin selección"}</strong></div>
                <div className={styles.garmentHero}>
                  <span>{selectedThumbnail ? <img src={selectedThumbnail} alt="" /> : <Shirt />}</span>
                  <div><strong>{selected?.name || "—"}</strong><small>{selected?.kind === "clothing" ? CATEGORY_LABELS[selected.category] || "Objeto" : "Archivo GLB"}</small><em>{selectedStatus}</em></div>
                </div>
                <dl className={styles.dataList}>
                  <div><dt>Archivo</dt><dd>{selected?.name || "—"}</dd></div>
                  <div><dt>Polígonos</dt><dd>{diagnostics?.garment?.polygons?.toLocaleString("es-AR") || "Sin medir"}</dd></div>
                  <div><dt>Vértices</dt><dd>{diagnostics?.garment?.vertices?.toLocaleString("es-AR") || "Sin medir"}</dd></div>
                  <div><dt>Materiales</dt><dd>{diagnostics?.garment?.materials ?? "—"}</dd></div>
                  <div><dt>Tamaño</dt><dd>{formatBytes(selectedSize)}</dd></div>
                  <div><dt>Rig detectado</dt><dd className={rigReady ? styles.goodValue : styles.warningValue}>{rigReady ? "Sí" : "No"}</dd></div>
                  <div><dt>Armature</dt><dd>{diagnostics?.garment?.armatureName || diagnostics?.rigDiagnostics?.armature || (rigReady ? "Oficial" : "—")}</dd></div>
                  <div><dt>Huesos</dt><dd>{diagnostics?.garment?.boneCount ?? diagnostics?.rigDiagnostics?.boneCount ?? "—"}</dd></div>
                  <div><dt>Dimensiones</dt><dd>{dimensions(sourceDimensions)}</dd></div>
                </dl>
              </section>

              <section className={styles.configCard}>
                <div className={styles.panelTitle}><small>CONFIGURACIÓN</small><strong>Ajuste al avatar</strong></div>
                <label className={styles.toggleRow}>
                  <div><strong>Ajuste automático</strong><span>Acomoda la prenda al molde oficial.</span></div>
                  <input type="checkbox" checked={automaticFit} onChange={(event) => setAutomaticFit(event.target.checked)} />
                  <i />
                </label>
                <div className={styles.futureBadge}><SlidersHorizontal /> AJUSTES FINOS · SIGUIENTE ETAPA</div>
                {["Holgura general", "Ancho de hombros", "Largo de mangas", "Largo de prenda", "Posición vertical", "Escala uniforme"].map((label, index) => (
                  <label className={styles.sliderRow} key={label}>
                    <span>{label}</span><input type="range" min="0" max="100" defaultValue={index === 0 ? 55 : 50} disabled /><output>{index === 0 ? "Auto" : "—"}</output>
                  </label>
                ))}
                <div className={styles.selectRows}>
                  <label><span>Colisión</span><select disabled><option>Avatar (cuerpo)</option></select></label>
                  <label><span>Resolución</span><select disabled><option>Alta</option></select></label>
                </div>
                <button type="button" className={styles.applyButton} onClick={() => { setViewerRevision((value) => value + 1); setSettingsNotice(true); window.setTimeout(() => setSettingsNotice(false), 2500); }}>
                  <RefreshCw /> Aplicar y actualizar vista
                </button>
                {settingsNotice ? <p className={styles.settingsNotice}>Vista actualizada. Los sliders se conectarán por checkpoints en la siguiente etapa.</p> : null}
              </section>

              <section className={styles.actionCard}>
                <button type="button" className={styles.inspectAction} onClick={() => void diagnoseWorker()} disabled={selected?.kind !== "clothing" || diagnosing || processingRig}>
                  {diagnosing ? <Loader2 className={styles.spin} /> : <Settings2 />}{diagnosing ? "BLENDER ESTÁ REVISANDO…" : "REVISAR CON BLENDER"}
                </button>
                <button type="button" className={`${styles.approveAction} ${approved ? styles.approvedAction : ""}`} onClick={toggleApproval} disabled={approvalBlocked || diagnosing || processingRig}>
                  <BadgeCheck /> {approved ? "APROBACIÓN LISTA" : approvalBlocked ? VISUAL_REVIEW_COPY.blocked : "APROBAR PRENDA"}
                </button>
                <button type="button" className={styles.exportAction} onClick={() => void exportObject()} disabled={!canExport}>
                  {exporting ? <Loader2 className={styles.spin} /> : <Box />}{exporting ? "PREPARANDO FBX…" : "EXPORTAR A UNREAL"}
                </button>
              </section>
            </aside>
          </div>

          {result?.url ? <div className={styles.success}><CheckCircle2 /><span><strong>Objeto listo para Unreal</strong>{result.filename} · {result.scale}</span><a href={result.url} download={result.filename || true}><Download /> Descargar otra vez</a></div> : null}
          {error ? (
            <div className={styles.userError}>
              <TriangleAlert /><div><strong>No se pudo terminar el proceso</strong><span>{friendlyExportError(error)}</span></div><details><summary>Ver error técnico</summary><pre>{error}</pre></details>
            </div>
          ) : null}

          <button className={styles.logsToggle} type="button" onClick={() => setShowDiagnostics((value) => !value)}>
            <Activity /><span>Ver logs del proceso</span><small>INSPECTOR TÉCNICO DEL WORKER</small>{showDiagnostics ? <ChevronUp /> : <ChevronDown />}
          </button>

          {showDiagnostics ? (
            <section className={styles.diagnosticsPanel} aria-label="Inspector del Blender Worker">
              <div className={styles.diagnosticsHeader}>
                <div><small>BLENDER WORKER EN VIVO</small><h3>Hora, etapa, memoria, escala, armature y diferencia Rest/Bind</h3></div>
                {diagnostics ? <span className={diagnostics.ok ? styles.workerOnline : styles.workerWarning}><CircleDot /> {diagnostics.ok ? "PRUEBA COMPLETA" : "FALLA DETECTADA"}</span> : null}
              </div>
              {diagnosing ? <div className={styles.diagnosticsLoading}><Loader2 className={styles.spin} /><div><strong>Ejecutando Blender real</strong><span>Importando GLB, midiendo geometría y validando el rig.</span></div></div> : null}
              {diagnosticError ? <div className={styles.diagnosticError}><TriangleAlert /><span>{diagnosticError}</span></div> : null}
              <div className={styles.logOverview}>
                <article><Clock3 /><span>Hora</span><strong>{formatDate(diagnostics?.generatedAt || unrealStatus.capturedAt)}</strong></article>
                <article><Activity /><span>Etapa</span><strong>{currentStep}</strong></article>
                <article><HardDrive /><span>Memoria</span><strong>{diagnostics?.pipeline?.memoryRssMb ? `${diagnostics.pipeline.memoryRssMb.toFixed(0)} MB` : "Se registra por checkpoint"}</strong></article>
                <article><Ruler /><span>Escala</span><strong>{diagnostics?.rigDiagnostics?.detectedScale?.toFixed(6) || snapshot.scale}</strong></article>
                <article><Bone /><span>Armature</span><strong>{diagnostics?.rigDiagnostics?.armature || diagnostics?.garment?.armatureName || "—"}</strong></article>
                <article><Gauge /><span>Rest / Bind</span><strong>{diagnostics?.rigDiagnostics?.bindRestDifferenceAfter?.toFixed(6) || "—"}</strong></article>
              </div>

              {diagnostics ? (
                <>
                  <div className={styles.workerVersions}>
                    <span><Cpu /> Blender {diagnostics.worker?.blenderVersion || "—"}</span><span><Wrench /> Rig {diagnostics.worker?.rigVersion || "—"}</span><span><Activity /> Recuperación {diagnostics.worker?.legacyRecoveryVersion || "—"}</span><span><FileCheck2 /> FBX {diagnostics.worker?.exportVersion || "—"}</span>
                  </div>
                  <div className={styles.metricsGrid}>
                    <article><Ruler /><span>Malla cruda</span><strong>{dimensions(rawDimensions)}</strong></article><article><Eye /><span>Forma visible</span><strong>{dimensions(sourceDimensions)}</strong></article><article><Bone /><span>Huesos detectados</span><strong>{diagnostics.garment?.boneCount ?? 0}</strong></article><article><Gauge /><span>Vértices con peso</span><strong>{percent(diagnostics.garment?.weightedVertexRatio)}</strong></article><article><Box /><span>Salida del rig</span><strong>{dimensions(outputDimensions)}</strong></article><article><Activity /><span>Diferencia visible</span><strong>{percent(diagnostics.garment?.evaluatedDifference?.maximumSizeError)}</strong></article>
                  </div>
                  <div className={styles.toolsSection}><h4>Herramientas activas</h4><div className={styles.toolsGrid}>{(diagnostics.tools ?? []).map((tool) => <article key={tool.id}><span className={tool.status === "ready" ? styles.toolReady : styles.toolMissing}><CircleDot /></span><div><strong>{tool.name}</strong><small>{tool.script}{tool.version ? ` · ${tool.version}` : ""}</small><p>{tool.purpose}</p></div></article>)}</div></div>
                  <div className={styles.pipelineSection}><h4>Recorrido de esta prenda</h4><div className={styles.stageList}>{(diagnostics.stages ?? []).map((stage, index) => <article key={`${stage.id}-${index}`} className={styles[`stage_${stage.status}`]}><span className={styles.stageIcon}>{stageIcon(stage.status)}</span><div><strong>{stage.label}</strong><p>{stage.summary}</p></div><small>{STAGE_STATUS_LABELS[stage.status]}</small></article>)}</div></div>
                  {diagnostics.diagnosis?.recommendedAction ? <div className={diagnostics.diagnosis.legacyGeometryDifferenceDetected ? styles.diagnosisWarning : styles.diagnosisOk}><Activity /><div><strong>Lectura del Inspector</strong><span>{diagnostics.diagnosis.recommendedAction}</span></div></div> : null}
                  <details className={styles.technicalDetails}><summary>Ver registro técnico completo</summary><pre>{JSON.stringify({ worker: diagnostics.worker, garment: diagnostics.garment, avatar: diagnostics.avatar, pipeline: diagnostics.pipeline, rigDiagnostics: diagnostics.rigDiagnostics, outputInspection: diagnostics.outputInspection }, null, 2)}</pre></details>
                </>
              ) : <p className={styles.noLogs}>Tocá “REVISAR CON BLENDER” para generar el diagnóstico real de esta pieza.</p>}
            </section>
          ) : null}
        </>
      ) : (
        <div className={styles.empty}><PackageOpen /><span>{loadingObjects ? "Buscando tus GLB…" : "Todavía no hay piezas en tu biblioteca."}</span></div>
      )}

      {showLibrary ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowLibrary(false); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Seleccionar GLB de biblioteca">
            <header><div><small>BIBLIOTECA CLOUVA</small><h3>Seleccionar GLB existente</h3><p>No se suben archivos desde esta pantalla. Elegí uno que ya esté en Supabase/Storage.</p></div><button type="button" onClick={() => setShowLibrary(false)}><X /></button></header>
            <label className={styles.modalSearch}><Search /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Buscar por nombre o categoría…" /></label>
            <div className={styles.modalGrid}>
              {filteredObjects.map((item) => (
                <button key={item.id} type="button" className={item.id === selectedId ? styles.modalItemActive : ""} onClick={() => selectObject(item.id)}>
                  <span>{item.kind === "clothing" && item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : item.kind === "clothing" ? <Shirt /> : <Box />}</span>
                  <div><strong>{item.name}</strong><small>{item.kind === "clothing" ? CATEGORY_LABELS[item.category] || "Objeto" : "Archivo GLB"}</small><p>{item.kind === "clothing" ? item.rigged ? "Resultado riggeado" : "GLB original" : "Guardado en Storage"}</p></div>
                  <em>{item.id === selectedId ? "EN USO" : "Usar este GLB"}</em>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {showAvatarLibrary ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowAvatarLibrary(false); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Seleccionar avatar">
            <header><div><small>AVATARES DEL USUARIO</small><h3>Seleccionar avatar molde</h3><p>El visor y el Worker usarán el avatar elegido como cuerpo principal.</p></div><button type="button" onClick={() => setShowAvatarLibrary(false)}><X /></button></header>
            <label className={styles.modalSearch}><Search /><input value={avatarSearch} onChange={(event) => setAvatarSearch(event.target.value)} placeholder="Buscar avatar…" /></label>
            <div className={styles.avatarGrid}>
              {loadingAvatars ? <div className={styles.modalLoading}><Loader2 className={styles.spin} /> Cargando avatares…</div> : filteredAvatars.map((choice) => (
                <button key={choice.avatar.id} type="button" className={choice.active ? styles.modalItemActive : ""} onClick={() => void chooseAvatar(choice)}>
                  <span><User /></span><div><strong>{choice.label}</strong><small>{choice.detail}</small><p>{choice.avatar.modelUrl ? "GLB disponible" : "Sin modelo"}</p></div><em>{choice.active ? "ACTIVO" : "Usar avatar"}</em>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
