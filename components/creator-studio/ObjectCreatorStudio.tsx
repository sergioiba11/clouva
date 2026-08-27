"use client";

import { Box, CheckCircle2, Coins, Cuboid, Loader2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useTrebolContextRegistration } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import styles from "./object-creator-studio.module.css";

type GeneratedAsset = {
  id: string;
  name: string;
  slug: string;
  kind: "object" | "accessory";
  category: string;
  preset_key?: string | null;
  status: "draft" | "generating" | "ready" | "failed" | "archived";
  source_sheet_url?: string | null;
  reference_urls?: Record<string, string> | null;
  model_url?: string | null;
  preview_image_url?: string | null;
  meshy_task_id?: string | null;
};

type ApiResponse = {
  asset?: GeneratedAsset;
  taskId?: string;
  status?: string;
  progress?: number;
  error?: string;
};

const PANEL_LABELS = [
  { key: "front", label: "Frente", position: "0% 50%" },
  { key: "back", label: "Espalda", position: "50% 50%" },
  { key: "side", label: "Costado", position: "100% 50%" },
] as const;

export function ObjectCreatorStudio() {
  const { user, session, loading } = useAuth();
  const [sheet, setSheet] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [asset, setAsset] = useState<GeneratedAsset | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sheet) {
      setSheetUrl(null);
      return;
    }
    const url = URL.createObjectURL(sheet);
    setSheetUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sheet]);

  useEffect(() => () => pollAbort.current?.abort(), []);

  const statusLabel = useMemo(() => {
    if (!asset) return "Esperando lámina";
    if (asset.status === "ready") return "FLLOWS 3D listo";
    if (asset.status === "failed") return "Generación detenida";
    return `Meshy creando el objeto · ${progress}%`;
  }, [asset, progress]);

  useTrebolContextRegistration({
    scope: "creator-studio-object",
    id: user?.id ?? "anonymous",
    data: {
      preset: "fllows",
      assetId: asset?.id ?? null,
      assetStatus: asset?.status ?? null,
      progress,
      hasCanonicalSheet: Boolean(sheet),
      referenceStrategy: "one-3x1-sheet-split-into-front-back-side",
      error,
    },
  });

  async function pollAsset(assetId: string) {
    if (!session?.access_token) return;
    pollAbort.current?.abort();
    const controller = new AbortController();
    pollAbort.current = controller;

    while (!controller.signal.aborted) {
      const response = await fetch(`/api/creator-studio/objects/from-sheet?assetId=${encodeURIComponent(assetId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok) throw new Error(data.error || `No se pudo leer la generación (${response.status}).`);
      if (data.asset) setAsset(data.asset);
      setProgress(Math.max(0, Math.min(100, Math.round(data.progress ?? 0))));
      if (data.asset?.status === "ready" || data.status === "SUCCEEDED") return;
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
    }
  }

  async function createFllows() {
    if (!sheet || !session?.access_token) return;
    setBusy(true);
    setError(null);
    setAsset(null);
    setProgress(0);
    try {
      const form = new FormData();
      form.set("sheet", sheet);
      form.set("presetKey", "fllows");
      const response = await fetch("/api/creator-studio/objects/from-sheet", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !data.asset?.id) throw new Error(data.error || `No se pudo iniciar FLLOWS (${response.status}).`);
      setAsset(data.asset);
      await pollAsset(data.asset.id);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "No se pudo crear el objeto 3D.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return null;

  return (
    <section className={styles.studio} aria-label="Creador de objetos 3D de CLOUVA">
      <header className={styles.header}>
        <div className={styles.eyebrow}><Cuboid size={16} /> CLOUVA CREATOR STUDIO</div>
        <h1>Objetos & accesorios 3D</h1>
        <p>Pipeline paralelo al avatar. Una sola lámina canónica se divide con precisión en Frente · Espalda · Costado y esas tres referencias alimentan la generación 3D.</p>
      </header>

      <div className={styles.grid}>
        <article className={styles.presetCard}>
          <div className={styles.presetIcon}><Coins /></div>
          <div>
            <small>PRIMER OBJETO OFICIAL</small>
            <h2>FLLOWS</h2>
            <p>Moneda oficial de CLOUVA · objeto de mundo · PBR · GLB.</p>
          </div>
          <span className={styles.official}>OFICIAL</span>
        </article>

        <article className={styles.sheetCard}>
          <div className={styles.cardTitle}>
            <div><span>01</span><strong>Lámina multivista</strong></div>
            <small>3:1 · una imagen</small>
          </div>

          <label className={styles.dropzone}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                setSheet(event.target.files?.[0] ?? null);
                setAsset(null);
                setProgress(0);
                setError(null);
              }}
            />
            {sheetUrl ? (
              <img src={sheetUrl} alt="Lámina multivista seleccionada" />
            ) : (
              <div><Upload /><strong>Subir lámina FLLOWS</strong><span>Frente | Espalda | Costado</span></div>
            )}
          </label>

          <div className={styles.panels}>
            {PANEL_LABELS.map((panel) => (
              <div key={panel.key} className={styles.panel}>
                <div
                  className={styles.panelImage}
                  style={sheetUrl ? {
                    backgroundImage: `url(${sheetUrl})`,
                    backgroundSize: "300% 100%",
                    backgroundPosition: panel.position,
                  } : undefined}
                >
                  {!sheetUrl && <Box />}
                </div>
                <span>{panel.label}</span>
              </div>
            ))}
          </div>
          <p className={styles.precisionNote}>El recorte final no depende de esta vista previa: el servidor usa Sharp y corta los tercios exactos de la imagen original antes de enviarlos a Meshy.</p>
        </article>

        <article className={styles.generateCard}>
          <div className={styles.cardTitle}>
            <div><span>02</span><strong>Generación 3D</strong></div>
            <small>Meshy 6 · multi-image</small>
          </div>
          <div className={styles.statusRow}>
            {asset?.status === "ready" ? <CheckCircle2 /> : busy ? <Loader2 className={styles.spin} /> : <Cuboid />}
            <div><strong>{statusLabel}</strong><span>{asset?.meshy_task_id ? `Task ${asset.meshy_task_id.slice(0, 10)}` : "Sin tarea activa"}</span></div>
          </div>
          <div className={styles.progress}><i style={{ width: `${progress}%` }} /></div>
          {error && <p className={styles.error}>{error}</p>}
          <button type="button" onClick={() => void createFllows()} disabled={!sheet || busy}>
            {busy ? <><Loader2 className={styles.spin} /> Creando FLLOWS…</> : <><Cuboid /> Crear FLLOWS 3D</>}
          </button>
          {asset?.status === "ready" && asset.model_url && (
            <a className={styles.modelLink} href={asset.model_url} target="_blank" rel="noreferrer">Abrir GLB oficial</a>
          )}
        </article>
      </div>
    </section>
  );
}
