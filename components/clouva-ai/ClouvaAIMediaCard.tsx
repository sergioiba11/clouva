"use client";
/* eslint-disable @next/next/no-img-element -- Generated media URLs are dynamic and external. */

import Link from "next/link";
import { Check, Copy, Download, ImageIcon, Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildMediaCreatorHref } from "@/lib/media-creator-navigation";
import {
  buildRetryImageRequest,
  CLOUVA_AI_RETRY_IMAGE_EVENT,
  imageGenerationErrorCopy,
} from "@/lib/clouva-ai/image-generation-retry";
import type { ClouvaAIMediaAttachment } from "@/components/clouva-ai/useClouvaAIConversation";
import styles from "./ClouvaAIMediaCard.module.css";

function statusCopy(media: ClouvaAIMediaAttachment) {
  if (media.status === "preparing" || media.status === "queued") return "Preparando generación…";
  if (media.status === "generating" || media.status === "processing") return "Gemini está creando la imagen…";
  if (media.status === "saving") return "Guardando el resultado…";
  if (media.status === "completed") return "Imagen lista";
  if (media.status === "storage_failed") return "Falta guardar el resultado";
  if (media.status === "failed" || media.status === "cancelled") return "No se pudo generar";
  return media.status;
}

function isActive(media: ClouvaAIMediaAttachment) {
  return ["preparing", "queued", "generating", "processing", "saving"].includes(media.status);
}

function canRetry(media: ClouvaAIMediaAttachment) {
  return ["failed", "storage_failed", "cancelled"].includes(media.status);
}

export function ClouvaAIMediaCard({ media }: { media: ClouvaAIMediaAttachment }) {
  const [copied, setCopied] = useState(false);
  const [retryRequested, setRetryRequested] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const previousStatusRef = useRef(media.status);
  const creatorHref = buildMediaCreatorHref("image", media.prompt);
  const errorCopy = media.error ? imageGenerationErrorCopy(media.technicalError ?? media.error) : null;

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    const statusChanged = previousStatus !== media.status;
    previousStatusRef.current = media.status;

    if (!isActive(media) && !statusChanged) return;
    const frame = window.requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
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
        aspectRatio: media.aspectRatio,
        quality: media.quality,
        referenceUrl: media.referenceUrl,
        referenceStoragePath: media.referenceStoragePath,
      }),
    }));
  }

  return (
    <section ref={cardRef} className={styles.card} aria-label="Generación de imagen de CLOUVA AI">
      <div className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.icon}><ImageIcon size={18} /></span>
          <div><strong>{media.status === "completed" ? "Imagen generada" : "Generación de imagen"}</strong><span>CLOUVA AI Studio · Gemini</span></div>
        </div>
        <span className={styles.status}>
          {isActive(media) ? <Loader2 size={12} className={styles.spin} /> : media.status === "completed" ? <Sparkles size={12} /> : <TriangleAlert size={12} />}
          {statusCopy(media)}
        </span>
      </div>

      <p className={styles.prompt}>{media.prompt}</p>
      <div className={styles.meta}><span>{media.aspectRatio}</span><span>Calidad {media.quality}</span></div>

      {media.status === "completed" && media.outputUrl ? (
        <div className={styles.media}><img src={media.outputUrl} alt={media.prompt} /></div>
      ) : null}

      {errorCopy ? (
        <div className={styles.error}>
          <strong>No se pudo generar la imagen</strong>
          <span>{errorCopy.message}</span>
          {errorCopy.detail ? <code>Detalle: {errorCopy.detail}</code> : null}
        </div>
      ) : null}

      <div className={styles.actions}>
        {canRetry(media) ? <button type="button" className={styles.retry} onClick={retry} disabled={retryRequested}><RefreshCw size={14} />{retryRequested ? "Reintentando…" : "Reintentar"}</button> : null}
        <Link href={creatorHref} className={styles.primary}><Sparkles size={14} />Abrir en Crear</Link>
        <button type="button" onClick={() => void copyPrompt()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copiado" : "Copiar prompt"}</button>
        {media.outputUrl ? <a href={media.outputUrl} target="_blank" rel="noreferrer"><Download size={14} />Descargar</a> : null}
      </div>
    </section>
  );
}
