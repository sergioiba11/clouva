"use client";

import { Box, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
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

function firstUrl(row: Record<string, unknown>) {
  for (const field of URL_FIELDS) {
    const value = row[field];
    if (typeof value === "string" && value.trim()) return { field, url: value.trim() };
  }
  return null;
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

    if (!isFolder && entry.name.toLowerCase().endsWith(".glb")) {
      return fullPath;
    }

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
  const { user, profile, loading: authLoading } = useAuth();
  const [avatar, setAvatar] = useState<AvatarDownload | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
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
          isRigged: /rigged|processed|final/i.test(direct.field),
        });
        return;
      }

      if (profile?.avatar_3d_url) {
        setAvatar({ avatarId, url: profile.avatar_3d_url, path: null, status, isRigged: false });
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
          isRigged: /rigged|processed|final/i.test(path),
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

  const downloadAvatar = async () => {
    if (!avatar) return;
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
        <button type="button" onClick={() => void loadActiveAvatar()} aria-label="Actualizar avatar activo" disabled={loading}>
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
                <small>{avatar.isRigged ? "Versión procesada / riggeada" : "GLB base · todavía puede necesitar autorig"}</small>
              </span>
            </div>
            <code>{avatar.avatarId.slice(0, 8)}</code>
          </div>

          <button className={styles.download} type="button" onClick={() => void downloadAvatar()} disabled={downloading}>
            {downloading ? <Loader2 className={styles.spin} /> : <Download />}
            {downloading ? "Preparando descarga…" : "DESCARGAR AVATAR .GLB"}
          </button>

          <a className={styles.open} href={avatar.url} target="_blank" rel="noreferrer">
            <ExternalLink /> Abrir archivo original
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
