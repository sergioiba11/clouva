"use client";

import { Suspense, useEffect, useState } from "react";
import type { AvatarConfig } from "@/lib/avatar-engine/types";
import { AvatarModelViewer } from "./AvatarModelViewer";

const DEFAULT_BODY_URL = "/models/hoodie-character.glb";
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
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
  });
}

async function saveModel(file: File) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(file, MODEL_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("No se pudo guardar el GLB"));
    tx.onabort = () => reject(tx.error ?? new Error("Se canceló el guardado"));
  });
  db.close();
}

async function loadModel(): Promise<Blob | null> {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(MODEL_KEY);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("No se pudo leer el GLB"));
  });
  db.close();
  return blob;
}

export function AvatarCanvas({ config }: { config: AvatarConfig }) {
  const [modelData, setModelData] = useState<ArrayBuffer | null>(null);
  const [status, setStatus] = useState("Subir avatar GLB");

  useEffect(() => {
    let active = true;
    loadModel()
      .then(async (blob) => {
        if (!active || !blob) return;
        setStatus("Leyendo avatar guardado…");
        const buffer = await blob.arrayBuffer();
        if (!active) return;
        setModelData(buffer);
        setStatus("Cambiar avatar GLB");
      })
      .catch(() => setStatus("Subir avatar GLB"));
    return () => {
      active = false;
    };
  }, []);

  const modelUrl = modelData ? null : DEFAULT_BODY_URL;

  const onUpload = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".glb")) {
      setStatus("El archivo debe ser .glb");
      return;
    }

    try {
      setStatus(`Leyendo ${file.name}…`);
      const buffer = await file.arrayBuffer();
      setModelData(buffer);
      setStatus("Avatar cargado ✓");
      void saveModel(file).catch((error) => console.error("No se pudo persistir el GLB", error));
      window.setTimeout(() => setStatus("Cambiar avatar GLB"), 1800);
    } catch (error) {
      console.error("No se pudo leer el archivo GLB", error);
      setStatus("No se pudo leer el GLB");
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
        <AvatarModelViewer
          modelUrl={modelUrl}
          modelData={modelData}
          config={config}
          className="avatar-engine-viewer"
          alt="Personaje humanoide CLOUVA configurado"
        />
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
          whiteSpace: "nowrap",
        }}
      >
        {status}
        <input
          type="file"
          accept=".glb,model/gltf-binary,application/octet-stream"
          hidden
          onChange={(event) => {
            void onUpload(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </label>

      <div className="avatar-canvas-note">Arrastrá para girar · Pinch/scroll para zoom limitado</div>
    </section>
  );
}
