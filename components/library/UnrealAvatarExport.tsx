"use client";

import { Box, CheckCircle2, Download, Loader2, Rocket, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import styles from "./unreal-avatar-export.module.css";

type ExportResponse = {
  ok?: boolean;
  url?: string;
  filename?: string;
  scale?: string;
  error?: string;
};

export function UnrealAvatarExport() {
  const { user, session, loading } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportForUnreal = async () => {
    if (!session?.access_token) return;

    setExporting(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/avatar/export-unreal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      const data = (await response.json().catch(() => ({}))) as ExportResponse;
      if (!response.ok || !data.url) {
        throw new Error(data.error || `No se pudo generar el FBX (${response.status})`);
      }

      setResult(data);

      const link = document.createElement("a");
      link.href = data.url;
      link.download = data.filename || "clouva-avatar-unreal.fbx";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo exportar el avatar para Unreal");
    } finally {
      setExporting(false);
    }
  };

  if (loading || !user) return null;

  return (
    <section className={styles.card} aria-label="Exportar avatar para Unreal Engine">
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.heading}>
        <span className={styles.icon}><Rocket /></span>
        <div>
          <small>PIPELINE CLOUVA</small>
          <h2>Exportar para Unreal</h2>
          <p>Meshy → Blender Worker → FBX preparado para Unreal Engine.</p>
        </div>
      </div>

      <div className={styles.specs}>
        <span><CheckCircle2 /> Rig conservado</span>
        <span><CheckCircle2 /> Pose A</span>
        <span><CheckCircle2 /> Transformaciones aplicadas</span>
        <span><CheckCircle2 /> 1 unidad Unreal = 1 cm</span>
      </div>

      <button
        type="button"
        className={styles.exportButton}
        onClick={() => void exportForUnreal()}
        disabled={exporting || !session?.access_token}
      >
        {exporting ? <Loader2 className={styles.spin} /> : <Box />}
        {exporting ? "BLENDER ESTÁ GENERANDO EL FBX…" : "GENERAR Y DESCARGAR FBX"}
      </button>

      {result?.url ? (
        <div className={styles.success}>
          <CheckCircle2 />
          <div>
            <strong>FBX listo para Unreal</strong>
            <span>{result.filename} · {result.scale}</span>
          </div>
          <a href={result.url} download={result.filename || true} target="_blank" rel="noreferrer">
            <Download /> Descargar otra vez
          </a>
        </div>
      ) : null}

      {error ? (
        <div className={styles.error}>
          <TriangleAlert />
          <span>{error}</span>
        </div>
      ) : null}
    </section>
  );
}
