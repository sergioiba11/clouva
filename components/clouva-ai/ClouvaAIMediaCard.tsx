"use client";
/* eslint-disable @next/next/no-img-element -- Generated media URLs are dynamic and external. */

import Link from "next/link";
import { Check, Copy, Download, ImageIcon, Loader2, Play, RefreshCw, Sparkles, TriangleAlert, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildMediaCreatorHref } from "@/lib/media-creator-navigation";
import { buildRetryImageRequest, CLOUVA_AI_RETRY_IMAGE_EVENT, imageGenerationErrorCopy } from "@/lib/clouva-ai/image-generation-retry";
import type { ClouvaAIMediaAttachment } from "@/components/clouva-ai/useClouvaAIConversation";
import styles from "./ClouvaAIMediaCard.module.css";

function statusCopy(media: ClouvaAIMediaAttachment) {
  if (media.status === "preparing" || media.status === "queued") return "Preparando generación…";
  if (media.status === "generating" || media.status === "processing") return media.type === "video" ? "Veo está creando el video…" : "Gemini está creando la imagen…";
  if (media.status === "saving") return "Guardando el resultado…";
  if (media.status === "completed") return media.type === "video" ? "Video listo" : "Imagen lista";
  if (media.status === "storage_failed") return "Falta guardar el resultado";
  if (media.status === "failed" || media.status === "cancelled") return "No se pudo generar";
  return media.status;
}

function isActive(media: ClouvaAIMediaAttachment) {
  return ["preparing", "queued", "generating", "processing", "saving"].includes(media.status);
}

function canRetry(media: ClouvaAIMediaAttachment) {
  return media.type === "image" && ["failed", "storage_failed", "cancelled"].includes(media.status);
}

export function ClouvaAIMediaCard({ media }: { media: ClouvaAIMediaAttachment }) {
  const [copied, setCopied] = useState(false);
  const [retryRequested, setRetryRequested] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const previousStatusRef = useRef(media.status);
  const creatorHref = buildMediaCreatorHref(media.type, media.prompt);
  const errorCopy = media.error
    ? media.type === "image"
      ? imageGenerationErrorCopy(media.technicalError ?? media.error)
      : { message: media.error, detail: media.technicalError && media.technicalError !== media.error ? media.technicalError : null }
    : null;
  const MediaIcon = media.type === "video" ? Video : ImageIcon;

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    const statusChanged = previousStatus !== media.status;
    previousStatusRef.current = media.status;
    if (!isActive(media) && !statusChanged) return;
    const frame = window.requestAnimationFrame(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    return () => window.cancelAnimationFrame(frame);
  }, [media.status, media.outputUrl, media.error]);

  async function copyPrompt() {
    await navigator.clipboard.writeText(media.prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function retry() {
    if (!canRetry(media) || retryRequested) return;
    setRetryRequested(true);
    window.dispatchEvent(new CustomEvent(CLOUVA_AI_RETRY_IMAGE_EVENT, {
      detail: buildRetryImageRequest({
        prompt: media.prompt,
        aspectRatio: media.aspectRatio as "1:1" | "4:5" | "5:4" | "16:9" | "9:16",
        quality: media.quality as "quick" | "high" | "maximum",
        referenceUrl: media.referenceUrl,
        referenceStoragePath: media.referenceStoragePath,
      }),
    }));
  }

  return (
    <section ref={cardRef} className={styles.card} aria-label={`Generación de ${media.type} de CLOUVA AI`}>
      <div className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.icon}><MediaIcon size={18} /></span>
          <div><strong>{media.status === "completed" ? `${media.type === "video" ? "Video" : "Imagen"} generado` : `Generación de ${media.type === "video" ? "video" : "imagen"}`}</strong><span>CLOUVA AI Studio · {media.type === "video" ? "Veo" : "Gemini"}</span></div>
        </div>
        <span className={styles.status}>
          {isActive(media) ? <Loader2 size={12} className={styles.spin} /> : media.status === "completed" ? <Sparkles size={12} /> : <TriangleAlert size={12} />}
          {statusCopy(media)}
        </span>
      </div>

      <p className={styles.prompt}>{media.prompt}</p>
      <div className={styles.meta}>
        <span>{media.aspectRatio}</span><span>Calidad {media.quality}</span>
        {media.type === "video" && media.durationSeconds ? <span>{media.durationSeconds} s</span> : null}
        {media.type === "video" && typeof media.estimatedCostUsd === "number" ? <span>USD {media.estimatedCostUsd.toFixed(2)}</span> : null}
      </div>

      {media.status === "completed" && media.outputUrl ? (
        <div className={styles.media}>
          {media.type === "video" ? <video src={media.outputUrl} controls playsInline preload="metadata" aria-label={media.prompt} /> : <img src={media.outputUrl} alt={media.prompt} />}
        </div>
      ) : null}

      {errorCopy ? (
        <div className={styles.error}>
          <strong>No se pudo generar {media.type === "video" ? "el video" : "la imagen"}</strong>
          <span>{errorCopy.message}</span>
          {errorCopy.detail ? <code>Detalle: {errorCopy.detail}</code> : null}
        </div>
      ) : null}

      <div className={styles.actions}>
        {canRetry(media) ? <button type="button" className={styles.retry} onClick={retry} disabled={retryRequested}><RefreshCw size={14} />{retryRequested ? "Reintentando…" : "Reintentar"}</button> : null}
        <Link href={creatorHref} className={styles.primary}>{media.type === "video" ? <Play size={14} /> : <Sparkles size={14} />}Abrir en Crear</Link>
        <button type="button" onClick={() => void copyPrompt()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copiado" : "Copiar prompt"}</button>
        {media.outputUrl ? <a href={media.outputUrl} target="_blank" rel="noreferrer"><Download size={14} />Descargar</a> : null}
      </div>
    </section>
  );
}
