"use client";

import {
  Bone,
  Box,
  CheckCircle2,
  Download,
  FileBox,
  Loader2,
  RefreshCw,
  Server,
  Shirt,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { RigApprovalWorkspace } from "@/components/creator-studio/RigApprovalWorkspace";
import {
  OFFICIAL_CLOUVA_AVATAR,
  type ActiveAvatar,
  useActiveAvatarStore,
} from "@/lib/avatar-engine/active-avatar-store";
import { supabase } from "@/lib/supabase";
import styles from "./creator-studio-simple.module.css";

type StorageEntry = {
  name: string;
  metadata?: Record<string, unknown> | null;
};

type CreatorAsset = {
  id: string;
  kind: "clothing" | "storage";
  name: string;
  category?: string;
  clothingItemId?: string;
  modelUrl?: string;
  storagePath?: string;
  rigged: boolean;
};

type AvatarChoice = {
  avatar: ActiveAvatar;
  label: string;
  detail: string;
};

type UnrealSnapshot = Record<string, unknown>;

type UnrealStatus = {
  status: "online" | "offline";
  capturedAt?: string | null;
  snapshot?: UnrealSnapshot | null;
  error?: string | null;
};

type RigFeatureReport = {
  complete?: boolean;
  boneCount?: number;
  version?: string;
  rigSource?: string;
  inputSource?: string;
  runId?: string;
  durationMs?: number;
  inputSha256?: string;
  outputSha256?: string;
  fingers?: { complete?: boolean; leftChains?: number; rightChains?: number; weightedVertices?: number };
  ears?: { complete?: boolean; left?: boolean; right?: boolean; weightedVertices?: number };
};

type RigApiResponse = {
  alreadyRigged?: boolean;
  taskId?: string;
  status?: string;
  progress?: number;
  newAvatarUrl?: string;
  sourceAvatarId?: string | null;
  rigProfile?: RigFeatureReport | null;
  workerVersion?: string;
  rigRunId?: string;
  rigDurationMs?: number;
  inputSha256?: string;
  outputSha256?: string;
  task?: { status?: string; progress?: number; task_error?: { message?: string } };
  task_error?: { message?: string };
  error?: string;
};

type UnrealExport = {
  url?: string;
  filename?: string;
  error?: string;
};

type ClothingResponse = {
  items?: Array<{
    id: string;
    name: string;
    category: string;
    modelUrl?: string;
    rigged: boolean;
  }>;
  error?: string;
};

const TERMINAL_RIG_FAILURES = new Set(["FAILED", "EXPIRED", "CANCELED"]);
const COMPLETE_RIG_FILE = /clouva-complete-rigged\.glb/i;
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function avatarLabel(avatar: ActiveAvatar, index = 0) {
  if (avatar.source === "official" || avatar.id === OFFICIAL_CLOUVA_AVATAR.id) return "Avatar oficial CLOUVA";
  return avatar.source === "uploaded" ? `Avatar subido ${index + 1}` : `Avatar creado ${index + 1}`;
}

async function listStorageGlbs(userId: string, path = userId, depth = 0): Promise<CreatorAsset[]> {
  const { data, error } = await supabase.storage.from("creator-assets").list(path, {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  });
  if (error) return [];

  const result: CreatorAsset[] = [];
  for (const raw of data ?? []) {
    const entry = raw as StorageEntry;
    const fullPath = `${path}/${entry.name}`;
    const folder = !entry.metadata && !entry.name.includes(".");
    if (folder && depth < 4) {
      result.push(...(await listStorageGlbs(userId, fullPath, depth + 1)));
      continue;
    }
    if (!/\.glb$/i.test(entry.name) || /avatar/i.test(entry.name)) continue;
    const { data: signed } = await supabase.storage.from("creator-assets").createSignedUrl(fullPath, 3600);
    result.push({
      id: `storage:${fullPath}`,
      kind: "storage",
      name: entry.name.replace(/[-_]+/g, " ").replace(/\.glb$/i, ""),
      modelUrl: signed?.signedUrl,
      storagePath: fullPath,
      rigged: /rigged|processed|final/i.test(fullPath),
    });
  }
  return result;
}

export function CreatorStudioSimple() {
  const { user, session, loading } = useAuth();
  const activeAvatar = useActiveAvatarStore((state) => state.avatar);
  const setActiveAvatar = useActiveAvatarStore((state) => state.setActiveAvatar);
  const loadActiveAvatar = useActiveAvatarStore((state) => state.loadActiveAvatar);

  const [assets, setAssets] = useState<CreatorAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [avatars, setAvatars] = useState<AvatarChoice[]>([]);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingAvatars, setLoadingAvatars] = useState(false);

  const [unreal, setUnreal] = useState<UnrealStatus>({ status: "offline", snapshot: null });
  const [bodyDataReady, setBodyDataReady] = useState(false);
  const [avatarRigging, setAvatarRigging] = useState(false);
  const [avatarRigProgress, setAvatarRigProgress] = useState(0);
  const [rigProfile, setRigProfile] = useState<RigFeatureReport | null>(null);
  const [rigApproved, setRigApproved] = useState(false);
  const [avatarExporting, setAvatarExporting] = useState(false);
  const [avatarFbx, setAvatarFbx] = useState<UnrealExport | null>(null);
  const [garmentRigging, setGarmentRigging] = useState(false);
  const [viewerRevision, setViewerRevision] = useState(0);
  const [message, setMessage] = useState("Elegí un GLB para comenzar.");
  const [error, setError] = useState<string | null>(null);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  const avatarRigReady = Boolean(
    rigProfile?.complete === true
    || (activeAvatar.modelUrl && COMPLETE_RIG_FILE.test(activeAvatar.modelUrl)),
  );

  const requestRig = useCallback(async (body: Record<string, unknown>) => {
    if (!session?.access_token) throw new Error("Tu sesión venció. Volvé a iniciar sesión.");
    const response = await fetch("/api/avatar/rig", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as RigApiResponse;
    if (!response.ok) throw new Error(data.error || `No se pudo procesar el rig (${response.status}).`);
    return data;
  }, [session?.access_token]);

  const loadAssets = useCallback(async () => {
    if (!user || !session?.access_token) return;
    setLoadingAssets(true);
    try {
      const [stored, response] = await Promise.all([
        listStorageGlbs(user.id),
        fetch("/api/assets/export-unreal", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        }),
      ]);
      const data = (await response.json().catch(() => ({}))) as ClothingResponse;
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar tus GLB.");
      const clothing: CreatorAsset[] = (data.items ?? []).map((item) => ({
        id: `clothing:${item.id}`,
        kind: "clothing",
        clothingItemId: item.id,
        name: item.name,
        category: item.category,
        modelUrl: item.modelUrl,
        rigged: item.rigged === true,
      }));
      const next = [...clothing, ...stored];
      setAssets(next);
      setSelectedAssetId((current) => next.some((asset) => asset.id === current) ? current : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los GLB.");
    } finally {
      setLoadingAssets(false);
    }
  }, [session?.access_token, user]);

  const loadAvatars = useCallback(async () => {
    if (!user) return;
    setLoadingAvatars(true);
    try {
      const { data, error: avatarError } = await supabase
        .from("user_avatars")
        .select("id,source,status,model_url,front_rotation_y,updated_at")
        .eq("user_id", user.id)
        .eq("status", "ready")
        .is("archived_at", null)
        .not("model_url", "is", null)
        .order("updated_at", { ascending: false });
      if (avatarError) throw avatarError;

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
          detail: `${avatar.source === "uploaded" ? "Subido" : "Creado"} · ${formatDate(avatar.updatedAt)}`,
        };
      });
      setAvatars(mapped.length > 0 ? mapped : [
        { avatar: OFFICIAL_CLOUVA_AVATAR, label: "Avatar oficial CLOUVA", detail: "Base oficial" },
      ]);
    } catch (cause) {
      setAvatars([{ avatar: activeAvatar, label: "Avatar activo", detail: "Selección actual" }]);
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los avatares.");
    } finally {
      setLoadingAvatars(false);
    }
  }, [activeAvatar, user]);

  const readUnreal = useCallback(async (requireSnapshot = false) => {
    const response = await fetch("/api/unreal/avatar", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as UnrealStatus;
    const next: UnrealStatus = {
      status: data.status === "online" ? "online" : "offline",
      capturedAt: data.capturedAt ?? null,
      snapshot: data.snapshot ?? null,
      error: data.error ?? null,
    };
    setUnreal(next);
    if (requireSnapshot && !next.snapshot) throw new Error(next.error || "Unreal todavía no devolvió datos del cuerpo.");
    return next;
  }, []);

  useEffect(() => {
    if (!user || !session?.access_token) return;
    void loadAssets();
    void loadAvatars();
    void readUnreal(false);
  }, [loadAssets, loadAvatars, readUnreal, session?.access_token, user]);

  useEffect(() => {
    const timer = window.setInterval(() => void readUnreal(false), 15000);
    return () => window.clearInterval(timer);
  }, [readUnreal]);

  const chooseAsset = (asset: CreatorAsset) => {
    setSelectedAssetId(asset.id);
    setShowAssetPicker(false);
    setShowAvatarPicker(true);
    setAvatarFbx(null);
    setBodyDataReady(false);
    setRigApproved(false);
    setError(null);
    setMessage("GLB elegido. Ahora confirmá qué avatar va a usar.");
    setViewerRevision((value) => value + 1);
  };

  const chooseAvatar = async (choice: AvatarChoice) => {
    setActiveAvatar(choice.avatar);
    setShowAvatarPicker(false);
    setAvatarFbx(null);
    setBodyDataReady(false);
    setRigApproved(false);
    setRigProfile(COMPLETE_RIG_FILE.test(choice.avatar.modelUrl ?? "") ? { complete: true } : null);
    setError(null);
    setMessage("Avatar elegido. Riggealo y después aprobalo visualmente en Huesos y Diagnóstico.");
    setViewerRevision((value) => value + 1);
    if (!user || choice.avatar.source === "official") return;
    await supabase.from("user_avatars").update({ is_active: false }).eq("user_id", user.id);
    await supabase.from("user_avatars").update({ is_active: true }).eq("user_id", user.id).eq("id", choice.avatar.id);
  };

  const rigAvatar = async () => {
    setAvatarRigging(true);
    setAvatarRigProgress(0);
    setRigProfile(null);
    setRigApproved(false);
    setAvatarFbx(null);
    setBodyDataReady(false);
    setError(null);
    setMessage("Preparando avatar en Blender");
    const rigStageTimers = [
      window.setTimeout(() => setMessage("Creando esqueleto"), 1500),
      window.setTimeout(() => setMessage("Asignando pesos"), 10000),
    ];
    try {
      const created = await requestRig({ action: avatarRigReady ? "retry" : "create" });
      if (created.alreadyRigged && created.newAvatarUrl) {
        const profile = created.rigProfile ?? { complete: true };
        setRigProfile(profile);
        setAvatarRigProgress(100);
        setActiveAvatar({ ...activeAvatar, modelUrl: created.newAvatarUrl, updatedAt: new Date().toISOString() });
        await loadAvatars();
        setViewerRevision((value) => value + 1);
        setMessage("Rig completo generado. Revisá Huesos, Animación y Diagnóstico antes de aprobarlo.");
        return;
      }

      if (created.status === "SUCCEEDED" && created.newAvatarUrl && created.rigProfile?.complete === true) {
        const completedAvatar: ActiveAvatar = {
...activeAvatar,
id: created.sourceAvatarId || activeAvatar.id,
modelUrl: created.newAvatarUrl,
status: "ready",
updatedAt: new Date().toISOString(),
        };
        setActiveAvatar(completedAvatar);
        setRigProfile(created.rigProfile);
        setAvatarRigProgress(100);
        await loadActiveAvatar(user?.id ?? null);
        await loadAvatars();
        setViewerRevision((value) => value + 1);
        const durationSeconds = Math.max(0.001, Number(created.rigDurationMs ?? created.rigProfile.durationMs ?? 0) / 1000);
        const runId = String(created.rigRunId ?? created.rigProfile.runId ?? "").slice(0, 8);
        setMessage(`Blender V15 ajustó cabeza, manos y articulaciones y creó un rig nuevo en ${durationSeconds.toFixed(2)} s · ejecución ${runId}. Revisá Animación antes de aprobar.`);
        return;
      }

      const taskId = String(created.taskId ?? "");
      if (!taskId) throw new Error("El rigeador no devolvió un identificador de trabajo.");
      const startedAt = Date.now();
      while (Date.now() - startedAt < 30 * 60 * 1000) {
        const status = await requestRig({ action: "status", taskId });
        const remoteStatus = String(status.status ?? status.task?.status ?? "").toUpperCase();
        const progress = Math.max(0, Math.min(99, Math.round(status.progress ?? status.task?.progress ?? 0)));
        setAvatarRigProgress(progress);
        setMessage(progress >= 95 ? "Completando dedos, orejas y pesos en Blender…" : `Riggeando avatar… ${progress}%`);

        if (TERMINAL_RIG_FAILURES.has(remoteStatus)) {
          throw new Error(status.task_error?.message || status.task?.task_error?.message || status.error || "El rigeador no pudo completar el avatar.");
        }
        if (remoteStatus === "SUCCEEDED") {
          const finalized = await requestRig({ action: "finalize", taskId });
          if (!finalized.newAvatarUrl || finalized.rigProfile?.complete !== true) {
            throw new Error(finalized.error || "El avatar no superó la validación de dedos y orejas.");
          }
          const completedAvatar: ActiveAvatar = {
            ...activeAvatar,
            id: finalized.sourceAvatarId || activeAvatar.id,
            modelUrl: finalized.newAvatarUrl,
            status: "ready",
            updatedAt: new Date().toISOString(),
          };
          setActiveAvatar(completedAvatar);
          setRigProfile(finalized.rigProfile);
          setAvatarRigProgress(100);
          await loadActiveAvatar(user?.id ?? null);
          await loadAvatars();
          setViewerRevision((value) => value + 1);
          setMessage("Avatar riggeado. Revisá los huesos y probá la animación antes de aprobar para Unreal.");
          return;
        }
        await sleep(5000);
      }
      throw new Error("El rig del avatar superó el tiempo máximo de 30 minutos.");
    } catch (cause) {
      setAvatarRigProgress(0);
      const nextError = cause instanceof Error ? cause.message : "No se pudo riggear el avatar.";
      setError(nextError);
      setMessage(nextError);
    } finally {
      rigStageTimers.forEach((timer) => window.clearTimeout(timer));
      setAvatarRigging(false);
    }
  };

  const exportAvatarToUnreal = async () => {
    if (!session?.access_token) return;
    if (!rigApproved) {
      setError("Primero aprobá el rig en el visor.");
      setMessage("Primero aprobá el rig en el visor.");
      return;
    }
    setAvatarExporting(true);
    setAvatarFbx(null);
    setError(null);
    setMessage("Blender está preparando el avatar FBX para Unreal…");
    try {
      const response = await fetch("/api/avatar/export-unreal", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as UnrealExport;
      if (!response.ok || !data.url) throw new Error(data.error || `No se pudo crear el FBX (${response.status}).`);
      setAvatarFbx(data);
      setMessage("FBX validado y listo para abrir en Unreal.");
      const link = document.createElement("a");
      link.href = data.url;
      link.download = data.filename || "clouva-avatar-unreal.fbx";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (cause) {
      const nextError = cause instanceof Error ? cause.message : "No se pudo preparar el FBX.";
      setError(nextError);
      setMessage(nextError);
    } finally {
      setAvatarExporting(false);
    }
  };

  const fetchBodyData = async () => {
    setError(null);
    setMessage("Leyendo el cuerpo que Unreal tiene cargado…");
    try {
      const data = await readUnreal(true);
      setBodyDataReady(Boolean(data.snapshot));
      setMessage("Datos del cuerpo recibidos. El molde ya puede usarse.");
    } catch (cause) {
      setBodyDataReady(false);
      const nextError = cause instanceof Error ? cause.message : "Unreal no devolvió el cuerpo.";
      setError(nextError);
      setMessage(nextError);
    }
  };

  const rigGlbFromMold = async () => {
    if (!selectedAsset || selectedAsset.kind !== "clothing" || !selectedAsset.clothingItemId || !selectedAsset.modelUrl || !session?.access_token) return;
    setGarmentRigging(true);
    setError(null);
    setMessage("Blender está creando el molde y riggeando el GLB sobre ese cuerpo…");
    try {
      const attemptId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `attempt-${Date.now()}`;
      const response = await fetch("/api/clothing/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          itemId: selectedAsset.clothingItemId,
          modelUrl: selectedAsset.modelUrl,
          attemptId,
          unrealSnapshot: unreal.snapshot,
          moldSource: "unreal-avatar-snapshot",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; rigged?: boolean; error?: string; warning?: string };
      if (!response.ok || !data.ok || !data.rigged) throw new Error(data.error || data.warning || "Blender no pudo riggear el GLB con el molde.");
      await loadAssets();
      setViewerRevision((value) => value + 1);
      setMessage("GLB riggeado con el molde del avatar. Resultado listo para probar en Animación.");
    } catch (cause) {
      const nextError = cause instanceof Error ? cause.message : "No se pudo riggear el GLB.";
      setError(nextError);
      setMessage(nextError);
    } finally {
      setGarmentRigging(false);
    }
  };

  const canExportAvatar = avatarRigReady && rigApproved && !avatarRigging && !avatarExporting;
  const canReadBody = Boolean(avatarFbx?.url) && !avatarExporting;
  const canRigGlb = Boolean(
    selectedAsset?.kind === "clothing"
    && selectedAsset.clothingItemId
    && selectedAsset.modelUrl
    && avatarRigReady
    && rigApproved
    && avatarFbx?.url
    && bodyDataReady
    && unreal.snapshot
    && !garmentRigging,
  );
  const dressedPreview = Boolean(selectedAsset?.kind === "clothing" && selectedAsset.rigged && selectedAsset.modelUrl);

  if (loading || !user) return null;

  return (
    <section className={styles.studio} aria-label="Creator Studio simple de CLOUVA">
      <header className={styles.header}>
        <div>
          <span>CLOUVA</span>
          <h1>Creator Studio</h1>
          <p>GLB → rig visual → aprobación → Unreal → molde → rig final</p>
        </div>
        <button type="button" className={styles.refresh} onClick={() => void Promise.all([loadAssets(), loadAvatars(), readUnreal(false)])}>
          <RefreshCw /> Actualizar
        </button>
      </header>

      <div className={styles.selectors}>
        <button type="button" onClick={() => setShowAssetPicker(true)}>
          <FileBox />
          <span><small>GLB</small><strong>{selectedAsset?.name || "Elegir GLB"}</strong></span>
        </button>
        <button type="button" onClick={() => setShowAvatarPicker(true)} disabled={!selectedAsset}>
          <UserRound />
          <span><small>AVATAR</small><strong>{selectedAsset ? avatarLabel(activeAvatar) : "Elegí primero el GLB"}</strong></span>
        </button>
      </div>

      <div className={styles.workspace}>
        <div className={styles.viewerCard}>
          <div className={styles.viewerHeader}>
            <div><Box /> VISOR 3D · VALIDACIÓN DE RIG</div>
            <span>{rigApproved ? "Rig aprobado" : avatarRigReady ? "Esperando aprobación" : selectedAsset ? "GLB seleccionado" : "Avatar"}</span>
          </div>
          <div className={styles.viewer}>
            <RigApprovalWorkspace
              avatar={activeAvatar}
              selectedModelUrl={selectedAsset?.modelUrl}
              selectedModelName={selectedAsset?.name}
              dressedPreview={dressedPreview}
              avatarRigReady={avatarRigReady}
              rigProfile={rigProfile}
              revision={viewerRevision}
              onStatus={(status) => {
                setError(null);
                setMessage(status);
              }}
              onApprovalChange={setRigApproved}
            />
          </div>
          <div className={error ? styles.viewerMessageError : styles.viewerMessage}>
            {error ? <XCircle /> : <CheckCircle2 />}
            <span>{message}</span>
          </div>
        </div>

        <aside className={styles.flow}>
          <div className={styles.step} data-ready={avatarRigReady && rigApproved}>
            <span className={styles.stepNumber}>1</span>
            <div className={styles.stepCopy}>
              <small>AVATAR</small>
              <strong>Rig completo y aprobado</strong>
              <p>{rigApproved ? "Huesos, pesos, escala y animación aprobados" : avatarRigReady ? "Abrí Huesos y Diagnóstico; después tocá Aprobar rig" : "Genera esqueleto, dedos, orejas y pesos"}</p>
              {avatarRigging ? <div className={styles.progress}><i style={{ width: `${Math.max(avatarRigProgress, 4)}%` }} /></div> : null}
            </div>
            <button type="button" onClick={() => void rigAvatar()} disabled={!selectedAsset || avatarRigging}>
              {avatarRigging ? <Loader2 className={styles.spin} /> : <Bone />}
              {avatarRigging ? `${avatarRigProgress}%` : avatarRigReady ? "Rehacer rig" : "Riggear avatar"}
            </button>
          </div>

          <div className={styles.step} data-ready={Boolean(avatarFbx?.url)}>
            <span className={styles.stepNumber}>2</span>
            <div className={styles.stepCopy}>
              <small>UNREAL</small>
              <strong>Avatar FBX</strong>
              <p>{avatarFbx?.url ? "FBX validado y generado" : rigApproved ? "Rig aprobado; ya puede prepararse para Unreal" : "Bloqueado hasta aprobar el rig en el visor"}</p>
            </div>
            <button type="button" onClick={() => void exportAvatarToUnreal()} disabled={!canExportAvatar}>
              {avatarExporting ? <Loader2 className={styles.spin} /> : <Download />}
              {avatarExporting ? "Preparando" : "Enviar FBX"}
            </button>
          </div>

          <div className={styles.step} data-ready={bodyDataReady}>
            <span className={styles.stepNumber}>3</span>
            <div className={styles.stepCopy}>
              <small>UNREAL</small>
              <strong>Datos del cuerpo</strong>
              <p>{bodyDataReady ? "Snapshot corporal recibido" : "Trae escala, huesos y medidas para el molde"}</p>
            </div>
            <button type="button" onClick={() => void fetchBodyData()} disabled={!canReadBody}>
              <Server /> Traer data
            </button>
          </div>

          <div className={styles.step} data-ready={Boolean(selectedAsset?.rigged)}>
            <span className={styles.stepNumber}>4</span>
            <div className={styles.stepCopy}>
              <small>BLENDER</small>
              <strong>Riggear GLB con molde</strong>
              <p>{selectedAsset?.kind === "storage" ? "Guardalo como pieza para habilitar el rig" : selectedAsset?.rigged ? "Resultado listo para probar en el visor" : "Se habilita cuando rig, FBX y cuerpo estén listos"}</p>
            </div>
            <button type="button" onClick={() => void rigGlbFromMold()} disabled={!canRigGlb}>
              {garmentRigging ? <Loader2 className={styles.spin} /> : <Shirt />}
              {garmentRigging ? "Riggeando" : "Riggear GLB"}
            </button>
          </div>

          <div className={styles.infoGrid}>
            <article>
              <span className={unreal.status === "online" ? styles.onlineDot : styles.offlineDot} />
              <div><small>UNREAL</small><strong>{unreal.status === "online" ? "Conectado" : "Sin conexión"}</strong><p>{bodyDataReady ? "Cuerpo recibido" : unreal.snapshot ? "Snapshot disponible" : "Esperando snapshot"}</p></div>
            </article>
            <article>
              <span className={avatarRigging || garmentRigging ? styles.busyDot : styles.onlineDot} />
              <div><small>BLENDER WORKER</small><strong>{avatarRigging || garmentRigging ? "Procesando" : "Disponible"}</strong><p>{rigApproved ? "Rig aprobado en visor" : avatarRigReady ? `${rigProfile?.boneCount ?? "Rig"} · falta aprobación visual` : "Esperando trabajo"}</p></div>
            </article>
          </div>
        </aside>
      </div>

      {showAssetPicker ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setShowAssetPicker(false)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Elegir GLB" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><FileBox /><span><small>PASO 1</small><strong>Elegí un GLB</strong></span></div><button type="button" onClick={() => setShowAssetPicker(false)}><X /></button></header>
            <div className={styles.modalList}>
              {loadingAssets ? <div className={styles.loadingRow}><Loader2 className={styles.spin} /> Cargando GLB…</div> : null}
              {!loadingAssets && assets.length === 0 ? <div className={styles.loadingRow}>No hay GLB guardados todavía.</div> : null}
              {assets.map((asset) => (
                <button type="button" key={asset.id} className={selectedAssetId === asset.id ? styles.selectedRow : styles.assetRow} onClick={() => chooseAsset(asset)}>
                  <FileBox />
                  <span><strong>{asset.name}</strong><small>{asset.kind === "clothing" ? `${asset.category || "Pieza"}${asset.rigged ? " · riggeado" : " · original"}` : "Archivo GLB"}</small></span>
                  {selectedAssetId === asset.id ? <CheckCircle2 /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {showAvatarPicker ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setShowAvatarPicker(false)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Elegir avatar" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><UserRound /><span><small>PASO 2</small><strong>Elegí el avatar</strong></span></div><button type="button" onClick={() => setShowAvatarPicker(false)}><X /></button></header>
            <div className={styles.modalList}>
              {loadingAvatars ? <div className={styles.loadingRow}><Loader2 className={styles.spin} /> Cargando avatares…</div> : null}
              {avatars.map((choice) => (
                <button type="button" key={choice.avatar.id} className={activeAvatar.id === choice.avatar.id ? styles.selectedRow : styles.assetRow} onClick={() => void chooseAvatar(choice)}>
                  <UserRound />
                  <span><strong>{choice.label}</strong><small>{choice.detail}</small></span>
                  {activeAvatar.id === choice.avatar.id ? <CheckCircle2 /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
