"use client";

import {
  Box,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import styles from "./active-avatar-download.module.css";

type AvatarDownload = {
  avatarId: string;
  url: string;
  path: string | null;
  status: string | null;
  isRigged: boolean;
};

type StorageEntry = {
  name: string;
  metadata?: Record<string, unknown> | null;
};

type RigApiResponse = {
  active?: boolean;
  alreadyRigged?: boolean;
  completed?: boolean;
  taskId?: string;
  status?: string;
  stage?: string;
  progress?: number;
  newAvatarUrl?: string;
  error?: string;
};

const URL_FIELDS = [
  "rigged_url",
  "processed_glb_url",
  "processed_url",
  "final_glb_url",
  "model_rigged_url",
  "avatar_3d_url",
  "model_url",
  "glb_url",
] as const;

const RIG_STAGES = {
  preparing: "Preparando avatar en Blender",
  skeleton: "Creando esqueleto",
  weights: "Asignando pesos",
  ready: "Listo para Unreal",
} as const;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function firstUrl(row: Record<string, unknown>) {
  for (const field of URL_FIELDS) {
    const value = row[field];
    if (typeof value === "string" && value.trim()) return { field, url: value.trim() };
  }
  return null;
}

function looksRigged(value: string) {
  return /complete-rigged|rigged|processed|final/i.test(value);
}

async function findGlbInFolder(basePath: string, depth = 0): Promise<string | null> {
  const { data, error } = await supabase.storage.from("avatars").list(basePath, {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  });

  if (error) return null;

  for (const rawEntry of data ?? []) {
    const entry = rawEntry as StorageEntry;
    const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const isFolder = !entry.metadata && !entry.name.includes(".");

    if (!isFolder && entry.name.toLowerCase().endsWith(".glb")) return fullPath;

    if (isFolder && depth < 3) {
      const nested = await findGlbInFolder(fullPath, depth + 1);
      if (nested) return nested;
    }
  }

  return null;
}

async function signedAvatarUrl(path: string) {
  const signed = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60);
  if (signed.data?.signedUrl) return signed.data.signedUrl;
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

export function ActiveAvatarDownload() {
  const { user, profile, session, loading: authLoading } = useAuth();
  const [avatar, setAvatar] = useState<AvatarDownload | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rigging, setRigging] = useState(false);
  const [rigProgress, setRigProgress] = useState(0);
  const [rigMessage, setRigMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadActiveAvatar = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const activeResult = await supabase
        .from("user_avatars")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      const fallbackResult = activeResult.data
        ? null
        : await supabase
            .from("user_avatars")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

      const row = (activeResult.data ?? fallbackResult?.data ?? null) as Record<string, unknown> | null;
      const avatarId = typeof row?.id === "string" ? row.id : user.id;
      const status = typeof row?.status === "string" ? row.status : null;
      const direct = row ? firstUrl(row) : null;

      if (direct) {
        setAvatar({
          avatarId,
          url: direct.url,
          path: null,
          status,
          isRigged: looksRigged(`${direct.field} ${direct.url}`),
        });
        return;
      }

      if (profile?.avatar_3d_url) {
        setAvatar({
          avatarId,
          url: profile.avatar_3d_url,
          path: null,
          status,
          isRigged: looksRigged(profile.avatar_3d_url),
        });
        return;
      }

      const candidatePaths = [avatarId, `${user.id}/${avatarId}`, user.id];
      for (const basePath of candidatePaths) {
        const path = await findGlbInFolder(basePath);
        if (!path) continue;
        const url = await signedAvatarUrl(path);
        setAvatar({
          avatarId,
          url,
          path,
          status,
          isRigged: looksRigged(path),
        });
        return;
      }

      setAvatar(null);
      setError("No encontramos el GLB del avatar activo. Tocá Actualizar o revisá el registro activo en user_avatars.");
    } catch (cause) {
      console.error("Active avatar download load failed", cause);
      setAvatar(null);
      setError("No pudimos resolver automáticamente el avatar activo.");
    } finally {
      setLoading(false);
    }
  }, [profile?.avatar_3d_url, user]);

  useEffect(() => {
    void loadActiveAvatar();
  }, [loadActiveAvatar]);

  const fileName = useMemo(() => {
    const suffix = avatar?.isRigged ? "rigged" : "base";
    return `clouva-avatar-${avatar?.avatarId.slice(0, 8) ?? "activo"}-${suffix}.glb`;
  }, [avatar]);

  const requestRigApi = async (body: Record<string, unknown>) => {
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
    if (!response.ok) throw new Error(data.error || `No se pudo iniciar el Auto Rig (${response.status}).`);
    return data;
  };

  const finishRigging = async (result: RigApiResponse) => {
    if (!result.newAvatarUrl) throw new Error("Blender terminó, pero no devolvió la URL del avatar riggeado.");
    setRigProgress(100);
    setRigMessage(RIG_STAGES.ready);
    await loadActiveAvatar();
  };

  const waitForExistingJob = async (taskId: string) => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const status = await requestRigApi({ action: "status", taskId });
      const remoteStatus = String(status.status ?? "").toUpperCase();
      setRigProgress(Math.max(5, Math.min(99, Math.round(status.progress ?? 35))));
      setRigMessage(status.stage || RIG_STAGES.skeleton);

      if (remoteStatus === "SUCCEEDED" && status.newAvatarUrl) return status;
      if (remoteStatus === "NOT_STARTED") {
        throw new Error(status.error || "El trabajo de Blender se interrumpió. Tocá Reintentar.");
      }
      await sleep(4000);
    }
    throw new Error("Blender superó el tiempo máximo del Auto Rig.");
  };

  const startRigging = async () => {
    if (!avatar) return;

    const retry = Boolean(error);
    setRigging(true);
    setRigProgress(8);
    setRigMessage(RIG_STAGES.preparing);
    setError(null);

    const timers = [
      window.setTimeout(() => {
        setRigProgress((value) => Math.max(value, 35));
        setRigMessage(RIG_STAGES.skeleton);
      }, 800),
      window.setTimeout(() => {
        setRigProgress((value) => Math.max(value, 70));
        setRigMessage(RIG_STAGES.weights);
      }, 8000),
    ];

    try {
      let result = await requestRigApi({ action: retry ? "retry" : "create" });

      if (String(result.status ?? "").toUpperCase() === "IN_PROGRESS") {
        const taskId = String(result.taskId ?? "");
        if (!taskId) throw new Error("Blender no devolvió el identificador del trabajo en proceso.");
        result = await waitForExistingJob(taskId);
      }

      if (String(result.status ?? "").toUpperCase() !== "SUCCEEDED") {
        throw new Error(result.error || "Blender no pudo completar el Auto Rig.");
      }

      await finishRigging(result);
    } catch (cause) {
      console.error("Avatar Blender autorig failed", cause);
      setRigProgress(0);
      setRigMessage(null);
      setError(cause instanceof Error ? cause.message : "No se pudo autoriggear el avatar.");
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer));
      setRigging(false);
    }
  };

  const downloadAvatar = async () => {
    if (!avatar || !avatar.isRigged) return;
    setDownloading(true);
    setError(null);

    try {
      const response = await fetch(avatar.url);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    } catch (cause) {
      console.error("Avatar download failed", cause);
      window.open(avatar.url, "_blank", "noopener,noreferrer");
      setError("Se abrió el GLB en otra pestaña. Desde ahí elegí Descargar.");
    } finally {
      setDownloading(false);
    }
  };

  if (authLoading || !user) return null;

  return (
    <aside className={styles.card} aria-label="Descargar avatar activo">
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.topline}>
        <span><CheckCircle2 /> AVATAR ACTIVO</span>
        <button
          type="button"
          onClick={() => void loadActiveAvatar()}
          aria-label="Actualizar avatar activo"
          disabled={loading || rigging}
        >
          <RefreshCw className={loading ? styles.spin : undefined} />
        </button>
      </div>

      {loading ? (
        <div className={styles.loading}><Loader2 className={styles.spin} /><span>Buscando tu GLB…</span></div>
      ) : avatar ? (
        <>
          <div className={styles.preview}>
            {createElement("model-viewer", {
              className: styles.model,
              src: avatar.url,
              alt: "Avatar activo CLOUVA",
              "auto-rotate": true,
              "rotation-per-second": "18deg",
              "camera-controls": true,
              "shadow-intensity": "1",
              exposure: "1",
            })}
          </div>

          <div className={styles.info}>
            <div>
              <Box />
              <span>
                <strong>Tu cuerpo 3D</strong>
                <small>{avatar.isRigged ? "Versión procesada / riggeada" : "GLB original de Meshy · listo para Blender"}</small>
              </span>
            </div>
            <code>{avatar.avatarId.slice(0, 8)}</code>
          </div>

          {!avatar.isRigged && rigMessage ? (
            <div className={styles.rigStatus}>
              <p>{rigMessage}</p>
              <div className={styles.progressTrack} aria-label={`Progreso del Auto Rig: ${rigProgress}%`}>
                <div className={styles.progressBar} style={{ width: `${Math.max(rigProgress, rigging ? 3 : 0)}%` }} />
              </div>
              <span>{rigProgress}%</span>
            </div>
          ) : null}

          {avatar.isRigged ? (
            <button
              className={styles.download}
              type="button"
              onClick={() => void downloadAvatar()}
              disabled={downloading}
            >
              {downloading ? <Loader2 className={styles.spin} /> : <Download />}
              {downloading ? "Preparando descarga…" : "DESCARGAR AVATAR RIGGEADO"}
            </button>
          ) : (
            <button
              className={styles.download}
              type="button"
              onClick={() => void startRigging()}
              disabled={rigging || !session?.access_token}
            >
              {rigging ? <Loader2 className={styles.spin} /> : <WandSparkles />}
              {rigging ? `BLENDER ${rigProgress}%` : error ? "REINTENTAR" : "AUTORIGGEAR AVATAR"}
            </button>
          )}

          <a className={styles.open} href={avatar.url} target="_blank" rel="noreferrer">
            <ExternalLink /> {avatar.isRigged ? "Abrir archivo riggeado" : "Abrir GLB original"}
          </a>
        </>
      ) : (
        <div className={styles.missing}>
          <TriangleAlert />
          <strong>No encontramos el avatar activo</strong>
          <span>Revisá que uno tenga is_active = true.</span>
        </div>
      )}

      {error ? <p className={styles.error}>{error}</p> : null}
    </aside>
  );
}
