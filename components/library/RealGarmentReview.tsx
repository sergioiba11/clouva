"use client";

import { Loader2, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { RiggedGarmentReviewViewer, type RiggedReviewPose, type RiggedReviewView } from "./RiggedGarmentReviewViewer";
import { StandaloneObjectPreview } from "./StandaloneObjectPreview";
import styles from "./real-garment-review.module.css";

type Props = {
  itemId: string;
  name: string;
  modelUrl?: string;
  thumbnailUrl?: string;
  rigged: boolean;
  accessToken: string;
  pose: RiggedReviewPose;
  view: RiggedReviewView;
  onStatus: (status: string) => void;
  onProcessed: () => Promise<void> | void;
};

type FinalizeResponse = {
  ok?: boolean;
  error?: string;
  warning?: string | null;
  rigged?: boolean;
};

export function RealGarmentReview({
  itemId,
  name,
  modelUrl,
  thumbnailUrl,
  rigged,
  accessToken,
  pose,
  view,
  onStatus,
  onProcessed,
}: Props) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processRiggedPreview = async () => {
    if (!modelUrl || processing) return;
    setProcessing(true);
    setError(null);
    onStatus("Blender está ajustando y riggeando la prenda contra tu avatar activo…");
    try {
      const response = await fetch("/api/clothing/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ itemId, modelUrl }),
      });
      const data = (await response.json().catch(() => ({}))) as FinalizeResponse;
      if (!response.ok || !data.ok || !data.rigged) {
        throw new Error(data.error || data.warning || "Blender no pudo generar la vista riggeada real.");
      }
      onStatus("✓ Prenda riggeada guardada. Cargando la prueba real sobre el avatar…");
      await onProcessed();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo procesar la prenda.";
      setError(message);
      onStatus(`No se pudo generar la vista riggeada: ${message}`);
    } finally {
      setProcessing(false);
    }
  };

  if (rigged && modelUrl) {
    return (
      <div className={styles.riggedStage}>
        <RiggedGarmentReviewViewer modelUrl={modelUrl} pose={pose} view={view} onStatus={onStatus} />
        <span className={styles.realBadge}><ShieldCheck /> RIG REAL</span>
      </div>
    );
  }

  return (
    <div className={styles.rawStage}>
      <div className={styles.rawModel}>
        {modelUrl ? (
          <StandaloneObjectPreview modelUrl={modelUrl} />
        ) : thumbnailUrl ? (
          <img src={thumbnailUrl} alt={`Vista previa de ${name}`} />
        ) : (
          <div className={styles.missing}>No hay un GLB disponible para procesar.</div>
        )}
      </div>
      <div className={styles.rawNotice}>
        <span className={styles.rawIcon}><Sparkles /></span>
        <div>
          <small>ORIGINAL DE MESHY</small>
          <strong>Todavía no está vestido sobre el avatar</strong>
          <p>Primero Blender debe ajustarlo al cuerpo, crear el esqueleto y transferir los pesos. Hasta entonces se muestra solo para no engañarte con una colocación aproximada.</p>
        </div>
        <button type="button" onClick={() => void processRiggedPreview()} disabled={!modelUrl || processing}>
          {processing ? <Loader2 className={styles.spin} /> : <ShieldCheck />}
          {processing ? "BLENDER ESTÁ CREANDO EL RIG…" : "GENERAR VISTA RIGGEADA REAL"}
        </button>
        {error ? <div className={styles.error}><TriangleAlert /> {error}</div> : null}
      </div>
    </div>
  );
}
