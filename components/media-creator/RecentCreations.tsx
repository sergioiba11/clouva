"use client";
/* eslint-disable @next/next/no-img-element -- El historial sirve URLs externas generadas en runtime. */

import { Copy, Download, ImageIcon, LoaderCircle, MoreHorizontal, Play, RotateCcw, Trash2 } from "lucide-react";
import type { MediaJob, MediaType } from "./types";
import styles from "./media-creator.module.css";

type RecentCreationsProps = {
  items: MediaJob[];
  filter: "all" | MediaType;
  onFilter: (value: "all" | MediaType) => void;
  loading: boolean;
  nextCursor: string | null;
  onLoadMore: () => void;
  onSelect: (job: MediaJob) => void;
  onCopyPrompt: (job: MediaJob) => void;
  onUseReference: (job: MediaJob) => void;
  onDelete: (job: MediaJob) => void;
  onRetryStorage: (job: MediaJob) => void;
};

const activeStatuses = new Set(["queued", "generating", "processing", "saving"]);

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function RecentCreations(props: RecentCreationsProps) {
  return (
    <aside className={styles.recentPanel} aria-labelledby="recent-title">
      <div className={styles.recentHeader}>
        <div>
          <span className={styles.sectionKicker}>Tu archivo</span>
          <h2 id="recent-title">Creaciones recientes</h2>
        </div>
        <MoreHorizontal size={19} aria-hidden="true" />
      </div>

      <div className={styles.filters} aria-label="Filtrar creaciones">
        {(["all", "image", "video"] as const).map((value) => (
          <button key={value} type="button" className={props.filter === value ? styles.filterActive : ""} onClick={() => props.onFilter(value)}>
            {value === "all" ? "Todas" : value === "image" ? "Imágenes" : "Videos"}
          </button>
        ))}
      </div>

      <div className={styles.creationList} aria-busy={props.loading}>
        {!props.items.length && !props.loading ? (
          <div className={styles.emptyHistory}>
            <ImageIcon size={24} />
            <strong>Todavía no hay creaciones</strong>
            <span>Lo que generes va a aparecer acá.</span>
          </div>
        ) : null}
        {props.items.map((job) => (
          <article key={job.id} className={styles.creationCard}>
            <button type="button" className={styles.creationMedia} onClick={() => props.onSelect(job)} aria-label={`Abrir creación: ${job.prompt}`}>
              {job.outputUrl && job.type === "image" ? <img src={job.outputUrl} alt={job.prompt} /> : null}
              {job.outputUrl && job.type === "video" ? <video src={job.outputUrl} muted playsInline preload="metadata" /> : null}
              {!job.outputUrl ? (
                <span className={styles.pendingMedia}>
                  {activeStatuses.has(job.status) ? <LoaderCircle className={styles.spin} size={26} /> : job.type === "video" ? <Play size={26} /> : <ImageIcon size={26} />}
                </span>
              ) : null}
              <span className={styles.mediaBadge}>{job.type === "image" ? <ImageIcon size={13} /> : <Play size={13} />}{job.type === "image" ? "Imagen" : "Video"}</span>
              <span className={styles.aspectBadge}>{job.aspectRatio}</span>
            </button>
            <div className={styles.creationMeta}>
              <p title={job.prompt}>{job.prompt}</p>
              <span>{dateLabel(job.createdAt)}</span>
              {activeStatuses.has(job.status) ? <em>Procesando</em> : null}
              {job.status === "failed" ? <em className={styles.errorText}>Falló</em> : null}
              {job.status === "storage_failed" ? <em className={styles.warningText}>Falta guardar</em> : null}
            </div>
            <div className={styles.cardActions}>
              {job.outputUrl ? <a href={job.outputUrl} target="_blank" rel="noreferrer" aria-label="Descargar resultado"><Download size={15} /></a> : null}
              <button type="button" onClick={() => props.onCopyPrompt(job)} aria-label="Copiar prompt"><Copy size={15} /></button>
              {job.outputUrl && job.type === "image" ? <button type="button" onClick={() => props.onUseReference(job)} aria-label="Usar como referencia"><RotateCcw size={15} /></button> : null}
              {job.status === "storage_failed" ? <button type="button" onClick={() => props.onRetryStorage(job)} aria-label="Reintentar guardado"><RotateCcw size={15} /></button> : null}
              {!activeStatuses.has(job.status) ? <button type="button" onClick={() => props.onDelete(job)} aria-label="Borrar creación"><Trash2 size={15} /></button> : null}
            </div>
          </article>
        ))}
      </div>

      {props.loading ? <div className={styles.loadingHistory}><LoaderCircle className={styles.spin} size={18} /> Cargando…</div> : null}
      {props.nextCursor && !props.loading ? <button type="button" className={styles.loadMore} onClick={props.onLoadMore}>Ver más</button> : null}
    </aside>
  );
}
