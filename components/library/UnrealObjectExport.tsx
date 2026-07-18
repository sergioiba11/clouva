"use client";

import { Box, CheckCircle2, Download, Loader2, PackageOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import styles from "./unreal-object-export.module.css";

type StorageAsset = { id: string; kind: "storage"; name: string; path: string; label: string };
type ClothingAsset = {
  id: string;
  kind: "clothing";
  name: string;
  clothingItemId: string;
  category: string;
  rigged: boolean;
  label: string;
};
type ObjectAsset = StorageAsset | ClothingAsset;
type StorageEntry = { name: string; metadata?: Record<string, unknown> | null };
type ExportResult = { url?: string; filename?: string; scale?: string; error?: string };
type ClothingResponse = {
  items?: Array<{ id: string; name: string; category: string; rigged: boolean; fitStatus?: string }>;
  error?: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  hoodie: "Buzo",
  shirt: "Remera",
  jacket: "Campera",
  pants: "Pantalón",
  shorts: "Short",
  shoes: "Zapatillas",
  accessory: "Accesorio",
};

async function listGlbs(userId: string, path = userId, depth = 0): Promise<StorageAsset[]> {
  const { data, error } = await supabase.storage.from("creator-assets").list(path, {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  });
  if (error) return [];
  const found: StorageAsset[] = [];
  for (const raw of data ?? []) {
    const entry = raw as StorageEntry;
    const fullPath = `${path}/${entry.name}`;
    const folder = !entry.metadata && !entry.name.includes(".");
    if (folder && depth < 4) found.push(...(await listGlbs(userId, fullPath, depth + 1)));
    else if (/\.glb$/i.test(entry.name) && !/avatar/i.test(entry.name)) {
      found.push({
        id: `storage:${fullPath}`,
        kind: "storage",
        name: entry.name,
        path: fullPath,
        label: `Archivo · ${entry.name.replace(/[-_]+/g, " ")}`,
      });
    }
  }
  return found;
}

export function UnrealObjectExport() {
  const { user, session, loading } = useAuth();
  const [objects, setObjects] = useState<ObjectAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user || !session?.access_token) return;
    setLoadingObjects(true);
    setError(null);
    try {
      const [storageAssets, clothingResponse] = await Promise.all([
        listGlbs(user.id),
        fetch("/api/assets/export-unreal", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        }),
      ]);
      const clothingData = (await clothingResponse.json().catch(() => ({}))) as ClothingResponse;
      if (!clothingResponse.ok) throw new Error(clothingData.error || "No se pudieron cargar tus piezas");

      const clothingAssets: ClothingAsset[] = (clothingData.items ?? []).map((item) => ({
        id: `clothing:${item.id}`,
        kind: "clothing",
        name: item.name,
        clothingItemId: item.id,
        category: item.category,
        rigged: item.rigged === true,
        label: `${CATEGORY_LABELS[item.category] || "Objeto"} · ${item.name}${item.rigged ? " · ajustado" : ""}`,
      }));

      const next: ObjectAsset[] = [...clothingAssets, ...storageAssets];
      setObjects(next);
      setSelectedId((current) => (next.some((item) => item.id === current) ? current : next[0]?.id || ""));
    } catch (cause) {
      setObjects([]);
      setSelectedId("");
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los objetos");
    } finally {
      setLoadingObjects(false);
    }
  }, [session?.access_token, user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const exportObject = async () => {
    const selected = objects.find((item) => item.id === selectedId);
    if (!selected || !session?.access_token) return;
    setExporting(true);
    setResult(null);
    setError(null);
    try {
      const requestBody = selected.kind === "clothing"
        ? { clothingItemId: selected.clothingItemId, name: selected.name }
        : { bucket: "creator-assets", path: selected.path, name: selected.name };

      const response = await fetch("/api/assets/export-unreal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(requestBody),
      });
      const data = (await response.json().catch(() => ({}))) as ExportResult;
      if (!response.ok || !data.url) throw new Error(data.error || `No se pudo generar el FBX (${response.status})`);
      setResult(data);
      const link = document.createElement("a");
      link.href = data.url;
      link.download = data.filename || "clouva-object-unreal.fbx";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo exportar el objeto");
    } finally {
      setExporting(false);
    }
  };

  if (loading || !user) return null;

  const selected = objects.find((item) => item.id === selectedId);

  return (
    <section id="unreal-objects" className={styles.card} aria-label="Exportar objetos para Unreal">
      <div className={styles.heading}>
        <span className={styles.icon}><PackageOpen /></span>
        <div>
          <small>OBJETOS CLOUVA</small>
          <h2>Pasar objeto a Unreal</h2>
          <p>Las piezas creadas con frente + espalda aparecen acá cuando Meshy y Blender terminan.</p>
        </div>
        <button className={styles.refresh} type="button" onClick={() => void refresh()} disabled={loadingObjects} aria-label="Actualizar objetos">
          <RefreshCw className={loadingObjects ? styles.spin : undefined} />
        </button>
      </div>

      {objects.length ? (
        <>
          <label className={styles.selector}>
            <span>Objeto guardado</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={exporting}>
              {objects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <div className={styles.specs}>
            <span><CheckCircle2 /> {selected?.kind === "clothing" && selected.rigged ? "Medidas calibradas al avatar activo" : "Escala original preservada"}</span>
            <span><CheckCircle2 /> Materiales embebidos</span>
            <span><CheckCircle2 /> Rig y skinning conservados</span>
            <span><CheckCircle2 /> Import Uniform Scale = 1</span>
          </div>
          <button className={styles.exportButton} type="button" onClick={() => void exportObject()} disabled={exporting || !selectedId}>
            {exporting ? <Loader2 className={styles.spin} /> : <Box />}
            {exporting ? "BLENDER ESTÁ PREPARANDO EL OBJETO…" : "GENERAR Y DESCARGAR OBJETO FBX"}
          </button>
        </>
      ) : (
        <div className={styles.empty}><PackageOpen /><span>{loadingObjects ? "Buscando tus objetos…" : "Todavía no hay piezas listas. Crealas desde Crear prenda con frente + espalda."}</span></div>
      )}

      {result?.url ? <div className={styles.success}><CheckCircle2 /><span><strong>Objeto listo para Unreal</strong>{result.filename} · {result.scale}</span><a href={result.url} download={result.filename || true}><Download /> Descargar otra vez</a></div> : null}
      {error ? <div className={styles.error}><TriangleAlert /><span>{error}</span></div> : null}
    </section>
  );
}
