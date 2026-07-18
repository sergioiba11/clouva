"use client";

import { Box, CheckCircle2, Download, Loader2, PackageOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import styles from "./unreal-object-export.module.css";

type ObjectAsset = { name: string; path: string };
type StorageEntry = { name: string; metadata?: Record<string, unknown> | null };
type ExportResult = { url?: string; filename?: string; scale?: string; error?: string };

async function listGlbs(userId: string, path = userId, depth = 0): Promise<ObjectAsset[]> {
  const { data, error } = await supabase.storage.from("creator-assets").list(path, {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  });
  if (error) return [];
  const found: ObjectAsset[] = [];
  for (const raw of data ?? []) {
    const entry = raw as StorageEntry;
    const fullPath = `${path}/${entry.name}`;
    const folder = !entry.metadata && !entry.name.includes(".");
    if (folder && depth < 4) found.push(...(await listGlbs(userId, fullPath, depth + 1)));
    else if (/\.glb$/i.test(entry.name) && !/avatar/i.test(entry.name)) found.push({ name: entry.name, path: fullPath });
  }
  return found;
}

export function UnrealObjectExport() {
  const { user, session, loading } = useAuth();
  const [objects, setObjects] = useState<ObjectAsset[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoadingObjects(true);
    const next = await listGlbs(user.id);
    setObjects(next);
    setSelectedPath((current) => (next.some((item) => item.path === current) ? current : next[0]?.path || ""));
    setLoadingObjects(false);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const exportObject = async () => {
    const selected = objects.find((item) => item.path === selectedPath);
    if (!selected || !session?.access_token) return;
    setExporting(true);
    setResult(null);
    setError(null);
    try {
      const response = await fetch("/api/assets/export-unreal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ bucket: "creator-assets", path: selected.path, name: selected.name }),
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

  return (
    <section className={styles.card} aria-label="Exportar objetos para Unreal">
      <div className={styles.heading}>
        <span className={styles.icon}><PackageOpen /></span>
        <div>
          <small>OBJETOS CLOUVA</small>
          <h2>Pasar objeto a Unreal</h2>
          <p>Elegí una prenda, gorra, cadena, zapatilla u objeto GLB y descargalo como FBX.</p>
        </div>
        <button className={styles.refresh} type="button" onClick={() => void refresh()} disabled={loadingObjects} aria-label="Actualizar objetos">
          <RefreshCw className={loadingObjects ? styles.spin : undefined} />
        </button>
      </div>

      {objects.length ? (
        <>
          <label className={styles.selector}>
            <span>Objeto guardado</span>
            <select value={selectedPath} onChange={(event) => setSelectedPath(event.target.value)} disabled={exporting}>
              {objects.map((item) => <option key={item.path} value={item.path}>{item.name.replace(/[-_]+/g, " ")}</option>)}
            </select>
          </label>
          <div className={styles.specs}>
            <span><CheckCircle2 /> Escala del objeto conservada</span>
            <span><CheckCircle2 /> Materiales embebidos</span>
            <span><CheckCircle2 /> Rig conservado si existe</span>
            <span><CheckCircle2 /> Ejes preparados para Unreal</span>
          </div>
          <button className={styles.exportButton} type="button" onClick={() => void exportObject()} disabled={exporting || !selectedPath}>
            {exporting ? <Loader2 className={styles.spin} /> : <Box />}
            {exporting ? "BLENDER ESTÁ PREPARANDO EL OBJETO…" : "GENERAR Y DESCARGAR OBJETO FBX"}
          </button>
        </>
      ) : (
        <div className={styles.empty}><PackageOpen /><span>No encontramos objetos GLB en creator-assets todavía.</span></div>
      )}

      {result?.url ? <div className={styles.success}><CheckCircle2 /><span><strong>Objeto listo para Unreal</strong>{result.filename} · {result.scale}</span><a href={result.url} download={result.filename || true}><Download /> Descargar otra vez</a></div> : null}
      {error ? <div className={styles.error}><TriangleAlert /><span>{error}</span></div> : null}
    </section>
  );
}
