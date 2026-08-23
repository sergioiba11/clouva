"use client";
/* eslint-disable @next/next/no-img-element -- Generated media URLs are dynamic and external. */

import Link from "next/link";
import { Check, Copy, Download, ImageIcon, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { buildMediaCreatorHref } from "@/lib/media-creator-navigation";
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

export function ClouvaAIMediaCard({ media }: { media: ClouvaAIMediaAttachment }) {
  const [copied, setCopied] = useState(false);
  const creatorHref = buildMediaCreatorHref("image", media.prompt);

  async function copyPrompt() {
    await navigator.clipboard.writeText(media.prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section className={styles.card} aria-label="Generación de imagen de CLOUVA AI">
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

      {media.error ? <p className={styles.error}>{media.error}</p> : null}

      <div className={styles.actions}>
        <Link href={creatorHref} className={styles.primary}><Sparkles size={14} />Abrir en Crear</Link>
        <button type="button" onClick={() => void copyPrompt()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copiado" : "Copiar prompt"}</button>
        {media.outputUrl ? <a href={media.outputUrl} target="_blank" rel="noreferrer"><Download size={14} />Descargar</a> : null}
      </div>
    </section>
  );
}
