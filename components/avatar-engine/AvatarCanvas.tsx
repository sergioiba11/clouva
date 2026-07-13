"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { getRenderableAvatarUrl } from "@/lib/avatar-engine/catalog";
import type { AvatarConfig } from "@/lib/avatar-engine/types";
import { AvatarModelViewer } from "./AvatarModelViewer";

const DB_NAME = "clouva-avatar-db";
const STORE_NAME = "models";
const MODEL_KEY = "clouva-v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveModel(file: File) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(file, MODEL_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadModel(): Promise<Blob | null> {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(MODEL_KEY);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

export function AvatarCanvas({ config }: { config: AvatarConfig }) {
  const fallbackUrl = getRenderableAvatarUrl(config);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    loadModel()
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setLocalUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  const modelUrl = useMemo(() => localUrl ?? fallbackUrl, [localUrl, fallbackUrl]);

  const onUpload = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".glb")) {
      alert("Elegí un archivo .glb");
      return;
    }
    setUploading(true);
    try {
      await saveModel(file);
      if (localUrl) URL.revokeObjectURL(localUrl);
      setLocalUrl(URL.createObjectURL(file));
    } finally {
      setUploading(false);
    }
  };

  return (
    <section
      className="avatar-canvas"
      aria-label="Vista 3D del avatar CLOUVA"
      style={{ position: "absolute", inset: 0, zIndex: 1, width: "100%", height: "100%", minHeight: "100dvh", overflow: "hidden" }}
    >
      <div className="avatar-canvas-lights" />
      <Suspense fallback={<div className="avatar-loader">Cargando avatar…</div>}>
        <AvatarModelViewer modelUrl={modelUrl} config={config} className="avatar-engine-viewer" alt="Personaje humanoide CLOUVA configurado" />
      </Suspense>

      <label
        style={{
          position: "absolute",
          top: 78,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          padding: "10px 16px",
          borderRadius: 999,
          background: "rgba(20,10,35,.86)",
          border: "1px solid rgba(168,85,247,.6)",
          color: "white",
          fontSize: 13,
          fontWeight: 700,
          backdropFilter: "blur(12px)",
        }}
      >
        {uploading ? "Guardando avatar…" : localUrl ? "Cambiar avatar GLB" : "Subir avatar GLB"}
        <input type="file" accept=".glb,model/gltf-binary" hidden onChange={(event) => onUpload(event.target.files?.[0])} />
      </label>

      <div className="avatar-canvas-note">Arrastrá para girar · Pinch/scroll para zoom limitado</div>
    </section>
  );
}
