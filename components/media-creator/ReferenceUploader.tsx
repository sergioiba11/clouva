"use client";
/* eslint-disable @next/next/no-img-element -- La referencia proviene de una URL externa subida en runtime. */

import { useRef, useState, type DragEvent } from "react";
import { ImagePlus, LoaderCircle, Trash2, UploadCloud } from "lucide-react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { ReferenceAsset } from "./types";
import styles from "./media-creator.module.css";

type ReferenceUploaderProps = {
  value: ReferenceAsset | null;
  onChange: (value: ReferenceAsset | null) => void;
  disabled?: boolean;
  onError: (message: string | null) => void;
};

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ReferenceUploader({ value, onChange, disabled, onError }: ReferenceUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const upload = async (file?: File) => {
    if (!file || disabled || uploading) return;
    onError(null);
    if (!allowedTypes.has(file.type)) {
      onError("Usá una imagen JPG, PNG o WebP.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onError("La imagen de referencia debe pesar hasta 10 MB.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await authenticatedFetch("/api/media/reference", { method: "POST", body: form });
      const payload = await readApiJson<{ reference: ReferenceAsset }>(response);
      onChange(payload.reference);
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo subir la referencia.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files?.[0]);
  };

  return (
    <section className={styles.referenceSection} aria-labelledby="reference-title">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionKicker}>Opcional</span>
          <h2 id="reference-title">Referencia visual</h2>
        </div>
        {value ? (
          <button type="button" className={styles.ghostButton} onClick={() => onChange(null)} disabled={disabled || uploading}>
            <Trash2 size={15} /> Quitar
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        className={styles.visuallyHidden}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => void upload(event.target.files?.[0])}
        disabled={disabled || uploading}
      />

      {value ? (
        <div className={styles.referencePreview}>
          <img src={value.url} alt="Imagen de referencia seleccionada" />
          <div>
            <strong>Referencia lista</strong>
            <span>{value.width > 0 ? `${value.width} × ${value.height} px · ${(value.size / 1024 / 1024).toFixed(1)} MB` : "Imagen de tu historial"}</span>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploading}>
              <ImagePlus size={16} /> Reemplazar
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          {uploading ? <LoaderCircle className={styles.spin} size={28} /> : <UploadCloud size={28} />}
          <div>
            <strong>{uploading ? "Subiendo referencia…" : "Arrastrá una imagen acá"}</strong>
            <span>JPG, PNG o WebP · hasta 10 MB</span>
          </div>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploading}>
            {uploading ? "Procesando…" : "Elegir archivo"}
          </button>
        </div>
      )}
    </section>
  );
}
