"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileBox, Link2, Trash2, Upload } from "lucide-react";
import {
  deleteReferenceAsset,
  listReferenceAssets,
  makeReferenceAsset,
  REFERENCE_CATEGORIES,
  saveReferenceAsset,
  type ReferenceAsset,
  type ReferenceCategory,
} from "@/lib/creator-studio/reference-assets";

type Props = {
  selectedAssetId: string | null;
  onSelect: (asset: ReferenceAsset | null, objectUrl: string | null) => void;
  onCategoryChange?: (category: ReferenceCategory) => void;
};

export function ReferenceAssetLibrary({ selectedAssetId, onSelect, onCategoryChange }: Props) {
  const [assets, setAssets] = useState<ReferenceAsset[]>([]);
  const [category, setCategory] = useState<ReferenceCategory>("zapatillas");
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [license, setLicense] = useState("Free Standard");
  const [author, setAuthor] = useState("");
  const [message, setMessage] = useState("Subí un GLB real para usarlo como referencia antes de gastar créditos en Meshy.");
  const objectUrlRef = useRef<string | null>(null);

  async function refresh() {
    try {
      setAssets(await listReferenceAssets());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo abrir la biblioteca local");
    }
  }

  useEffect(() => {
    void refresh();
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const uploadedCategories = useMemo(() => new Set(assets.map((asset) => asset.category)), [assets]);

  function selectAsset(asset: ReferenceAsset | null) {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (!asset) {
      onSelect(null, null);
      return;
    }
    const url = URL.createObjectURL(asset.file);
    objectUrlRef.current = url;
    onSelect(asset, url);
    onCategoryChange?.(asset.category);
    setMessage(`${asset.name} cargado en el visor como referencia.`);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".glb")) {
      setMessage("Elegí el archivo model.glb. Si descargaste un ZIP, extraelo primero.");
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      setMessage("El GLB supera 80 MB. Conviene optimizarlo en Blender antes de usarlo en la web.");
      return;
    }
    try {
      const asset = makeReferenceAsset(file, category, { name, sourceUrl, license, author });
      await saveReferenceAsset(asset);
      setName("");
      setSourceUrl("");
      setAuthor("");
      await refresh();
      selectAsset(asset);
      setMessage(`✓ ${asset.name} quedó guardado localmente en este dispositivo.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el archivo");
    }
  }

  async function removeAsset(asset: ReferenceAsset) {
    await deleteReferenceAsset(asset.id);
    if (selectedAssetId === asset.id) selectAsset(null);
    await refresh();
    setMessage(`${asset.name} fue eliminado de la biblioteca local.`);
  }

  return (
    <section style={panel}>
      <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}><FileBox size={19}/> Biblioteca de referencias GLB</h3>
      <p style={muted}>Estos archivos no se publican ni se venden: sirven para probar forma, escala y ubicación sobre el avatar, y para enviar una referencia visual a Meshy.</p>

      <div style={checklist}>
        {REFERENCE_CATEGORIES.map((item) => {
          const done = uploadedCategories.has(item);
          return (
            <button key={item} onClick={() => setCategory(item)} style={{ ...categoryChip, ...(category === item ? activeChip : {}), ...(done ? doneChip : {}) }}>
              <span style={checkCircle}>{done ? <Check size={13}/> : null}</span>{item}
            </button>
          );
        })}
      </div>

      <div style={grid}>
        <label><span style={label}>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value as ReferenceCategory)} style={input}>{REFERENCE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span style={label}>Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej: Vans Sk8-Hi" style={input}/></label>
        <label><span style={label}>Autor</span><input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Autor del modelo" style={input}/></label>
        <label><span style={label}>Licencia</span><input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="Free Standard / CC BY" style={input}/></label>
      </div>
      <label><span style={label}><Link2 size={14}/> URL de origen</span><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://sketchfab.com/3d-models/..." style={input}/></label>

      <label style={dropzone}>
        <Upload size={24}/>
        <strong>Subir model.glb</strong>
        <span style={muted}>Se guarda en este dispositivo. Acepta un GLB por vez.</span>
        <input hidden type="file" accept=".glb,model/gltf-binary" onChange={(event) => void handleFile(event.target.files?.[0])}/>
      </label>

      <div style={messageBox}>{message}</div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {assets.length === 0 ? <div style={empty}>Todavía no hay referencias cargadas.</div> : assets.map((asset) => (
          <div key={asset.id} style={{ ...assetRow, ...(selectedAssetId === asset.id ? selectedRow : {}) }}>
            <button onClick={() => selectAsset(asset)} style={assetButton}>
              <span style={{ ...checkCircle, background: selectedAssetId === asset.id ? "#7441b5" : "#1a1420" }}>{selectedAssetId === asset.id ? <Check size={13}/> : null}</span>
              <span style={{ display: "grid", textAlign: "left" }}><strong>{asset.name}</strong><small style={muted}>{asset.category} · {(asset.size / 1024 / 1024).toFixed(1)} MB · {asset.license || "sin licencia registrada"}</small></span>
            </button>
            <button aria-label={`Eliminar ${asset.name}`} onClick={() => void removeAsset(asset)} style={trashButton}><Trash2 size={16}/></button>
          </div>
        ))}
      </div>
    </section>
  );
}

const panel: React.CSSProperties = { marginTop: 18, padding: 16, borderRadius: 18, background: "#0f0b13", border: "1px solid #30243a" };
const muted: React.CSSProperties = { color: "#9f97a9", fontSize: 13, lineHeight: 1.45 };
const checklist: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 7, margin: "12px 0" };
const categoryChip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #33283e", background: "#15101a", color: "#aaa1b4", borderRadius: 999, padding: "7px 10px", cursor: "pointer" };
const activeChip: React.CSSProperties = { borderColor: "#8b5cf6", color: "white", background: "#2c1742" };
const doneChip: React.CSSProperties = { color: "#9cebb6", borderColor: "#28513a" };
const checkCircle: React.CSSProperties = { width: 19, height: 19, display: "grid", placeItems: "center", borderRadius: 999, background: "#1b1521" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 9 };
const label: React.CSSProperties = { display: "flex", gap: 5, alignItems: "center", color: "#aaa1b4", fontSize: 12, margin: "9px 0 5px" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#09070c", border: "1px solid #33283e", borderRadius: 10, color: "white", padding: "10px 11px" };
const dropzone: React.CSSProperties = { marginTop: 12, minHeight: 105, border: "1px dashed #5b3f79", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 5, cursor: "pointer", background: "#110b17" };
const messageBox: React.CSSProperties = { marginTop: 10, padding: 10, borderRadius: 10, background: "#17101e", color: "#cdbdde", fontSize: 13 };
const empty: React.CSSProperties = { color: "#81798a", padding: 10, textAlign: "center" };
const assetRow: React.CSSProperties = { display: "flex", alignItems: "center", border: "1px solid #292031", background: "#100c14", borderRadius: 12, overflow: "hidden" };
const selectedRow: React.CSSProperties = { borderColor: "#8758c7", background: "#20122f" };
const assetButton: React.CSSProperties = { flex: 1, display: "flex", alignItems: "center", gap: 9, border: 0, background: "transparent", color: "white", padding: 10, cursor: "pointer" };
const trashButton: React.CSSProperties = { border: 0, borderLeft: "1px solid #292031", background: "transparent", color: "#b49fbb", padding: 13, cursor: "pointer" };
